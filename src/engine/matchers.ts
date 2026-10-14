import type { MatchResult, RuleMatcher, SpecialRule } from "../types.js";
import { stripCLikeComments, normalizeNewlines } from "../normalize/index.js";

export type UseParams = { target: string; caseSensitive?: boolean };
export type RegexParams = { pattern: string; flags?: string };
export type CompositeParams = { op: "AND" | "OR"; rules: SpecialRule[] };

function normalizeUseParams(params: any): { target: string; caseSensitive?: boolean } | null {
    if (!params || typeof params !== "object") return null;

    // New name
    if (typeof (params as any).target === "string") {
        return { target: (params as any).target, caseSensitive: (params as any).caseSensitive };
    }

    return null;
}

export const useMatcher: RuleMatcher<UseParams> = {
    type: "use",
    match(params, input): MatchResult {
        const normalized = normalizeUseParams(params);
        if (!normalized || typeof normalized.target !== "string") {
            return { matched: false, reason: "use: params.target must be a string", error: true };
        }

        const haystack = normalized.caseSensitive ? input.text : input.text.toLowerCase();
        const target = normalized.caseSensitive ? normalized.target : normalized.target.toLowerCase();
        return {
            matched: haystack.includes(target),
            reason: haystack.includes(target)
                ? `use: found '${normalized.target}'`
                : `use: missing '${normalized.target}'`,
        };
    },
};
export const nestedLoopMatcher: RuleMatcher = {
    type: "nestedLoop",
    match: function (_params: any, input: { language: string; text: string } | any): MatchResult {
        // Ensure we use the second argument as input (other matchers accept params,input)
        if (!input || typeof input.text !== "string") {
            return { matched: false, reason: "nestedLoop: missing input.text", error: true };
        }

        const src = normalizeNewlines(String(input.text));
        // use existing comment stripper for C-like comments
        let clean = stripCLikeComments(src);
        // remove string and char literals (simple)
        clean = clean.replace(/"(?:\\.|[^"\\])*"/g, " ");
        clean = clean.replace(/'(?:\\.|[^'\\])*'/g, " ");

        // helpers to find matching paren/brace
        function findMatching(s: string, start: number, openCh: string, closeCh: string): number {
            let depth = 0;
            for (let i = start; i < s.length; i++) {
                const ch = s[i];
                if (ch === openCh) depth++;
                else if (ch === closeCh) {
                    depth--;
                    if (depth === 0) return i;
                }
                else if (ch === '"' || ch === "'") {
                    // skip strings inside (shouldn't exist after strip, but be safe)
                    const q = ch;
                    i++;
                    while (i < s.length && s[i] !== q) {
                        if (s[i] === '\\') i += 2; else i++;
                    }
                }
            }
            return -1;
        }

        // find all loops and their body ranges, then detect nesting
        const loopKeyword = /\b(for|while|do)\b/g;
        const loops: Array<{ start: number; bodyStart: number; bodyEnd: number | null }> = [];
        let m: RegExpExecArray | null;
        while ((m = loopKeyword.exec(clean)) !== null) {
            const kw = m[1];
            const idx = m.index;
            if (kw === 'do') {
                // body starts after 'do'
                let i = idx + m[0].length;
                // skip whitespace
                while (i < clean.length && /\s/.test(clean[i])) i++;
                if (clean[i] === '{') {
                    const end = findMatching(clean, i, '{', '}');
                    loops.push({ start: idx, bodyStart: i, bodyEnd: end });
                } else {
                    // single statement body: end at next ';'
                    const semi = clean.indexOf(';', i);
                    const end = semi >= 0 ? semi : null;
                    loops.push({ start: idx, bodyStart: i, bodyEnd: end });
                }
            } else {
                // for or while: find closing ) after the keyword
                const parenOpen = clean.indexOf('(', idx + m[0].length);
                if (parenOpen === -1) continue;
                const parenClose = findMatching(clean, parenOpen, '(', ')');
                if (parenClose === -1) continue;
                let i = parenClose + 1;
                while (i < clean.length && /\s/.test(clean[i])) i++;
                if (clean[i] === '{') {
                    const end = findMatching(clean, i, '{', '}');
                    loops.push({ start: idx, bodyStart: i, bodyEnd: end });
                } else {
                    // single statement body; detect whether it begins with a loop keyword
                    // read next token
                    const tokenMatch = /\b(for|while|do)\b/.exec(clean.slice(i));
                    if (tokenMatch && tokenMatch.index === 0) {
                        // immediate nested loop
                        loops.push({ start: idx, bodyStart: i, bodyEnd: null });
                        return { matched: true, reason: "nested loop found" };
                    }
                    const semi = clean.indexOf(';', i);
                    const end = semi >= 0 ? semi : null;
                    loops.push({ start: idx, bodyStart: i, bodyEnd: end });
                }
            }
        }

        // Now check nesting: for any loop, if its body (range) contains another loop.start
        for (let outer of loops) {
            if (outer.bodyEnd === null) continue; // unknown end; skip
            for (let inner of loops) {
                if (inner === outer) continue;
                if (inner.start > outer.bodyStart && inner.start < (outer.bodyEnd as number)) {
                    return { matched: true, reason: "nested loop found" };
                }
            }
        }

        return { matched: false, reason: "no nested loop" };
    }
}
export const regexMatcher: RuleMatcher<RegexParams> = {
    type: "regex",
    match(params, input): MatchResult {
        if (!params || typeof params.pattern !== "string") {
            return { matched: false, reason: "regex: params.pattern must be a string", error: true };
        }

        try {
            const re = new RegExp(params.pattern, params.flags);
            const matched = re.test(input.text);
            return { matched, reason: matched ? `regex: matched /${params.pattern}/` : `regex: not matched` };
        } catch (e: any) {
            return { matched: false, reason: `regex: invalid regex (${String(e?.message ?? e)})`, error: true };
        }
    },
};

function matchChildRule(child: SpecialRule, input: { language: string; text: string }): MatchResult {
    if (!child || typeof child.type !== "string") {
        return { matched: false, reason: "composite: child rule missing type", error: true };
    }

    // IMPORTANT: composite matching is purely about whether the child rule matcher matches.
    // Constraints are applied later by the evaluator.
    if (child.type === "composite") {
        return compositeMatcher.match(child.params as CompositeParams, input);
    }

    if (child.type === "use") {
        return useMatcher.match(child.params as UseParams, input);
    }

    if (child.type === "regex") {
        return regexMatcher.match(child.params as RegexParams, input);
    }

    return { matched: false, reason: `composite: unknown child type '${child.type}'`, error: true };
}

export const compositeMatcher: RuleMatcher<CompositeParams> = {
    type: "composite",
    match(params, input): MatchResult {
        if (!params || (params.op !== "AND" && params.op !== "OR") || !Array.isArray(params.rules)) {
            return { matched: false, reason: "composite: params must be { op: AND|OR, rules: SpecialRule[] }", error: true };
        }

        const childMatches = params.rules.map((r) => matchChildRule(r, input));
        const matched =
            params.op === "AND"
                ? childMatches.every((r) => r.matched)
                : childMatches.some((r) => r.matched);

        return {
            matched,
            reason: `composite(${params.op}): ${childMatches.map((r) => (r.matched ? "T" : "F")).join(",")}`,
            error: childMatches.some((result) => result.error),
        };
    },
};

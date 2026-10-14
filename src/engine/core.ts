import type {
    MatchResult,
    RuleEvalContext,
    RuleEvalResult,
    RuleMatcher,
    SpecialRule,
    SourceNormalizer,
} from "../types.js";
import { defaultSourceNormalizer } from "../normalize/registry.js";
import {
    compositeMatcher,
    regexMatcher,
    useMatcher,
    type CompositeParams,
    type UseParams,
    type RegexParams,
    nestedLoopMatcher,
} from "./matchers.js";

const matcherByType: Record<string, RuleMatcher<any>> = {
    use: useMatcher,
    regex: regexMatcher,
    composite: compositeMatcher,
    nestedLoop: nestedLoopMatcher,
};

export function applyConstraint(constraint: SpecialRule["constraint"], matched: boolean): boolean {
    return constraint === "MUST_HAVE" ? matched : !matched;
}

export function matchRule(rule: SpecialRule, input: { language: string; text: string }): MatchResult {
    const matcher = matcherByType[rule.type];
    if (!matcher) {
        return { matched: false, reason: `unknown rule type: ${rule.type}`, error: true };
    }

    return matcher.match(rule.params as UseParams | RegexParams | CompositeParams, input);
}

export function evaluateRule(
    rule: SpecialRule,
    ctx: RuleEvalContext,
    opts?: { normalizer?: SourceNormalizer },
): RuleEvalResult {
    const normalizer = opts?.normalizer ?? defaultSourceNormalizer;
    const { normalizedText } = normalizer.normalize({
        language: ctx.language,
        sourceText: ctx.sourceText,
    });

    const match = matchRule(rule, { language: ctx.language, text: normalizedText });
    const passed = match.error ? false : applyConstraint(rule.constraint, match.matched);

    return {
        ruleId: rule.id,
        passed,
        message: rule.message,
        reason: match.reason,
    };
}

export function evaluateRules(
    rules: SpecialRule[],
    ctx: RuleEvalContext,
    opts?: { normalizer?: SourceNormalizer },
): RuleEvalResult[] {
    return rules.map((rule) => evaluateRule(rule, ctx, opts));
}

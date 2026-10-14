import type {
    MatchResult,
    RuleEvalContext,
    RuleEvalResult,
    RuleMatcher,
    SpecialRule,
    SourceNormalizer,
} from "../types.js";
import type { PythonFeature } from "../types.js";
import { analyzePythonFeatures } from "../python/analyzer.js";
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
    nestedLoop: nestedLoopMatcher
};

function applyConstraint(constraint: SpecialRule["constraint"], matched: boolean): boolean {
    return constraint === "MUST_HAVE" ? matched : !matched;
}

function matchRule(rule: SpecialRule, input: { language: string; text: string }): MatchResult {
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
    return rules.map((r) => evaluateRule(r, ctx, opts));
}

type PythonFeatureParams = { features: PythonFeature[] };
const pythonFeatureNames = new Set<PythonFeature>([
    "IF", "FOR", "WHILE", "FUNCTION", "NESTED_LOOP", "RECURSION",
    "LAMBDA", "LIST", "DICT", "SET", "SORT", "SORTED",
]);

function getPythonFeatureParams(rule: SpecialRule): PythonFeatureParams | null {
    const params = rule.params as Partial<PythonFeatureParams> | null;
    return params && Array.isArray(params.features) && params.features.length > 0
        && params.features.every((feature) => pythonFeatureNames.has(feature))
        ? { features: params.features }
        : null;
}

function collectPythonFeatureRules(rules: SpecialRule[]): SpecialRule[] {
    return rules.flatMap((rule) => {
        if (rule.type === "pythonFeature") return [rule];
        if (rule.type === "composite") {
            const params = rule.params as Partial<CompositeParams> | null;
            return params && Array.isArray(params.rules) ? collectPythonFeatureRules(params.rules) : [];
        }
        return [];
    });
}

async function matchRuleAsync(
    rule: SpecialRule,
    input: { language: string; text: string },
    features: Set<PythonFeature> | null,
): Promise<MatchResult> {
    if (rule.type === "pythonFeature") {
        if (input.language !== "python" && input.language !== "py") {
            return { matched: false, reason: "pythonFeature: only supports Python source", error: true };
        }
        const params = getPythonFeatureParams(rule);
        if (!params) {
            return { matched: false, reason: "pythonFeature: params.features must be a non-empty list of supported features", error: true };
        }
        if (!features) return { matched: false, reason: "pythonFeature: analysis unavailable", error: true };
        const matched = params.features.every((feature) => features.has(feature));
        return {
            matched,
            reason: matched
                ? `pythonFeature: found ${params.features.join(", ")}`
                : `pythonFeature: missing ${params.features.filter((feature) => !features.has(feature)).join(", ")}`,
        };
    }

    if (rule.type === "composite") {
        const params = rule.params as CompositeParams | null;
        if (!params || (params.op !== "AND" && params.op !== "OR") || !Array.isArray(params.rules)) {
            return { matched: false, reason: "composite: params must be { op: AND|OR, rules: SpecialRule[] }", error: true };
        }
        const childMatches = await Promise.all(params.rules.map((child) => matchRuleAsync(child, input, features)));
        const matched = params.op === "AND"
            ? childMatches.every((child) => child.matched)
            : childMatches.some((child) => child.matched);
        return {
            matched,
            reason: `composite(${params.op}): ${childMatches.map((child) => child.matched ? "T" : "F").join(",")}`,
            error: childMatches.some((child) => child.error),
        };
    }

    const matcher = matcherByType[rule.type];
    return matcher
        ? matcher.match(rule.params, input)
        : { matched: false, reason: `unknown rule type: ${rule.type}`, error: true };
}

/**
 * Evaluate rules that may need asynchronous analyzers such as Tree-sitter WASM.
 * Keep evaluateRules synchronous for existing matcher types and callers.
 */
export async function evaluateRulesAsync(
    rules: SpecialRule[],
    ctx: RuleEvalContext,
    opts?: { normalizer?: SourceNormalizer },
): Promise<RuleEvalResult[]> {
    const pythonRules = collectPythonFeatureRules(rules);
    if (pythonRules.length === 0) return evaluateRules(rules, ctx, opts);

    const language = ctx.language.trim().toLowerCase();
    const validRules = pythonRules
        .map((rule) => getPythonFeatureParams(rule))
        .filter((params): params is PythonFeatureParams => params !== null);
    const allFeatures = [...new Set(validRules.flatMap((params) => params.features))];
    const analysis = language === "python" || language === "py"
        ? await analyzePythonFeatures(ctx.sourceText, allFeatures)
        : { features: new Set<PythonFeature>(), error: "pythonFeature: only supports Python source" };
    const normalizer = opts?.normalizer ?? defaultSourceNormalizer;
    const { normalizedText } = normalizer.normalize(ctx);
    const input = { language, text: normalizedText };

    return Promise.all(rules.map(async (rule) => {
        const ruleUsesPythonFeature = collectPythonFeatureRules([rule]).length > 0;
        const match = await matchRuleAsync(rule, input, analysis.error ? null : analysis.features);
        if (analysis.error && ruleUsesPythonFeature) match.error = true;
        return {
            ruleId: rule.id,
            passed: match.error ? false : applyConstraint(rule.constraint, match.matched),
            message: rule.message,
            reason: analysis.error && ruleUsesPythonFeature
                ? analysis.error
                : match.reason,
        };
    }));
}

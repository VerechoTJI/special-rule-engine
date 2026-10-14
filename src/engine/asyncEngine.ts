import type {
    MatchResult,
    RuleEvalContext,
    RuleEvalResult,
    SpecialRule,
    SourceNormalizer,
} from "../types.js";
import { defaultSourceNormalizer } from "../normalize/registry.js";
import { defaultRuleHandlerRegistry } from "./defaultRuleHandlers.js";
import { RuleHandlerRegistry } from "./ruleHandlers.js";
import { applyConstraint, evaluateRules, matchRule } from "./core.js";
import type { CompositeParams } from "./matchers.js";

export type EvaluateRulesAsyncOptions = {
    normalizer?: SourceNormalizer;
    /** Supply a complete registry, or extend the defaults with `defaultRuleHandlerRegistry.with(handler)`. */
    ruleHandlers?: RuleHandlerRegistry;
};

type PreparedHandler = { value?: unknown; error?: string };

function collectHandledRules(
    rules: SpecialRule[],
    registry: RuleHandlerRegistry,
): Map<string, SpecialRule[]> {
    const grouped = new Map<string, SpecialRule[]>();
    const visit = (rule: SpecialRule): void => {
        if (!rule || typeof rule.type !== "string") return;
        if (registry.has(rule.type)) {
            const matchingRules = grouped.get(rule.type) ?? [];
            matchingRules.push(rule);
            grouped.set(rule.type, matchingRules);
        }
        if (rule.type === "composite") {
            const params = rule.params as Partial<CompositeParams> | null;
            if (Array.isArray(params?.rules)) params.rules.forEach(visit);
        }
    };
    rules.forEach(visit);
    return grouped;
}

function getRuleChildren(rule: SpecialRule): { op: "AND" | "OR"; rules: SpecialRule[] } | null {
    if (rule.type !== "composite") return null;
    const params = rule.params as CompositeParams | null;
    return params && (params.op === "AND" || params.op === "OR") && Array.isArray(params.rules)
        ? params
        : null;
}

async function matchRuleAsync(
    rule: SpecialRule,
    input: { language: string; text: string },
    registry: RuleHandlerRegistry,
    prepared: Map<string, PreparedHandler>,
): Promise<MatchResult> {
    if (!rule || typeof rule.type !== "string") {
        return { matched: false, reason: "rule is missing a type", error: true };
    }

    if (rule.type === "composite") {
        const composite = getRuleChildren(rule);
        if (!composite) {
            return { matched: false, reason: "composite: params must be { op: AND|OR, rules: SpecialRule[] }", error: true };
        }
        const childMatches = await Promise.all(composite.rules.map((child) => matchRuleAsync(child, input, registry, prepared)));
        const matched = composite.op === "AND"
            ? childMatches.every((child) => child.matched)
            : childMatches.some((child) => child.matched);
        const firstError = childMatches.find((child) => child.error);
        return {
            matched,
            reason: firstError?.reason ?? `composite(${composite.op}): ${childMatches.map((child) => child.matched ? "T" : "F").join(",")}`,
            error: childMatches.some((child) => child.error),
        };
    }

    const handler = registry.get(rule.type);
    if (!handler) return matchRule(rule, input);

    const context = prepared.get(rule.type);
    if (context?.error) return { matched: false, reason: context.error, error: true };
    try {
        return await handler.match(rule, input, context?.value);
    } catch (error) {
        return {
            matched: false,
            reason: `${rule.type}: handler failed (${String(error)})`,
            error: true,
        };
    }
}

/** Evaluate rules that need registered async handlers while leaving sync matchers unchanged. */
export async function evaluateRulesAsync(
    rules: SpecialRule[],
    ctx: RuleEvalContext,
    opts?: EvaluateRulesAsyncOptions,
): Promise<RuleEvalResult[]> {
    const registry = opts?.ruleHandlers ?? defaultRuleHandlerRegistry;
    const groupedRules = collectHandledRules(rules, registry);
    if (groupedRules.size === 0) return evaluateRules(rules, ctx, opts);

    const prepared = new Map<string, PreparedHandler>();
    await Promise.all([...groupedRules].map(async ([type, matchingRules]) => {
        const handler = registry.get(type)!;
        if (!handler.prepare) {
            prepared.set(type, { value: undefined });
            return;
        }
        try {
            prepared.set(type, { value: await handler.prepare(matchingRules, ctx) });
        } catch (error) {
            prepared.set(type, { error: `${type}: analysis failed (${String(error)})` });
        }
    }));

    const language = ctx.language.trim().toLowerCase();
    const normalizer = opts?.normalizer ?? defaultSourceNormalizer;
    const { normalizedText } = normalizer.normalize(ctx);
    const input = { language, text: normalizedText };

    return Promise.all(rules.map(async (rule) => {
        const match = await matchRuleAsync(rule, input, registry, prepared);
        return {
            ruleId: rule.id,
            passed: match.error ? false : applyConstraint(rule.constraint, match.matched),
            message: rule.message,
            reason: match.reason,
        };
    }));
}

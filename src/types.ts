export type RuleConstraint = "MUST_HAVE" | "MUST_NOT_HAVE";

// NOTE: `includes` is legacy. Prefer `use`.
export type SpecialRuleType = "regex" | "use" | "nestedLoop" | "composite" | "pythonFeature" | (string & {});

export type SpecialRuleSeverity = "info" | "warn";

export type SpecialRule = {
    id: string;
    type: SpecialRuleType;
    constraint: RuleConstraint;
    message: string;
    severity?: SpecialRuleSeverity;
    params: unknown;
};

export type RuleEvalContext = {
    language: string;
    sourceText: string;
};

export type RuleEvalResult = {
    ruleId: string;
    passed: boolean;
    message: string;
    reason?: string;
};

export type MatchResult = { matched: boolean; reason?: string; error?: boolean };

export interface SourceNormalizer {
    normalize(input: { language: string; sourceText: string }): {
        normalizedText: string;
    };
}

export interface RuleMatcher<Params = unknown> {
    readonly type: SpecialRuleType;
    match(params: Params, input: { language: string; text: string }): MatchResult;
}

/** Async extension point for rule types that need shared analysis before matching. */
export interface AsyncRuleHandler<Prepared = unknown> {
    readonly type: string;
    prepare?(rules: readonly SpecialRule[], context: RuleEvalContext): Prepared | Promise<Prepared>;
    match(
        rule: SpecialRule,
        input: { language: string; text: string },
        prepared: Prepared,
    ): MatchResult | Promise<MatchResult>;
}

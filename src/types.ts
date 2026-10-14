export type RuleConstraint = "MUST_HAVE" | "MUST_NOT_HAVE";

// NOTE: `includes` is legacy. Prefer `use`.
export type SpecialRuleType = "regex" | "use" | "nestedLoop" | "composite" | "pythonFeature";

export type PythonFeature =
    | "IF"
    | "FOR"
    | "WHILE"
    | "FUNCTION"
    | "NESTED_LOOP"
    | "RECURSION"
    | "LAMBDA"
    | "LIST"
    | "DICT"
    | "SET"
    | "SORT"
    | "SORTED";

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

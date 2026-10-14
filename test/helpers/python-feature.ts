import { evaluateRules, type PythonFeature, type RuleEvalResult, type SpecialRule } from "../../src/index.js";

export function makePythonRule(
    features: PythonFeature[],
    constraint: "MUST_HAVE" | "MUST_NOT_HAVE" = "MUST_HAVE",
): SpecialRule {
    return {
        id: "python-features",
        type: "pythonFeature",
        constraint,
        message: "Python feature requirement",
        params: { features },
    };
}

export async function matchesPythonFeatures(features: PythonFeature[], sourceText: string): Promise<boolean> {
    const [result] = await evaluateRules([makePythonRule(features)], { language: "Python", sourceText });
    return result!.passed;
}

export async function evaluatePythonFeatures(features: PythonFeature[], sourceText: string): Promise<RuleEvalResult[]> {
    return evaluateRules([makePythonRule(features)], { language: "Python", sourceText });
}

export async function evaluatePythonFeatureDetails(features: PythonFeature[], sourceText: string): Promise<Array<{ feature: PythonFeature; result: RuleEvalResult }>> {
    const requested = [...new Set(features)];
    const rules = requested.map((feature, index) => ({
        ...makePythonRule([feature]),
        id: `python-feature-${index}`,
    }));
    const results = await evaluateRules(rules, { language: "Python", sourceText });
    return requested.map((feature, index) => ({ feature, result: results[index]! }));
}

export function malformedPythonRule(features: unknown): SpecialRule {
    return {
        ...makePythonRule(["FOR"]),
        params: { features },
    };
}

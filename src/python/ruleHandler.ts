import type { AsyncRuleHandler, SpecialRule } from "../types.js";
import { analyzePythonFeatures } from "./analyzer.js";
import type { PythonFeature } from "./types.js";

type PythonFeatureParams = { features: PythonFeature[] };
type PythonPreparation = { features: Set<PythonFeature>; error?: string };

const supportedFeatures = new Set<PythonFeature>([
    "IF", "FOR", "WHILE", "FUNCTION", "NESTED_LOOP", "RECURSION",
    "LAMBDA", "LIST", "DICT", "SET", "SORT", "SORTED",
]);

function getFeatureParams(rule: SpecialRule): PythonFeatureParams | null {
    const params = rule.params as Partial<PythonFeatureParams> | null;
    return params && Array.isArray(params.features) && params.features.length > 0
        && params.features.every((feature) => supportedFeatures.has(feature))
        ? { features: params.features }
        : null;
}

function failed(reason: string) {
    return { matched: false, reason, error: true } as const;
}

export const pythonFeatureRuleHandler: AsyncRuleHandler<PythonPreparation> = {
    type: "pythonFeature",

    async prepare(rules, context) {
        const language = context.language.trim().toLowerCase();
        if (language !== "python" && language !== "py") {
            return { features: new Set(), error: "pythonFeature: only supports Python source" };
        }

        const requested = rules
            .map(getFeatureParams)
            .filter((params): params is PythonFeatureParams => params !== null)
            .flatMap((params) => params.features);
        return analyzePythonFeatures(context.sourceText, [...new Set(requested)]);
    },

    match(rule, _input, analysis) {
        if (analysis.error) return failed(analysis.error);

        const params = getFeatureParams(rule);
        if (!params) {
            return failed("pythonFeature: params.features must be a non-empty list of supported features");
        }

        const matched = params.features.every((feature) => analysis.features.has(feature));
        return {
            matched,
            reason: matched
                ? `pythonFeature: found ${params.features.join(", ")}`
                : `pythonFeature: missing ${params.features.filter((feature) => !analysis.features.has(feature)).join(", ")}`,
        };
    },
};

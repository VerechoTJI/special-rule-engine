import { describe, expect, it } from "vitest";
import { analyzePythonFeatures } from "../src/python/analyzer.js";
import type { PythonFeature, SpecialRule } from "../src/index.js";
import { evaluatePythonFeatureDetails, evaluatePythonFeatures, malformedPythonRule, matchesPythonFeatures } from "./helpers/python-feature.js";
import { evaluateRules } from "../src/index.js";

const forAndIf = "for i in range(10):\n    if i % 2 == 0:\n        print(i)";
const referenceSamples = [
    forAndIf,
    "n = 3\nwhile n > 0:\n    n -= 1",
    "nums = [3, 1, 2]\nprint(sorted(nums, key=lambda x: -x))",
    "def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\nprint(fact(5))",
    "# while True: pass\nmsg = 'for x in xs: if x: pass'\ntext = 'lambda x: x'",
    "for i in range(10):\n    while i > 0:\n        i -= 1",
    "matrix = [[x * y for y in range(5)] for x in range(5)]",
    "for i in range(5):\n    print(i)\nfor j in range(5):\n    print(j)",
    "def outer(n):\n    def helper(k):\n        if k <= 0: return 0\n        return helper(k - 1)\n    return helper(n)\nouter(2)",
    "def func():\n    func = lambda: 5\n    return func()\nfunc()",
    "while (n := len(items)) > 0:\n    if n % 2 == 0:\n        items.pop()",
    "",
    "for i in range(3)\n    print(i)",
];

describe("Python rule API: check semantics", () => {
    it("passes when all requested features are present", async () => {
        expect(await matchesPythonFeatures(["IF", "FOR"], forAndIf)).toBe(true);
    });

    it("accepts a feature collection as a list", async () => {
        expect(await matchesPythonFeatures(["IF", "FOR"], forAndIf)).toBe(true);
    });

    it("fails when any requested feature is missing", async () => {
        expect(await matchesPythonFeatures(["IF", "FOR", "WHILE"], forAndIf)).toBe(false);
    });

    it("checks a single feature", async () => {
        expect(await matchesPythonFeatures(["FOR"], forAndIf)).toBe(true);
        expect(await matchesPythonFeatures(["WHILE"], forAndIf)).toBe(false);
    });

    it("ignores source features that were not requested", async () => {
        expect(await matchesPythonFeatures(["IF"], forAndIf)).toBe(true);
    });

    it("does not depend on feature order or duplicate entries", async () => {
        const expected = await matchesPythonFeatures(["IF", "FOR"], forAndIf);
        expect(await matchesPythonFeatures(["FOR", "IF"], forAndIf)).toBe(expected);
        expect(await matchesPythonFeatures(["FOR", "IF", "FOR", "IF"], forAndIf)).toBe(expected);
    });

    it.each([
        ["empty feature list", []],
        ["null feature list", null],
        ["feature list containing null", ["IF", null]],
        ["feature list containing an unsupported feature", ["NOT_A_FEATURE"]],
    ] as const)("rejects %s", async (_label, features) => {
        const [result] = await evaluatePythonFeatures(features as unknown as PythonFeature[], forAndIf);
        expect(result?.passed).toBe(false);
        expect(result?.reason).toMatch(/features/i);
    });

    it.each(["", "   ", "\n\n", "# only a comment\n"])("returns false for empty or comment-only code: %j", async (source) => {
        expect(await matchesPythonFeatures(["FOR"], source)).toBe(false);
    });

    it("returns false for a null source string at the analyzer boundary", async () => {
        const analysis = await analyzePythonFeatures(null as unknown as string, ["IF", "FOR"]);
        expect(analysis.error).toBeUndefined();
        expect(analysis.features.has("IF")).toBe(false);
        expect(analysis.features.has("FOR")).toBe(false);
    });

    it.each([
        "for i in range(3)\n    print(i)\n",
        "if x ==:\n    pass\n",
        "def broken(:\n    pass\n",
        "for i in range(3):\n    print(i)\nif :\n",
    ])("fails closed on syntax errors even when valid features precede them", async (source) => {
        const [forResults, ifResults] = await Promise.all([
            evaluatePythonFeatures(["FOR"], source),
            evaluatePythonFeatures(["IF"], source),
        ]);
        const forResult = forResults[0];
        const ifResult = ifResults[0];
        expect(forResult?.passed).toBe(false);
        expect(ifResult?.passed).toBe(false);
    });

    it("does not invert analyzer errors for MUST_NOT_HAVE", async () => {
        const mustNotHave = {
            id: "must-not-have",
            type: "pythonFeature",
            constraint: "MUST_NOT_HAVE",
            message: "",
            params: { features: ["FOR"] },
        } as const;
        const [result] = await evaluateRules([mustNotHave], { language: "Python", sourceText: "for item in items:\n    pass" });
        const invalid = { ...mustNotHave, params: { features: ["NOPE"] } } as unknown as SpecialRule;
        const [invalidResult] = await evaluateRules([invalid], { language: "Python", sourceText: "pass" });
        expect(result?.passed).toBe(false);
        expect(invalidResult?.passed).toBe(false);
    });
});

describe("Python rule API: reference checkDetail equivalents", () => {
    it("reports detected features for a fully matching requested set", async () => {
        const analysis = await analyzePythonFeatures(forAndIf, ["IF", "FOR"]);
        expect(analysis.error).toBeUndefined();
        expect(analysis.features.has("IF")).toBe(true);
        expect(analysis.features.has("FOR")).toBe(true);
    });

    it("preserves individual answers for partial feature matches", async () => {
        const analysis = await analyzePythonFeatures(forAndIf, ["IF", "FOR", "WHILE"]);
        expect(["IF", "FOR", "WHILE"].map((feature) => analysis.features.has(feature as PythonFeature)))
            .toEqual([true, true, false]);
    });

    it("returns all analyzed features while a rule only checks the requested subset", async () => {
        const analysis = await analyzePythonFeatures(forAndIf, ["IF", "WHILE"]);
        expect(analysis.features.has("IF")).toBe(true);
        expect(analysis.features.has("FOR")).toBe(true);
        expect(analysis.features.has("WHILE")).toBe(false);
        expect(await matchesPythonFeatures(["IF", "WHILE"], forAndIf)).toBe(false);
    });

    it("returns per-feature results only for requested features and in request order", async () => {
        const details = await evaluatePythonFeatureDetails(["WHILE", "IF", "FOR"], forAndIf);
        expect(details.map(({ feature }) => feature)).toEqual(["WHILE", "IF", "FOR"]);
        expect(details.map(({ result }) => result.passed)).toEqual([false, true, true]);
    });

    it("includes duplicate requested features only once in detail results", async () => {
        const details = await evaluatePythonFeatureDetails(["FOR", "IF", "FOR"], forAndIf);
        expect(details.map(({ feature }) => feature)).toEqual(["FOR", "IF"]);
        expect(details.map(({ result }) => result.passed)).toEqual([true, true]);
    });

    it("treats reordered and duplicated feature requests consistently", async () => {
        const forward = await analyzePythonFeatures(forAndIf, ["IF", "FOR"]);
        const reverse = await analyzePythonFeatures(forAndIf, ["FOR", "IF"]);
        const repeated = await analyzePythonFeatures(forAndIf, ["FOR", "IF", "FOR"]);
        expect([...forward.features]).toEqual([...reverse.features]);
        expect([...reverse.features]).toEqual([...repeated.features]);
    });

    it.each(referenceSamples.map((code, index) => [index, code] as const))(
        "keeps aggregate matching equivalent to checking every feature individually (sample %i)",
        async (_index, code) => {
            const allFeatures: PythonFeature[] = ["IF", "FOR", "WHILE", "FUNCTION", "NESTED_LOOP", "RECURSION", "LAMBDA", "LIST", "DICT", "SET", "SORT", "SORTED"];
            const allRequired = await matchesPythonFeatures(allFeatures, code);
            const eachFeature = await Promise.all(allFeatures.map((feature) => matchesPythonFeatures([feature], code)));
            expect(allRequired).toBe(eachFeature.every(Boolean));
        },
    );

    it("fails closed for malformed Python rule configuration", async () => {
        const [result] = await evaluateRules([malformedPythonRule([])], { language: "Python", sourceText: "pass" });
        expect(result?.passed).toBe(false);
    });
});

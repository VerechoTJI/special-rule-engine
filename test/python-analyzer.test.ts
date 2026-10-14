import { describe, expect, it } from "vitest";
import { evaluateRules, evaluateRulesAsync, type PythonFeature, type SpecialRule } from "../src/index.js";

function makeRule(features: PythonFeature[], constraint: "MUST_HAVE" | "MUST_NOT_HAVE" = "MUST_HAVE"): SpecialRule {
    return {
        id: "python-features",
        type: "pythonFeature",
        constraint,
        message: "Python feature requirement",
        params: { features },
    };
}

async function matches(features: PythonFeature[], sourceText: string): Promise<boolean> {
    const [result] = await evaluateRulesAsync([makeRule(features)], { language: "Python", sourceText });
    return result!.passed;
}

describe("Python AST feature rules", () => {
    it.each([
        ["IF", "if ready:\n    pass"],
        ["FOR", "for item in items:\n    pass"],
        ["WHILE", "while ready:\n    break"],
        ["LAMBDA", "f = lambda x: x + 1"],
        ["LIST", "items = [1, 2]"],
        ["DICT", "items = {'a': 1}"],
        ["SET", "items = {1, 2}"],
        ["SORT", "items.sort()"],
        ["SORTED", "items = sorted(values)"],
    ] as const)("detects %s from Python syntax", async (feature, source) => {
        expect(await matches([feature], source)).toBe(true);
    });

    it("detects built in container constructors", async () => {
        expect(await matches(["LIST", "DICT", "SET"], "a = list()\nb = dict()\nc = set()" )).toBe(true);
    });

    it("ignores feature keywords inside comments and string literals", async () => {
        expect(await matches(["FOR"], "# for item in items: \ntext = 'for item in items:'")).toBe(false);
    });

    it("detects syntactically nested loops including Python indentation and comprehensions", async () => {
        expect(await matches(["NESTED_LOOP"], "for x in xs:\n    while ready:\n        pass")).toBe(true);
        expect(await matches(["NESTED_LOOP"], "pairs = [(x, y) for x in xs for y in ys]")).toBe(true);
    });

    it("only analyzes a function body when the function is reachable from top-level code", async () => {
        expect(await matches(["FUNCTION"], "x = 1\ndef unused():\n    for item in items:\n        pass")).toBe(false);
        expect(await matches(["FOR"], "x = 1\ndef unused():\n    for item in items:\n        pass")).toBe(false);
        expect(await matches(["FOR"], "def used():\n    for item in items:\n        pass\nused()")).toBe(true);
    });

    it("analyzes definitions-only files as libraries", async () => {
        expect(await matches(["FOR"], "def helper():\n    for item in items:\n        pass")).toBe(true);
    });

    it("detects recursion in called functions and ignores shadowed self names", async () => {
        expect(await matches(["RECURSION"], "def walk(n):\n    if n:\n        walk(n - 1)\nwalk(3)")).toBe(true);
        expect(await matches(["RECURSION"], "def walk(walk):\n    walk()\nwalk(lambda: None)")).toBe(false);
        expect(await matches(["RECURSION"], "def walk(n):\n    walk = lambda: None\n    walk()\nwalk(3)")).toBe(false);
        expect(await matches(["RECURSION"], "def walk():\n    global walk\n    walk()\nwalk()")).toBe(true);
    });

    it("ignores statements after a return in the same block", async () => {
        expect(await matches(["FOR"], "def f():\n    return\n    for item in items:\n        pass\nf()")).toBe(false);
    });

    it("treats constant-false while loops as unreachable", async () => {
        expect(await matches(["WHILE"], "while False:\n    pass")).toBe(false);
    });

    it("returns a failed rule with a syntax error reason for invalid Python", async () => {
        const [result] = await evaluateRulesAsync([makeRule(["FOR"])], {
            language: "python",
            sourceText: "def broken(:\n    pass",
        });
        expect(result?.passed).toBe(false);
        expect(result?.reason).toMatch(/syntax/i);
    });

    it("does not invert AST or rule configuration errors for MUST_NOT_HAVE", async () => {
        const invalidCode = makeRule(["FOR"], "MUST_NOT_HAVE");
        const invalidFeature = { ...makeRule(["FOR"], "MUST_NOT_HAVE"), params: { features: ["NOT_A_FEATURE"] } } as unknown as SpecialRule;
        const [syntaxErrorResult] = await evaluateRulesAsync([invalidCode], {
            language: "python",
            sourceText: "def broken(:\n    pass",
        });
        const [invalidFeatureResult] = await evaluateRulesAsync([invalidFeature], {
            language: "python",
            sourceText: "pass",
        });
        expect(syntaxErrorResult?.passed).toBe(false);
        expect(invalidFeatureResult?.passed).toBe(false);
        expect(invalidFeatureResult?.reason).toMatch(/features/i);
    });

    it("requires a non-empty supported feature list", async () => {
        const rule = { ...makeRule(["FOR"]), params: { features: [] } };
        const [result] = await evaluateRulesAsync([rule], { language: "python", sourceText: "pass" });
        expect(result?.passed).toBe(false);
        expect(result?.reason).toMatch(/features/i);
    });

    it("supports MUST_NOT_HAVE and requires every listed feature", async () => {
        const rules = [makeRule(["FOR"], "MUST_NOT_HAVE"), makeRule(["FOR", "WHILE"])];
        const results = await evaluateRulesAsync(rules, { language: "python", sourceText: "for x in xs:\n    pass" });
        expect(results.map((result) => result.passed)).toEqual([false, false]);
    });

    it("supports Python AST matchers inside nested composite rules", async () => {
        const rule: SpecialRule = {
            id: "combined",
            type: "composite",
            constraint: "MUST_HAVE",
            message: "Use a loop and either sorting form",
            params: {
                op: "AND",
                rules: [
                    { id: "loop", type: "pythonFeature", constraint: "MUST_HAVE", message: "", params: { features: ["FOR"] } },
                    {
                        id: "sort",
                        type: "composite",
                        constraint: "MUST_HAVE",
                        message: "",
                        params: {
                            op: "OR",
                            rules: [
                                { id: "sort-method", type: "pythonFeature", constraint: "MUST_HAVE", message: "", params: { features: ["SORT"] } },
                                { id: "sorted-call", type: "pythonFeature", constraint: "MUST_HAVE", message: "", params: { features: ["SORTED"] } },
                            ],
                        },
                    },
                ],
            },
        };

        const [result] = await evaluateRulesAsync([rule], {
            language: "python",
            sourceText: "for item in items:\n    result = sorted(items)",
        });
        expect(result?.passed).toBe(true);
    });

    it("does not invoke Python parsing for non-Python language rules", async () => {
        const rule = makeRule(["FOR"]);
        const [result] = await evaluateRulesAsync([rule], { language: "javascript", sourceText: "for (;;) {}" });
        expect(result?.passed).toBe(false);
        expect(result?.reason).toMatch(/Python/i);
    });

    it("keeps Python AST evaluation out of the synchronous API and fails closed", () => {
        const [result] = evaluateRules([makeRule(["FOR"], "MUST_NOT_HAVE")], {
            language: "python",
            sourceText: "for item in items:\n    pass",
        });
        expect(result?.passed).toBe(false);
        expect(result?.reason).toMatch(/unknown rule type/i);
    });

    it("fails closed for invalid legacy matcher configuration under MUST_NOT_HAVE", () => {
        const invalidRegex: SpecialRule = {
            id: "invalid-regex",
            type: "regex",
            constraint: "MUST_NOT_HAVE",
            message: "Invalid rule must not pass",
            params: { pattern: "[" },
        };
        const [result] = evaluateRules([invalidRegex], { language: "python", sourceText: "pass" });
        expect(result?.passed).toBe(false);
        expect(result?.reason).toMatch(/invalid regex/i);
    });
});

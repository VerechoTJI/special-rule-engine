import { describe, expect, it } from "vitest";
import { evaluateRules, evaluateRulesAsync, type SpecialRule } from "../src/index.js";
import { makePythonRule } from "./helpers/python-feature.js";

describe("Python AST rule integration", () => {
    it("supports MUST_NOT_HAVE and fails closed on invalid rules", async () => {
        const present = makePythonRule(["FOR"], "MUST_NOT_HAVE");
        const invalid = { ...present, params: { features: ["NOT_A_FEATURE"] } } as unknown as SpecialRule;
        const [presentResult, invalidRuleResult] = await evaluateRulesAsync(
            [present, invalid],
            { language: "python", sourceText: "for item in items:\n    pass" },
        );
        expect(presentResult?.passed).toBe(false);
        const [noForResult] = await evaluateRulesAsync([makePythonRule(["FOR"], "MUST_NOT_HAVE")], {
            language: "python",
            sourceText: "print('no loop')",
        });
        expect(noForResult?.passed).toBe(true);
        expect(invalidRuleResult?.passed).toBe(false);
    });

    it("supports Python AST matchers inside nested composite rules", async () => {
        const rule: SpecialRule = {
            id: "combined",
            type: "composite",
            constraint: "MUST_HAVE",
            message: "",
            params: {
                op: "AND",
                rules: [
                    makePythonRule(["FOR"]),
                    {
                        id: "sort-choice",
                        type: "composite",
                        constraint: "MUST_HAVE",
                        message: "",
                        params: {
                            op: "OR",
                            rules: [makePythonRule(["SORT"]), makePythonRule(["SORTED"])],
                        },
                    },
                ],
            },
        };
        const [result] = await evaluateRulesAsync([rule], {
            language: "Python",
            sourceText: "for item in items:\n    result = sorted(items)",
        });
        expect(result?.passed).toBe(true);
    });

    it("rejects Python AST rules for non-Python source", async () => {
        const [result] = await evaluateRulesAsync([makePythonRule(["FOR"])], {
            language: "javascript",
            sourceText: "for (;;) {}",
        });
        expect(result?.passed).toBe(false);
        expect(result?.reason).toMatch(/Python/i);
    });

    it("keeps asynchronous Python evaluation out of the synchronous API", () => {
        const [result] = evaluateRules([makePythonRule(["FOR"], "MUST_NOT_HAVE")], {
            language: "Python",
            sourceText: "for item in items:\n    pass",
        });
        expect(result?.passed).toBe(false);
        expect(result?.reason).toMatch(/unknown rule type/i);
    });

    it("does not invert invalid legacy matcher errors under MUST_NOT_HAVE", () => {
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

    it("reports a syntax error reason and never passes malformed Python", async () => {
        const [result] = await evaluateRulesAsync([makePythonRule(["FOR"])], {
            language: "python",
            sourceText: "def broken(:\n    pass",
        });
        expect(result?.passed).toBe(false);
        expect(result?.reason).toMatch(/syntax/i);
    });
});

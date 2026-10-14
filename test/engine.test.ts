import { describe, expect, it } from "vitest";
import type { SpecialRule } from "../src/types";
import { evaluateRules } from "../src/engine";

describe("rule engine (v1)", () => {
    it("MUST_HAVE use passes when target exists", async () => {
        const rules: SpecialRule[] = [
            {
                id: "r1",
                type: "use",
                constraint: "MUST_HAVE",
                message: "must include printf",
                params: { target: "printf" },
            },
        ];

        const results = await evaluateRules(rules, {
            language: "c",
            sourceText: "int main(){ printf(\"hi\"); }",
        });

        expect(results[0]?.passed).toBe(true);
    });

    it("MUST_NOT_HAVE regex passes when pattern does not match", async () => {
        const rules: SpecialRule[] = [
            {
                id: "r1",
                type: "regex",
                constraint: "MUST_NOT_HAVE",
                message: "must not use for-loop",
                params: { pattern: "\\bfor\\b" },
            },
        ];

        const results = await evaluateRules(rules, {
            language: "c",
            sourceText: "while(1){}",
        });

        expect(results[0]?.passed).toBe(true);
    });

    it("composite AND obeys child matching (as a matcher)", async () => {
        const rules: SpecialRule[] = [
            {
                id: "r-and",
                type: "composite",
                constraint: "MUST_HAVE",
                message: "must have both a and b",
                params: {
                    op: "AND",
                    rules: [
                        {
                            id: "a",
                            type: "use",
                            constraint: "MUST_HAVE",
                            message: "a",
                            params: { target: "aaa" },
                        },
                        {
                            id: "b",
                            type: "use",
                            constraint: "MUST_HAVE",
                            message: "b",
                            params: { target: "bbb" },
                        },
                    ],
                },
            },
        ];

        const results = await evaluateRules(rules, {
            language: "javascript",
            sourceText: "// aaa\nconst x = 'aaa bbb';",
        });

        expect(results[0]?.passed).toBe(true);
    });

    it("composite OR passes when at least one child matches", async () => {
        const rules: SpecialRule[] = [
            {
                id: "r-or",
                type: "composite",
                constraint: "MUST_HAVE",
                message: "must have either a or b",
                params: {
                    op: "OR",
                    rules: [
                        {
                            id: "a",
                            type: "use",
                            constraint: "MUST_HAVE",
                            message: "a",
                            params: { target: "aaa" },
                        },
                        {
                            id: "b",
                            type: "use",
                            constraint: "MUST_HAVE",
                            message: "b",
                            params: { target: "bbb" },
                        },
                    ],
                },
            },
        ];

        const results = await evaluateRules(rules, {
            language: "javascript",
            sourceText: "const x = 'bbb';",
        });

        expect(results[0]?.passed).toBe(true);
    });

    it("MUST_NOT_HAVE use fails when target exists", async () => {
        const rules: SpecialRule[] = [
            {
                id: "r-no",
                type: "use",
                constraint: "MUST_NOT_HAVE",
                message: "must not include eval",
                params: { target: "eval" },
            },
        ];

        const results = await evaluateRules(rules, {
            language: "javascript",
            sourceText: "eval('1+1');",
        });

        expect(results[0]?.passed).toBe(false);
    });

    it("invalid regex reports failure reason and obeys constraint", async () => {
        const rules: SpecialRule[] = [
            {
                id: "r-bad",
                type: "regex",
                constraint: "MUST_HAVE",
                message: "broken regex should fail",
                params: { pattern: "[" },
            },
        ];

        const results = await evaluateRules(rules, {
            language: "javascript",
            sourceText: "const x = 1;",
        });

        expect(results[0]?.passed).toBe(false);
        expect(results[0]?.reason).toMatch(/invalid regex/i);
    });

    type Case = {
        name: string;
        rule: SpecialRule;
        ctx: { language: string; sourceText: string };
        expectedPassed: boolean;
    };

    // Coverage matrix: (type × constraint)
    // - includes: MUST_HAVE/MUST_NOT_HAVE
    // - regex: MUST_HAVE/MUST_NOT_HAVE
    // - composite: MUST_HAVE/MUST_NOT_HAVE (composite matcher ignores child constraints; evaluator applies only top-level constraint)
    const cases: Case[] = [
        {
            name: "includes + MUST_HAVE: passes when present",
            rule: {
                id: "inc-have-pass",
                type: "use",
                constraint: "MUST_HAVE",
                message: "",
                params: { target: "printf" },
            },
            ctx: { language: "c", sourceText: "int main(){ printf(\"hi\"); }" },
            expectedPassed: true,
        },
        {
            name: "includes + MUST_HAVE: fails when missing",
            rule: {
                id: "inc-have-fail",
                type: "use",
                constraint: "MUST_HAVE",
                message: "",
                params: { target: "printf" },
            },
            ctx: { language: "c", sourceText: "int main(){ return 0; }" },
            expectedPassed: false,
        },
        {
            name: "includes + MUST_NOT_HAVE: passes when missing",
            rule: {
                id: "inc-not-pass",
                type: "use",
                constraint: "MUST_NOT_HAVE",
                message: "",
                params: { target: "eval" },
            },
            ctx: { language: "javascript", sourceText: "const x = 1;" },
            expectedPassed: true,
        },
        {
            name: "includes + MUST_NOT_HAVE: fails when present",
            rule: {
                id: "inc-not-fail",
                type: "use",
                constraint: "MUST_NOT_HAVE",
                message: "",
                params: { target: "eval" },
            },
            ctx: { language: "javascript", sourceText: "eval('1+1');" },
            expectedPassed: false,
        },

        {
            name: "regex + MUST_HAVE: passes when matches",
            rule: {
                id: "re-have-pass",
                type: "regex",
                constraint: "MUST_HAVE",
                message: "",
                params: { pattern: "\\bwhile\\b" },
            },
            ctx: { language: "c", sourceText: "while(1){}" },
            expectedPassed: true,
        },
        {
            name: "regex + MUST_HAVE: fails when not matched",
            rule: {
                id: "re-have-fail",
                type: "regex",
                constraint: "MUST_HAVE",
                message: "",
                params: { pattern: "\\bfor\\b" },
            },
            ctx: { language: "c", sourceText: "while(1){}" },
            expectedPassed: false,
        },
        {
            name: "regex + MUST_NOT_HAVE: passes when not matched",
            rule: {
                id: "re-not-pass",
                type: "regex",
                constraint: "MUST_NOT_HAVE",
                message: "",
                params: { pattern: "\\bfor\\b" },
            },
            ctx: { language: "c", sourceText: "while(1){}" },
            expectedPassed: true,
        },
        {
            name: "regex + MUST_NOT_HAVE: fails when matches",
            rule: {
                id: "re-not-fail",
                type: "regex",
                constraint: "MUST_NOT_HAVE",
                message: "",
                params: { pattern: "\\bfor\\b" },
            },
            ctx: { language: "c", sourceText: "for(;;){}" },
            expectedPassed: false,
        },

        {
            name: "composite(AND) + MUST_HAVE: passes when all children match",
            rule: {
                id: "cmp-and-have-pass",
                type: "composite",
                constraint: "MUST_HAVE",
                message: "",
                params: {
                    op: "AND",
                    rules: [
                        { id: "a", type: "use", constraint: "MUST_HAVE", message: "", params: { target: "aaa" } },
                        { id: "b", type: "use", constraint: "MUST_HAVE", message: "", params: { target: "bbb" } },
                    ],
                },
            },
            ctx: { language: "javascript", sourceText: "const s = 'aaa bbb';" },
            expectedPassed: true,
        },
        {
            name: "composite(AND) + MUST_HAVE: fails when a child is missing",
            rule: {
                id: "cmp-and-have-fail",
                type: "composite",
                constraint: "MUST_HAVE",
                message: "",
                params: {
                    op: "AND",
                    rules: [
                        { id: "a", type: "use", constraint: "MUST_HAVE", message: "", params: { target: "aaa" } },
                        { id: "b", type: "use", constraint: "MUST_HAVE", message: "", params: { target: "bbb" } },
                    ],
                },
            },
            ctx: { language: "javascript", sourceText: "const s = 'aaa';" },
            expectedPassed: false,
        },
        {
            name: "composite(OR) + MUST_NOT_HAVE: passes when no child matches",
            rule: {
                id: "cmp-or-not-pass",
                type: "composite",
                constraint: "MUST_NOT_HAVE",
                message: "",
                params: {
                    op: "OR",
                    rules: [
                        { id: "a", type: "use", constraint: "MUST_HAVE", message: "", params: { target: "aaa" } },
                        { id: "b", type: "use", constraint: "MUST_HAVE", message: "", params: { target: "bbb" } },
                    ],
                },
            },
            ctx: { language: "javascript", sourceText: "const s = 'ccc';" },
            expectedPassed: true,
        },
        {
            name: "composite(OR) + MUST_NOT_HAVE: fails when any child matches",
            rule: {
                id: "cmp-or-not-fail",
                type: "composite",
                constraint: "MUST_NOT_HAVE",
                message: "",
                params: {
                    op: "OR",
                    rules: [
                        { id: "a", type: "use", constraint: "MUST_HAVE", message: "", params: { target: "aaa" } },
                        { id: "b", type: "use", constraint: "MUST_HAVE", message: "", params: { target: "bbb" } },
                    ],
                },
            },
            ctx: { language: "javascript", sourceText: "const s = 'bbb';" },
            expectedPassed: false,
        },
    ];

    it.each(cases)("matrix: $name", async ({ rule, ctx, expectedPassed }) => {
        const [result] = await evaluateRules([rule], ctx);
        expect(result?.passed).toBe(expectedPassed);
    });

    it("nested composite works (AND containing OR)", async () => {
        const rule: SpecialRule = {
            id: "nested",
            type: "composite",
            constraint: "MUST_HAVE",
            message: "",
            params: {
                op: "AND",
                rules: [
                    {
                        id: "outer-a",
                        type: "use",
                        constraint: "MUST_HAVE",
                        message: "",
                        params: { target: "aaa" },
                    },
                    {
                        id: "outer-or",
                        type: "composite",
                        constraint: "MUST_HAVE",
                        message: "",
                        params: {
                            op: "OR",
                            rules: [
                                {
                                    id: "b",
                                    type: "use",
                                    constraint: "MUST_HAVE",
                                    message: "",
                                    params: { target: "bbb" },
                                },
                                {
                                    id: "c",
                                    type: "use",
                                    constraint: "MUST_HAVE",
                                    message: "",
                                    params: { target: "ccc" },
                                },
                            ],
                        },
                    },
                ],
            },
        };

        const [resultPass] = await evaluateRules([rule], {
            language: "javascript",
            sourceText: "const s = 'aaa ccc';",
        });
        expect(resultPass?.passed).toBe(true);

        const [resultFail] = await evaluateRules([rule], {
            language: "javascript",
            sourceText: "const s = 'aaa ddd';",
        });
        expect(resultFail?.passed).toBe(false);
    });
});

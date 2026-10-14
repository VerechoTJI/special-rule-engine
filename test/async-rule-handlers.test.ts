import { describe, expect, it } from "vitest";
import {
    defaultRuleHandlerRegistry,
    evaluateRules,
    type AsyncRuleHandler,
    type SpecialRule,
} from "../src/index.js";

type FixtureParams = { feature: string };
type FixtureState = Set<string>;

describe("extensible async rule handlers", () => {
    it("adds a prepared feature handler without changing the evaluator and supports nested composites", async () => {
        let prepareCalls = 0;
        const fixtureHandler: AsyncRuleHandler<FixtureState> = {
            type: "fixtureFeature",
            prepare(rules, context) {
                prepareCalls += 1;
                const source = context.sourceText.toLowerCase();
                return new Set(
                    rules
                        .map((rule) => (rule.params as FixtureParams).feature)
                        .filter((feature) => source.includes(feature.toLowerCase())),
                );
            },
            match(rule, _input, detected) {
                const { feature } = rule.params as FixtureParams;
                return {
                    matched: detected.has(feature),
                    reason: detected.has(feature) ? `fixture: found ${feature}` : `fixture: missing ${feature}`,
                };
            },
        };
        const rules: SpecialRule[] = [{
            id: "combined",
            type: "composite",
            constraint: "MUST_HAVE",
            message: "",
            params: {
                op: "AND",
                rules: [
                    { id: "alpha", type: "fixtureFeature", constraint: "MUST_HAVE", message: "", params: { feature: "alpha" } },
                    {
                        id: "either",
                        type: "composite",
                        constraint: "MUST_HAVE",
                        message: "",
                        params: {
                            op: "OR",
                            rules: [
                                { id: "beta", type: "fixtureFeature", constraint: "MUST_HAVE", message: "", params: { feature: "beta" } },
                                { id: "gamma", type: "fixtureFeature", constraint: "MUST_HAVE", message: "", params: { feature: "gamma" } },
                                { id: "lambda", type: "pythonFeature", constraint: "MUST_HAVE", message: "", params: { features: ["LAMBDA"] } },
                            ],
                        },
                    },
                ],
            },
        }];

        const registry = defaultRuleHandlerRegistry.with(fixtureHandler);
        const [result] = await evaluateRules(rules, {
            language: "Python",
            sourceText: "lambda value: value\nALPHA and beta",
        }, { ruleHandlers: registry });

        expect(result?.passed).toBe(true);
        expect(prepareCalls).toBe(1);
        expect(defaultRuleHandlerRegistry.has("fixtureFeature")).toBe(false);
    });

    it("fails closed when a registered handler reports an analysis error", async () => {
        const handler: AsyncRuleHandler = {
            type: "brokenFeature",
            prepare: () => {
                throw new Error("fixture parse failure");
            },
            match: () => ({ matched: false }),
        };
        const rule: SpecialRule = {
            id: "broken",
            type: "brokenFeature",
            constraint: "MUST_NOT_HAVE",
            message: "",
            params: {},
        };
        const [result] = await evaluateRules([rule], {
            language: "fixture",
            sourceText: "anything",
        }, { ruleHandlers: defaultRuleHandlerRegistry.with(handler) });

        expect(result?.passed).toBe(false);
        expect(result?.reason).toMatch(/fixture parse failure/);
    });
});

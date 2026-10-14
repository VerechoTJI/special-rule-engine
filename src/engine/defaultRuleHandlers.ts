import { pythonFeatureRuleHandler } from "../python/ruleHandler.js";
import { RuleHandlerRegistry } from "./ruleHandlers.js";

/** Default language rule handlers. Add new language modules here, without changing engine evaluation. */
export const defaultRuleHandlerRegistry = new RuleHandlerRegistry([
    pythonFeatureRuleHandler,
]);

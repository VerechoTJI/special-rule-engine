# special-rule-engine

A small, pure-TypeScript rule evaluation engine for NTUT Exam System.

## Goals

- Works in Node.js, Vite (web), and Electron.
- Python feature rules use the bundled Tree-sitter Python WASM grammar.
- Rules come from exam config (`globalSpecialRules` + per-puzzle `specialRules`).

## install metho (npm command):

```bash
npm install git+https://github.com/VerechoTJI/special-rule-engine.git
```
**Note**:
if you are using pnpm you should add the following script in your package
```json
"pnpm": {
    "onlyBuiltDependencies": [
      "special-rule-engine"
    ]
  }
```

## Rule types (v1)

- `includes`
- `regex`
- `composite` (`AND` / `OR`)
- `pythonFeature` (asynchronous Python syntax analysis)

### Python feature rules

`evaluateRule` and `evaluateRules` are asynchronous so every rule type uses one evaluation path. Python AST analysis loads the Tree-sitter WebAssembly runtime and grammar asynchronously; other rule types use the same API:

```ts
const results = await evaluateRules(
  [{
    id: "require-loop",
    type: "pythonFeature",
    constraint: "MUST_HAVE",
    message: "Use a loop",
    params: { features: ["FOR"] },
  }],
  { language: "Python", sourceText: "for item in items:\n    print(item)" },
);
```

Supported features: `IF`, `FOR`, `WHILE`, `FUNCTION`, `NESTED_LOOP`, `RECURSION`, `LAMBDA`, `LIST`, `DICT`, `SET`, `SORT`, and `SORTED`. Every feature in `params.features` must be found for a match. Syntax or rule errors fail the rule, including under `MUST_NOT_HAVE`.

The Python grammar WASM is bundled at `wasm/tree-sitter-python.wasm` (Tree-sitter Python v0.25.0, parser ABI 15). Its license is included in `LICENSES/tree-sitter-python.txt`.

### Adding an async language rule handler

Language-specific analysis lives in a handler instead of the rule evaluator. A handler can prepare shared analysis once for all rules of its type, including rules nested inside composites, then match each rule against that result. Extend the defaults with an immutable registry:

```ts
const ruleHandlers = defaultRuleHandlerRegistry.with({
  type: "myLanguageFeature",
  prepare: (rules, context) => analyzeMyLanguage(context.sourceText, rules),
  match: (rule, _input, analysis) => matchMyLanguageRule(rule, analysis),
});

const results = await evaluateRules(rules, context, { ruleHandlers });
```

`defaultRuleHandlerRegistry` already includes the Python feature handler. The engine handles handler lookup, one-time preparation, composite traversal, and fail-closed results; new analyzers implement only their own `prepare` and `match` behavior.

## Development

- Install dependencies: `npm install`
- Run tests: `npm test`
- Build types + JS: `npm run build`

```

```

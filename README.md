# special-rule-engine

A small, pure-TypeScript rule evaluation engine for NTUT Exam System.

## Goals

- Works in Node.js, Vite (web), and Electron.
- No AST yet (v1).
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

## Development

- Install dependencies: `npm install`
- Run tests: `npm test`
- Build types + JS: `npm run build`

```

```

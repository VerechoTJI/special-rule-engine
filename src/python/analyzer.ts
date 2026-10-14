import { Language, Parser, type Node } from "web-tree-sitter";
import type { PythonFeature } from "./types.js";

type FeatureAnalysis = { features: Set<PythonFeature>; error?: string };
type State = {
    found: Set<PythonFeature>;
    referenced: Set<string>;
    classNames: Set<string>;
    liveDefs: Map<string, Node[]>;
};

const TERMINATORS = new Set(["return_statement", "raise_statement", "break_statement", "continue_statement"]);
const requestedFeatures = new Set<PythonFeature>([
    "IF", "FOR", "WHILE", "FUNCTION", "NESTED_LOOP", "RECURSION", "LAMBDA",
    "LIST", "DICT", "SET", "SORT", "SORTED",
]);

let languagePromise: Promise<Language> | undefined;

async function getPythonLanguage(): Promise<Language> {
    languagePromise ??= (async () => {
        await Parser.init();
        const grammarUrl = new URL("../../wasm/tree-sitter-python.wasm", import.meta.url);
        const grammarLocation = grammarUrl.protocol === "file:"
            ? decodeURIComponent(grammarUrl.pathname).replace(/^\/([A-Za-z]:\/)/, "$1")
            : grammarUrl.href;
        return Language.load(grammarLocation);
    })();
    return languagePromise;
}

function namedChildren(node: Node): Node[] {
    return node.namedChildren.filter((child): child is Node => child !== null);
}

function isConstantFalse(node: Node): boolean {
    if (["false", "none"].includes(node.type)) return true;
    if (node.type === "integer") return node.text === "0";
    if (node.type === "parenthesized_expression") {
        const children = namedChildren(node);
        return children.length === 1 && isConstantFalse(children[0]!);
    }
    return false;
}

function isDefinitionsOnly(root: Node): boolean {
    for (const statement of namedChildren(root)) {
        switch (statement.type) {
            case "function_definition":
            case "class_definition":
            case "decorated_definition":
            case "import_statement":
            case "import_from_statement":
            case "future_import_statement":
            case "comment":
                break;
            case "expression_statement": {
                const children = namedChildren(statement);
                if (!(children.length === 1 && children[0]!.type === "string")) return false;
                break;
            }
            default:
                return false;
        }
    }
    return true;
}

function functionName(node: Node): string | undefined {
    return node.childForFieldName("name")?.text;
}

function analyzeFunction(node: Node, state: State): void {
    state.found.add("FUNCTION");
    const name = functionName(node);
    const body = node.childForFieldName("body");
    if (!body) return;

    const calls = new Set<string>();
    walkLive(body, 0, state, calls);
    if (name && calls.has(name) && !isShadowed(node, body, name)) {
        state.found.add("RECURSION");
    }
}

function isShadowed(node: Node, body: Node, name: string): boolean {
    const parameters = node.childForFieldName("parameters");
    if (parameters && hasParameterNamed(parameters, name)) return true;
    const declaredOuter = anyInScope(body, (candidate) => declaresOuterName(candidate, name));
    return !declaredOuter && anyInScope(body, (candidate) => bindsName(candidate, name));
}

function anyInScope(node: Node, predicate: (candidate: Node) => boolean): boolean {
    for (const child of namedChildren(node)) {
        if (predicate(child)) return true;
        if (child.type === "function_definition" || child.type === "class_definition") continue;
        if (anyInScope(child, predicate)) return true;
    }
    return false;
}

function declaresOuterName(node: Node, name: string): boolean {
    if (node.type !== "global_statement" && node.type !== "nonlocal_statement") return false;
    return namedChildren(node).some((child) => child.text === name);
}

function bindsName(node: Node, name: string): boolean {
    if (["assignment", "augmented_assignment", "for_statement"].includes(node.type)) {
        const target = node.childForFieldName("left");
        return target ? targetHasName(target, name) : false;
    }
    if (["named_expression", "function_definition", "class_definition"].includes(node.type)) {
        return node.childForFieldName("name")?.text === name;
    }
    return false;
}

function targetHasName(target: Node, name: string): boolean {
    if (target.type === "identifier") return target.text === name;
    if (["pattern_list", "tuple_pattern", "list_pattern", "list_splat_pattern"].includes(target.type)) {
        return namedChildren(target).some((child) => targetHasName(child, name));
    }
    return false;
}

function firstIdentifier(node: Node): Node | null {
    if (node.type === "identifier") return node;
    return namedChildren(node)[0] ? firstIdentifier(namedChildren(node)[0]!) : null;
}

function hasParameterNamed(parameters: Node, name: string): boolean {
    return namedChildren(parameters).some((parameter) => {
        let target: Node | null = null;
        switch (parameter.type) {
            case "identifier":
                target = parameter;
                break;
            case "default_parameter":
            case "typed_default_parameter":
                target = parameter.childForFieldName("name");
                break;
            case "typed_parameter":
            case "list_splat_pattern":
            case "dictionary_splat_pattern":
                target = firstIdentifier(parameter);
                break;
        }
        return target?.text === name;
    });
}

function recordCall(node: Node, scopeCalls: Set<string>): void {
    const callee = node.childForFieldName("function");
    if (!callee) return;
    if (callee.type === "identifier") {
        scopeCalls.add(callee.text);
    } else if (callee.type === "attribute") {
        const object = callee.childForFieldName("object");
        const attribute = callee.childForFieldName("attribute");
        if (object && attribute && ["self", "cls"].includes(object.text)) scopeCalls.add(attribute.text);
    }
}

function recordBuiltinCall(node: Node, state: State): void {
    const callee = node.childForFieldName("function");
    if (!callee) return;
    if (callee.type === "identifier") {
        const builtins: Record<string, PythonFeature> = { list: "LIST", dict: "DICT", set: "SET", sorted: "SORTED" };
        const feature = builtins[callee.text];
        if (feature) state.found.add(feature);
    } else if (callee.type === "attribute" && callee.childForFieldName("attribute")?.text === "sort") {
        state.found.add("SORT");
    }
}

function walkLive(node: Node, loopDepth: number, state: State, scopeCalls: Set<string>): void {
    let nextDepth = loopDepth;
    switch (node.type) {
        case "module":
        case "block":
            walkStatements(node, loopDepth, state, scopeCalls);
            return;
        case "function_definition": {
            const name = functionName(node);
            if (name) state.liveDefs.set(name, [...(state.liveDefs.get(name) ?? []), node]);
            return;
        }
        case "class_definition": {
            const name = functionName(node);
            if (name) state.classNames.add(name);
            for (const child of namedChildren(node)) {
                if (child.type !== "identifier" || child.startIndex !== node.childForFieldName("name")?.startIndex) {
                    walkLive(child, loopDepth, state, scopeCalls);
                }
            }
            return;
        }
        case "identifier":
            state.referenced.add(node.text);
            break;
        case "call":
            recordCall(node, scopeCalls);
            recordBuiltinCall(node, state);
            break;
        case "lambda": state.found.add("LAMBDA"); break;
        case "list": state.found.add("LIST"); break;
        case "set": state.found.add("SET"); break;
        case "dictionary": state.found.add("DICT"); break;
        case "if_statement":
        case "conditional_expression":
        case "if_clause": state.found.add("IF"); break;
        case "for_statement":
            state.found.add("FOR");
            if (loopDepth > 0) state.found.add("NESTED_LOOP");
            nextDepth = loopDepth + 1;
            break;
        case "while_statement":
            if (node.childForFieldName("condition") && isConstantFalse(node.childForFieldName("condition")!)) return;
            state.found.add("WHILE");
            if (loopDepth > 0) state.found.add("NESTED_LOOP");
            nextDepth = loopDepth + 1;
            break;
        case "list_comprehension":
        case "set_comprehension":
        case "dictionary_comprehension":
        case "generator_expression": {
            state.found.add("FOR");
            if (node.type === "list_comprehension") state.found.add("LIST");
            if (node.type === "set_comprehension") state.found.add("SET");
            if (node.type === "dictionary_comprehension") state.found.add("DICT");
            const forClauses = namedChildren(node).filter((child) => child.type === "for_in_clause").length;
            if (loopDepth > 0 || forClauses > 1) state.found.add("NESTED_LOOP");
            nextDepth = loopDepth + 1;
            break;
        }
    }

    for (const child of namedChildren(node)) walkLive(child, nextDepth, state, scopeCalls);
}

function walkStatements(container: Node, loopDepth: number, state: State, scopeCalls: Set<string>): void {
    for (const statement of namedChildren(container)) {
        walkLive(statement, loopDepth, state, scopeCalls);
        if (TERMINATORS.has(statement.type)) break;
    }
}

async function detectFeatures(sourceText: string): Promise<FeatureAnalysis> {
    if (typeof sourceText !== "string" || !sourceText.trim()) return { features: new Set() };

    const language = await getPythonLanguage();
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(sourceText);
    if (!tree) {
        parser.delete();
        return { features: new Set(), error: "Python syntax analysis was cancelled" };
    }

    try {
        const root = tree.rootNode;
        if (root.hasError) return { features: new Set(), error: "Python syntax error" };

        const state: State = {
            found: new Set(),
            referenced: new Set(),
            classNames: new Set(),
            liveDefs: new Map(),
        };
        walkLive(root, 0, state, new Set());
        if (isDefinitionsOnly(root)) {
            for (const name of state.liveDefs.keys()) state.referenced.add(name);
        }

        const analyzed = new Set<number>();
        let changed: boolean;
        do {
            changed = false;
            const used = new Set(state.referenced);
            if ([...state.classNames].some((name) => used.has(name))) used.add("__init__");
            for (const name of used) {
                for (const definition of state.liveDefs.get(name) ?? []) {
                    if (!analyzed.has(definition.startIndex)) {
                        analyzed.add(definition.startIndex);
                        analyzeFunction(definition, state);
                        changed = true;
                    }
                }
            }
        } while (changed);
        return { features: state.found };
    } finally {
        tree.delete();
        parser.delete();
    }
}

export async function analyzePythonFeatures(sourceText: string, requested: unknown): Promise<FeatureAnalysis> {
    if (!Array.isArray(requested) || requested.length === 0 || requested.some((feature) => !requestedFeatures.has(feature))) {
        return { features: new Set(), error: "pythonFeature: params.features must be a non-empty list of supported features" };
    }
    return detectFeatures(sourceText);
}

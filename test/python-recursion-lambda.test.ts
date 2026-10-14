import { describe, expect, it } from "vitest";
import { matchesPythonFeatures } from "./helpers/python-feature.js";

describe("Python analyzer reference: recursion", () => {
    it.each([
        ["detects a called factorial function", "def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\nfactorial(5)", true],
        ["returns false for a non-recursive function", "def add(a, b):\n    return a + b", false],
        ["ignores a recursive-looking comment", "def my_func():\n    # my_func()\n    print('Not recursive')", false],
        ["ignores a recursive-looking string", "def process():\n    print('Calling process() now...')", false],
        ["does not match a similar function name", "def process_all():\n    process()", false],
        ["ignores self-name shadowed by a parameter", "def walk(walk):\n    walk()\nwalk(lambda: None)", false],
        ["ignores self-name shadowed by a local lambda", "def my_func():\n    my_func = lambda: print('local')\n    my_func()\nmy_func()", false],
        ["does not report recursion in an uncalled function in executable code", "def unused_recursive_func(n):\n    if n <= 0:\n        return 0\n    return unused_recursive_func(n - 1)\nprint('main')", false],
        ["detects a recursively defined library function", "def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)", true],
        ["recognizes recursion declared global", "def walk():\n    global walk\n    walk()\nwalk()", true],
        ["detects recursion in a nested helper", "def outer(n):\n    def helper(k):\n        if k <= 0: return 0\n        return helper(k - 1)\n    return helper(n)\nouter(2)", true],
        ["does not confuse recursion with a shadowed local function", "def func():\n    func = lambda: 5\n    return func()\nfunc()", false],
    ] as const)("$0", async (_name, source, expected) => {
        expect(await matchesPythonFeatures(["RECURSION"], source)).toBe(expected);
    });
});

describe("Python analyzer reference: lambda", () => {
    const cases: readonly [string, string, boolean][] = [
        ["detects lambda", "add = lambda x, y: x + y", true],
        ["returns false when no lambda exists", "def add(x, y):\n    return x + y", false],
        ["ignores lambda inside a string", 'msg = "use lambda for quick functions"', false],
        ["ignores lambda inside a comment", "# f = lambda x: x * 2", false],
        ["does not match lambda as an identifier substring", "lambdas_count = 10", false],
        ["detects lambda in a higher-order function", "nums = sorted(data, key=lambda x: x['age'])", true],
    ];

    it.each(cases)("%s", async (_name, source, expected) => {
        expect(await matchesPythonFeatures(["LAMBDA"], source)).toBe(expected);
    });
});

describe("Python analyzer reference: deceptive source boundaries", () => {
    it("ignores keywords hidden in comments and multiline or escaped strings", async () => {
        const source = [
            "# while True: print('while loop in comment')",
            "# def fake_func(): pass",
            'msg1 = "for item in list: if x == 1: print(x)"',
            'msg2 = "lambda x: x + 1"',
            'msg3 = "nums.sort() or sorted(nums)"',
        ].join("\n");
        const features: PythonFeature[] = ["FOR", "WHILE", "IF", "FUNCTION", "LAMBDA", "SORT", "SORTED"];
        expect(await matchesPythonFeatures(features, source)).toBe(false);
    });

    it("handles escaped quotes and multiline strings without false feature detections", async () => {
        const source = [
            "# if x > 0:",
            'multiline_str = """',
            "def fake_func():",
            "    while True:",
            "        for x in y:",
            "            if nested:",
            "                pass",
            '"""',
            'real_var = "Escaped quote \\" if inside string"',
        ].join("\n");
        const features: PythonFeature[] = ["IF", "FOR", "WHILE", "FUNCTION", "NESTED_LOOP", "RECURSION"];
        expect(await matchesPythonFeatures(features, source)).toBe(false);
    });
});

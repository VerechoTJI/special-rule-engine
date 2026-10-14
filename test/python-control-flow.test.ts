import { describe, expect, it } from "vitest";
import type { PythonFeature } from "../src/index.js";
import { matchesPythonFeatures } from "./helpers/python-feature.js";

type Case = { name: string; feature: PythonFeature; source: string; expected: boolean };

const cases: Case[] = [
    { name: "detects a normal if statement", feature: "IF", source: "x = 10\nif x > 5:\n    print(x)", expected: true },
    { name: "returns false without if", feature: "IF", source: "x = 10\nprint(x)", expected: false },
    { name: "ignores if in a string", feature: "IF", source: 'text = "if"', expected: false },
    { name: "ignores if in a comment", feature: "IF", source: "# if x > 10\nprint('hello')", expected: false },
    { name: "detects nested if", feature: "IF", source: "if x > 10:\n    if x > 20:\n        print(x)", expected: true },
    { name: "does not match if in identifiers", feature: "IF", source: "shift_value = 10\nmodify_if_needed = False", expected: false },
    { name: "detects if in a conditional expression", feature: "IF", source: "x = 10 if y > 5 else 0", expected: true },
    { name: "ignores if after return in an uncalled function", feature: "IF", source: "def func():\n    return 42\n    if False:\n        print('never')", expected: false },

    { name: "detects a for statement", feature: "FOR", source: "for i in range(10):\n    print(i)", expected: true },
    { name: "returns false without for", feature: "FOR", source: "x = [1, 2, 3]\nprint(x)", expected: false },
    { name: "ignores for in a string", feature: "FOR", source: 'text = "for your information"', expected: false },
    { name: "ignores for in a comment", feature: "FOR", source: "# for i in range(10):\nprint('done')", expected: false },
    { name: "does not match for in identifiers", feature: "FOR", source: "formatted_str = 'hello'\nforce_flag = True", expected: false },
    { name: "detects for in a list comprehension", feature: "FOR", source: "squares = [x**2 for x in range(10)]", expected: true },
    { name: "ignores for after return in an uncalled function", feature: "FOR", source: "def process():\n    return True\n    for i in range(5):\n        print(i)", expected: false },

    { name: "detects a while statement", feature: "WHILE", source: "count = 0\nwhile count < 5:\n    count += 1", expected: true },
    { name: "returns false without while", feature: "WHILE", source: "count = 5\nprint(count)", expected: false },
    { name: "ignores while in a string", feature: "WHILE", source: 'msg = "stay a while"', expected: false },
    { name: "ignores while in a comment", feature: "WHILE", source: "# while True:\nprint('stopped')", expected: false },
    { name: "does not match while in an identifier", feature: "WHILE", source: "while_loop_running = False", expected: false },
    { name: "ignores a constant-false while", feature: "WHILE", source: "while False:\n    print('unreachable')", expected: false },

    { name: "detects a function definition in a definitions-only module", feature: "FUNCTION", source: "def calculate_sum(a, b):\n    return a + b", expected: true },
    { name: "returns false without a function", feature: "FUNCTION", source: "a = 10\nb = 20\nc = a + b", expected: false },
    { name: "ignores def in a string", feature: "FUNCTION", source: 'text = "def main():"', expected: false },
    { name: "ignores def in a comment", feature: "FUNCTION", source: "# def unused_function():\n#     pass", expected: false },
    { name: "does not match def in identifiers", feature: "FUNCTION", source: "default_timeout = 30\ndefine_var = True", expected: false },
    { name: "detects an unused function in a definitions-only module", feature: "FUNCTION", source: "def unused_helper():\n    print('defined')", expected: true },
    { name: "ignores a function in an executable module when it is never called", feature: "FUNCTION", source: "def unused_helper():\n    pass\nx = 100", expected: false },

    { name: "detects nested for loops", feature: "NESTED_LOOP", source: "for i in range(3):\n    for j in range(3):\n        print(i, j)", expected: true },
    { name: "does not treat sequential loops as nested", feature: "NESTED_LOOP", source: "for i in range(3):\n    print(i)\nfor j in range(3):\n    print(j)", expected: false },
    { name: "ignores a nested-loop-looking comment", feature: "NESTED_LOOP", source: "for i in range(3):\n    # for j in range(3):\n    print(i)", expected: false },
    { name: "ignores loop keywords in a string inside a loop", feature: "NESTED_LOOP", source: 'for i in range(3):\n    msg = "for loop"', expected: false },
    { name: "detects mixed for and while nesting", feature: "NESTED_LOOP", source: "for i in range(5):\n    while check_status():\n        do_work()", expected: true },
    { name: "detects a for inside while", feature: "NESTED_LOOP", source: "while ready:\n    for item in items:\n        pass", expected: true },
    { name: "ignores nested loops after return in an uncalled function", feature: "NESTED_LOOP", source: "def func():\n    return\n    for i in range(5):\n        for j in range(5):\n            print(i, j)", expected: false },
    { name: "detects nested comprehensions", feature: "NESTED_LOOP", source: "matrix = [[x * y for y in range(5)] for x in range(5)]", expected: true },
];

describe("Python analyzer reference: control-flow features", () => {
    it.each(cases)("$name", async ({ feature, source, expected }) => {
        expect(await matchesPythonFeatures([feature], source)).toBe(expected);
    });

    it("detects if, for, while and nested-loop features in modern Python syntax", async () => {
        const features: PythonFeature[] = ["IF", "WHILE"];
        expect(await matchesPythonFeatures(features, "while (n := len(items)) > 0:\n    if n % 2 == 0:\n        items.pop()" )).toBe(true);
    });
});

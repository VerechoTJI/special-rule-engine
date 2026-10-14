import { describe, expect, it } from "vitest";
import type { PythonFeature } from "../src/index.js";
import { matchesPythonFeatures } from "./helpers/python-feature.js";

type Case = { name: string; feature: PythonFeature; source: string; expected: boolean };

const cases: Case[] = [
    { name: "detects a dictionary literal", feature: "DICT", source: "user = {'name': 'Alice', 'age': 25}", expected: true },
    { name: "detects the dict constructor", feature: "DICT", source: "data = dict(a=1, b=2)", expected: true },
    { name: "returns false without a dictionary", feature: "DICT", source: "numbers = [1, 2, 3, 4]", expected: false },
    { name: "ignores dictionary syntax in a string", feature: "DICT", source: `msg = \"this is a dict: {'a': 1}\"`, expected: false },
    { name: "ignores dictionary syntax in a comment", feature: "DICT", source: "# my_dict = {'key': 'value'}", expected: false },
    { name: "does not match dict in an identifier or string", feature: "DICT", source: "dictionary_path = '/tmp/dict.txt'", expected: false },
    { name: "detects a dictionary comprehension", feature: "DICT", source: "squares = {x: x**2 for x in range(5)}", expected: true },

    { name: "detects a list literal", feature: "LIST", source: "items = [1, 2, 3]", expected: true },
    { name: "detects the list constructor", feature: "LIST", source: "items = list((1, 2, 3))", expected: true },
    { name: "returns false without a list", feature: "LIST", source: "x = 100", expected: false },
    { name: "ignores list syntax in a string", feature: "LIST", source: `msg = \"[1, 2, 3] is a list\"`, expected: false },
    { name: "ignores list syntax in a comment", feature: "LIST", source: "# my_list = [1, 2]", expected: false },
    { name: "does not match list in an identifier", feature: "LIST", source: "listen_port = 8080", expected: false },

    { name: "detects a set literal", feature: "SET", source: "unique_ids = {1, 2, 3}", expected: true },
    { name: "detects the set constructor", feature: "SET", source: "unique_items = set([1, 2, 2, 3])", expected: true },
    { name: "does not treat empty braces as a set", feature: "SET", source: "empty_data = {}", expected: false },
    { name: "ignores set in a string", feature: "SET", source: `msg = \"set world record\"`, expected: false },
    { name: "ignores set syntax in a comment", feature: "SET", source: "# s = {1, 2, 3}", expected: false },
    { name: "does not match set in an identifier", feature: "SET", source: "offset_value = 5", expected: false },

    { name: "detects list.sort()", feature: "SORT", source: "numbers = [3, 1, 2]\nnumbers.sort()", expected: true },
    { name: "detects sort with parameters", feature: "SORT", source: "numbers.sort(reverse=True)", expected: true },
    { name: "returns false without sort", feature: "SORT", source: "numbers = [1, 2, 3]", expected: false },
    { name: "ignores sort in a string", feature: "SORT", source: `msg = \"call list.sort() to sort in place\"`, expected: false },
    { name: "ignores sort in a comment", feature: "SORT", source: "# my_list.sort()", expected: false },
    { name: "does not match sort in an identifier", feature: "SORT", source: "sort_flag = True", expected: false },

    { name: "detects sorted()", feature: "SORTED", source: "new_list = sorted(numbers)", expected: true },
    { name: "detects sorted with key and reverse", feature: "SORTED", source: "new_list = sorted(data, key=lambda x: x[1], reverse=True)", expected: true },
    { name: "returns false for .sort() when looking for sorted()", feature: "SORTED", source: "numbers.sort()", expected: false },
    { name: "ignores sorted in a string", feature: "SORTED", source: `text = \"sorted() returns a new list\"`, expected: false },
    { name: "ignores sorted in a comment", feature: "SORTED", source: "# res = sorted(arr)", expected: false },
    { name: "does not confuse sorted() with .sort()", feature: "SORTED", source: "res = sorted([3, 2, 1])", expected: true },
];

describe("Python analyzer reference: containers and sorting", () => {
    it.each(cases)("$name", async ({ feature, source, expected }) => {
        expect(await matchesPythonFeatures([feature], source)).toBe(expected);
    });

    it("detects all container kinds and distinguishes empty dicts from sets", async () => {
        expect(await matchesPythonFeatures(["LIST", "DICT", "SET"], "a = list()\nb = dict()\nc = set()" )).toBe(true);
        expect(await matchesPythonFeatures(["SET"], "empty = {}\nnot_a_set = dict()" )).toBe(false);
    });

    it("distinguishes empty dictionaries, set comprehensions, and dictionary comprehensions", async () => {
        expect(await matchesPythonFeatures(["DICT"], "x = {}" )).toBe(true);
        expect(await matchesPythonFeatures(["SET"], "x = {}" )).toBe(false);
        expect(await matchesPythonFeatures(["SET"], "s = {x for x in range(10)}" )).toBe(true);
        expect(await matchesPythonFeatures(["DICT"], "s = {x for x in range(10)}" )).toBe(false);
        expect(await matchesPythonFeatures(["DICT"], "d = {x: x**2 for x in range(10)}" )).toBe(true);
        expect(await matchesPythonFeatures(["SET"], "d = {x: x**2 for x in range(10)}" )).toBe(false);
    });

    it("distinguishes .sort() from sorted()", async () => {
        expect(await matchesPythonFeatures(["SORTED"], "res = sorted([3, 2, 1])" )).toBe(true);
        expect(await matchesPythonFeatures(["SORT"], "res = sorted([3, 2, 1])" )).toBe(false);
        expect(await matchesPythonFeatures(["SORT"], "items.sort()" )).toBe(true);
        expect(await matchesPythonFeatures(["SORTED"], "items.sort()" )).toBe(false);
    });
});

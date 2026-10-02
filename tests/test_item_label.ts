import { test } from "node:test";
import assert from "node:assert/strict";
import { notesSnippet } from "../admin-ui/itemLabel.ts";

test("notesSnippet: empty notes", () => {
  assert.equal(notesSnippet(""), "No notes");
  assert.equal(notesSnippet("  \n "), "No notes");
});
test("notesSnippet: strips markdown and TeX delimiters, keeps first 8 words", () => {
  assert.equal(notesSnippet("**Look for structure** \\(x^2\\)"), "Look for structure x^2");
  assert.equal(
    notesSnippet("- one two three four five six seven eight nine ten"),
    "one two three four five six seven eight…",
  );
  assert.equal(notesSnippet("`code` and *em*"), "code and em");
});

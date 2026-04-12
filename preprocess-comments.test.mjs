import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructThread, normalizeText, splitCodeFences } from "./preprocess-comments.mjs";

// Helper: minimal flat note record
function makeNote(overrides = {}) {
    return {
        discussion_id: "disc1",
        discussion_kind: "diff",
        discussion_resolved: false,
        file_path: "src/foo.js",
        note_body: "Some comment",
        note_author_username: "reviewer",
        is_root_note: true,
        reply_index_in_discussion: 0,
        note_by_mr_author: false,
        mr_iid: 42,
        _source_file: "mr-notes-2026-04-01.jsonl",
        ...overrides,
    };
}

test("reconstructThread: single root note becomes thread", () => {
    const notes = [makeNote({ note_body: "Add timeout here" })];
    const thread = reconstructThread(notes);
    assert.equal(thread.discussion_id, "disc1");
    assert.equal(thread.root_comment, "Add timeout here");
    assert.deepEqual(thread.replies, []);
    assert.deepEqual(thread.code_snippets, []);
    assert.equal(thread.resolved, false);
    assert.equal(thread.mr_iid, 42);
    assert.equal(thread.source_file, "mr-notes-2026-04-01.jsonl");
});

test("reconstructThread: root + replies", () => {
    const notes = [
        makeNote({ note_body: "Add timeout", is_root_note: true, reply_index_in_discussion: 0 }),
        makeNote({ note_body: "Fixed, 5s", is_root_note: false, reply_index_in_discussion: 1, note_author_username: "author" }),
    ];
    const thread = reconstructThread(notes);
    assert.equal(thread.root_comment, "Add timeout");
    assert.deepEqual(thread.replies, ["Fixed, 5s"]);
});

test("reconstructThread: code fences extracted from root", () => {
    const notes = [makeNote({ note_body: "See this:\n```js\nconst x = 1;\n```" })];
    const thread = reconstructThread(notes);
    assert.match(thread.root_comment, /See this/);
    assert.ok(!thread.root_comment.includes("const x"));
    assert.deepEqual(thread.code_snippets, ["const x = 1;"]);
});

test("reconstructThread: code fences extracted from reply", () => {
    const notes = [
        makeNote({ is_root_note: true, reply_index_in_discussion: 0 }),
        makeNote({ note_body: "Fixed:\n```\ntimeout: 5000\n```", is_root_note: false, reply_index_in_discussion: 1 }),
    ];
    const thread = reconstructThread(notes);
    assert.ok(thread.code_snippets.includes("timeout: 5000"));
});

test("normalizeText: strips bold and italic", () => {
    assert.equal(normalizeText("**bold** and *italic*"), "bold and italic");
});

test("normalizeText: strips headers", () => {
    assert.equal(normalizeText("## Title\nBody"), "Title\nBody");
});

test("normalizeText: strips links", () => {
    assert.equal(normalizeText("[click here](https://example.com)"), "click here");
});

test("normalizeText: inline code becomes plain text", () => {
    assert.equal(normalizeText("`const x = 1`"), "const x = 1");
});

test("splitCodeFences: extracts single block", () => {
    const { text, code_snippets } = splitCodeFences("Before\n```js\nconst x = 1;\n```\nAfter");
    assert.ok(text.includes("Before"));
    assert.ok(text.includes("After"));
    assert.ok(!text.includes("const x"));
    assert.deepEqual(code_snippets, ["const x = 1;"]);
});

test("splitCodeFences: no fences returns original text", () => {
    const { text, code_snippets } = splitCodeFences("Plain text");
    assert.equal(text, "Plain text");
    assert.deepEqual(code_snippets, []);
});

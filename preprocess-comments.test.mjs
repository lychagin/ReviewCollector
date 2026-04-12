import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructThread, normalizeText, splitCodeFences, filterAuthorNotes, detectNewFiles } from "./preprocess-comments.mjs";
import { readJsonlFile, buildThreads, loadState, saveState } from "./preprocess-comments.mjs";
import { mkdtempSync, writeFileSync as fsWriteFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";

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

test("reconstructThread: no explicit root note — fallback to first, no duplication", () => {
    const notes = [
        makeNote({ is_root_note: false, reply_index_in_discussion: 0, note_body: "First note" }),
        makeNote({ is_root_note: false, reply_index_in_discussion: 1, note_body: "Second note" }),
    ];
    const thread = reconstructThread(notes);
    assert.equal(thread.root_comment, "First note");
    assert.deepEqual(thread.replies, ["Second note"]);  // First note NOT in replies
});

test("filterAuthorNotes: single note by author is kept", () => {
    const notes = [makeNote({ note_by_mr_author: true, is_root_note: true })];
    assert.equal(filterAuthorNotes(notes).length, 1);
});

test("filterAuthorNotes: root note by author removed in multi-note thread", () => {
    const notes = [
        makeNote({ note_by_mr_author: true, is_root_note: true, reply_index_in_discussion: 0 }),
        makeNote({ note_by_mr_author: false, is_root_note: false, reply_index_in_discussion: 1 }),
    ];
    const result = filterAuthorNotes(notes);
    assert.equal(result.length, 1);
    assert.equal(result[0].is_root_note, false);
});

test("filterAuthorNotes: reply by author is kept", () => {
    const notes = [
        makeNote({ note_by_mr_author: false, is_root_note: true, reply_index_in_discussion: 0 }),
        makeNote({ note_by_mr_author: true, is_root_note: false, reply_index_in_discussion: 1 }),
    ];
    assert.equal(filterAuthorNotes(notes).length, 2);
});

test("filterAuthorNotes: non-author notes always kept", () => {
    const notes = [
        makeNote({ note_by_mr_author: false, is_root_note: true }),
        makeNote({ note_by_mr_author: false, is_root_note: false, reply_index_in_discussion: 1 }),
    ];
    assert.equal(filterAuthorNotes(notes).length, 2);
});

test("detectNewFiles: returns files not in alreadyProcessed", () => {
    const dir = mkdtempSync(pathJoin(tmpdir(), "rc-test-"));
    try {
        fsWriteFileSync(pathJoin(dir, "mr-notes-2026-01.jsonl"), "");
        fsWriteFileSync(pathJoin(dir, "mr-notes-2026-02.jsonl"), "");
        fsWriteFileSync(pathJoin(dir, "mr-notes-2026-01.meta.json"), "");
        const result = detectNewFiles(dir, ["mr-notes-2026-01.jsonl"]);
        assert.deepEqual(result.sort(), ["mr-notes-2026-02.jsonl"]);
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("detectNewFiles: empty dir returns empty array", () => {
    const dir = mkdtempSync(pathJoin(tmpdir(), "rc-test-"));
    try {
        assert.deepEqual(detectNewFiles(dir, []), []);
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("detectNewFiles: nonexistent dir returns empty array", () => {
    assert.deepEqual(detectNewFiles("/nonexistent/path", []), []);
});

test("filterAuthorNotes: empty array returns empty array", () => {
    assert.deepEqual(filterAuthorNotes([]), []);
});

test("readJsonlFile: parses records and injects _source_file", () => {
    const dir = mkdtempSync(pathJoin(tmpdir(), "rc-test-"));
    try {
        const record = { discussion_id: "d1", note_body: "hi", is_root_note: true, reply_index_in_discussion: 0,
            discussion_kind: "diff", discussion_resolved: false, file_path: null,
            note_by_mr_author: false, mr_iid: 1 };
        fsWriteFileSync(pathJoin(dir, "test.jsonl"), JSON.stringify(record) + "\n");
        const records = readJsonlFile(pathJoin(dir, "test.jsonl"));
        assert.equal(records.length, 1);
        assert.equal(records[0]._source_file, "test.jsonl");
        assert.equal(records[0].discussion_id, "d1");
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("buildThreads: groups by discussion_id and reconstructs threads", () => {
    const base = { discussion_kind: "diff", discussion_resolved: false, file_path: null,
        note_by_mr_author: false, mr_iid: 1, _source_file: "x.jsonl" };
    const records = [
        { ...base, discussion_id: "d1", note_body: "Comment A", is_root_note: true, reply_index_in_discussion: 0 },
        { ...base, discussion_id: "d1", note_body: "Reply B", is_root_note: false, reply_index_in_discussion: 1 },
        { ...base, discussion_id: "d2", note_body: "Comment C", is_root_note: true, reply_index_in_discussion: 0 },
    ];
    const threads = buildThreads(records);
    assert.equal(threads.length, 2);
    const d1 = threads.find((t) => t.discussion_id === "d1");
    assert.equal(d1.root_comment, "Comment A");
    assert.deepEqual(d1.replies, ["Reply B"]);
});

test("loadState: returns empty state if file missing", () => {
    const dir = mkdtempSync(pathJoin(tmpdir(), "rc-test-"));
    try {
        const state = loadState(dir);
        assert.deepEqual(state.processed_files, []);
        assert.deepEqual(state.raw_patterns, []);
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("saveState / loadState: round-trip", () => {
    const dir = mkdtempSync(pathJoin(tmpdir(), "rc-test-"));
    try {
        const state = { schema_version: "1.0", processed_files: ["a.jsonl"], raw_patterns: [], last_updated: null };
        saveState(dir, state);
        const loaded = loadState(dir);
        assert.deepEqual(loaded.processed_files, ["a.jsonl"]);
        assert.ok(loaded.last_updated); // set by saveState
    } finally {
        rmSync(dir, { recursive: true });
    }
});

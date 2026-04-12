# Pattern Mining Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Pattern Mining subsystem — a CLI preprocessor + Claude Code skill that reads `processed/*.jsonl`, reconstructs threads, and synthesizes review patterns via two-pass LLM analysis.

**Architecture:** `preprocess-comments.mjs` handles all mechanical work (thread reconstruction, text normalization, state tracking) and writes `patterns/threads.jsonl`. The `/mine-patterns` Claude Code skill then reads threads in chunks (Pass 1 → raw patterns), then finalizes into `review-patterns.json` + `review-patterns.md` (Pass 2).

**Tech Stack:** Node.js ESM, `node:test`, `node:fs`, `node:path` — same stack as Extraction Tool (`mr-comments-collector.mjs`).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `preprocess-comments.mjs` | Create | Pure functions + CLI pipeline for preprocessing |
| `preprocess-comments.test.mjs` | Create | Unit tests for all pure functions |
| `.claude/skills/mine-patterns.md` | Create | Claude Code skill orchestrating Pass 1 + Pass 2 |

---

## Task 1: Pure functions — `reconstructThread` and `normalizeText`

**Files:**
- Create: `preprocess-comments.mjs`
- Create: `preprocess-comments.test.mjs`

These are the two core data-transformation functions. No I/O, easy to unit test.

- [ ] **Step 1: Create `preprocess-comments.mjs` with `reconstructThread`**

```js
// preprocess-comments.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

export const SCHEMA_VERSION = "1.0";

/**
 * Given an array of flat JSONL records sharing the same discussion_id,
 * returns a single thread object for threads.jsonl.
 * Records must be sorted by reply_index_in_discussion ascending (as exported).
 */
export function reconstructThread(notes) {
    const root = notes.find((n) => n.is_root_note) ?? notes[0];
    const replies = notes
        .filter((n) => !n.is_root_note)
        .map((n) => n.note_body);

    const { code_snippets: rootSnippets, text: rootText } = splitCodeFences(root.note_body);
    const allSnippets = [...rootSnippets];
    const cleanReplies = replies.map((r) => {
        const { code_snippets, text } = splitCodeFences(r);
        allSnippets.push(...code_snippets);
        return normalizeText(text);
    });

    return {
        discussion_id: root.discussion_id,
        kind: root.discussion_kind,
        file_path: root.file_path ?? null,
        root_comment: normalizeText(rootText),
        replies: cleanReplies.filter(Boolean),
        code_snippets: allSnippets.filter(Boolean),
        resolved: root.discussion_resolved,
        mr_iid: root.mr_iid,
        source_file: root._source_file,
    };
}

/**
 * Strips markdown formatting from text (bold, italic, headers, links, inline code).
 * Does NOT strip code fences — use splitCodeFences for that first.
 */
export function normalizeText(text) {
    return text
        .replace(/```[\s\S]*?```/g, "")   // remove any leftover code fences
        .replace(/`[^`]+`/g, (m) => m.slice(1, -1))  // inline code → plain
        .replace(/\*\*(.+?)\*\*/g, "$1")  // bold
        .replace(/\*(.+?)\*/g, "$1")      // italic
        .replace(/^#{1,6}\s+/gm, "")      // headers
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // links
        .replace(/\n{3,}/g, "\n\n")       // collapse blank lines
        .trim();
}

/**
 * Splits text into code fence blocks and the remaining text.
 * Returns { text: string, code_snippets: string[] }.
 */
export function splitCodeFences(text) {
    const code_snippets = [];
    const cleaned = text.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, code) => {
        code_snippets.push(code.trim());
        return "";
    });
    return { text: cleaned.trim(), code_snippets };
}
```

- [ ] **Step 2: Create `preprocess-comments.test.mjs` — tests for `reconstructThread`**

```js
// preprocess-comments.test.mjs
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
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
node --test preprocess-comments.test.mjs
```

Expected: all tests pass (reconstructThread and normalizeText are implemented).

- [ ] **Step 4: Commit**

```bash
git add preprocess-comments.mjs preprocess-comments.test.mjs
git commit -m "feat: add reconstructThread, normalizeText, splitCodeFences with tests"
```

---

## Task 2: Pure functions — `filterAuthorNotes` and `detectNewFiles`

**Files:**
- Modify: `preprocess-comments.mjs`
- Modify: `preprocess-comments.test.mjs`

- [ ] **Step 1: Add `filterAuthorNotes` to `preprocess-comments.mjs`**

Add after `splitCodeFences`:

```js
/**
 * Filters notes_by_mr_author from the notes array before thread reconstruction.
 * Rule: keep note_by_mr_author=true only if:
 *   (a) it is the only note in the discussion (self-review), OR
 *   (b) it is a reply (is_root_note=false) — author responding to reviewer feedback
 * Remove if: note_by_mr_author=true AND is_root_note=true AND discussion has other notes.
 */
export function filterAuthorNotes(notes) {
    if (notes.length === 1) return notes; // single note — keep regardless
    return notes.filter((n) => {
        if (!n.note_by_mr_author) return true;   // not by author — always keep
        if (!n.is_root_note) return true;         // reply by author — keep (responding to reviewer)
        return false;                             // root note by author in multi-note thread — remove
    });
}

/**
 * Returns filenames (basename only) from processedDir that are NOT in alreadyProcessed.
 * Only considers *.jsonl files (not *.meta.json).
 */
export function detectNewFiles(processedDir, alreadyProcessed) {
    if (!existsSync(processedDir)) return [];
    const all = readdirSync(processedDir)
        .filter((f) => f.endsWith(".jsonl") && !f.endsWith(".meta.json"));
    const processed = new Set(alreadyProcessed);
    return all.filter((f) => !processed.has(f));
}
```

- [ ] **Step 2: Add tests for `filterAuthorNotes` and `detectNewFiles` to `preprocess-comments.test.mjs`**

Add at the bottom of the test file:

```js
import { filterAuthorNotes, detectNewFiles } from "./preprocess-comments.mjs";
import { mkdtempSync, writeFileSync as fsWriteFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";

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
        assert.deepEqual(result, ["mr-notes-2026-02.jsonl"]);
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
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
node --test preprocess-comments.test.mjs
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add preprocess-comments.mjs preprocess-comments.test.mjs
git commit -m "feat: add filterAuthorNotes, detectNewFiles with tests"
```

---

## Task 3: Main pipeline — `preprocess-comments.mjs` CLI

**Files:**
- Modify: `preprocess-comments.mjs` (add state I/O, pipeline, CLI entry point)

- [ ] **Step 1: Add state management and pipeline to `preprocess-comments.mjs`**

Add at the bottom of the file (after the exported functions):

```js
// ─── State I/O ────────────────────────────────────────────────────────────────

export function loadState(patternsDir) {
    const statePath = join(patternsDir, "mining-state.json");
    if (!existsSync(statePath)) {
        return { schema_version: SCHEMA_VERSION, processed_files: [], raw_patterns: [], last_updated: null };
    }
    return JSON.parse(readFileSync(statePath, "utf8"));
}

export function saveState(patternsDir, state) {
    const statePath = join(patternsDir, "mining-state.json");
    const updated = { ...state, last_updated: new Date().toISOString() };
    writeFileSync(statePath, JSON.stringify(updated, null, 2));
}

// ─── JSONL processing ─────────────────────────────────────────────────────────

/**
 * Reads a JSONL file, returns array of flat note records
 * with _source_file injected (basename of the file).
 */
export function readJsonlFile(filePath) {
    const src = basename(filePath);
    return readFileSync(filePath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => ({ ...JSON.parse(line), _source_file: src }));
}

/**
 * Groups flat records by discussion_id, applies filterAuthorNotes,
 * reconstructs each thread. Returns array of thread objects.
 */
export function buildThreads(records) {
    const byDiscussion = new Map();
    for (const r of records) {
        const key = r.discussion_id;
        if (!byDiscussion.has(key)) byDiscussion.set(key, []);
        byDiscussion.get(key).push(r);
    }
    const threads = [];
    for (const notes of byDiscussion.values()) {
        const sorted = notes.slice().sort((a, b) => a.reply_index_in_discussion - b.reply_index_in_discussion);
        const filtered = filterAuthorNotes(sorted);
        if (filtered.length > 0) threads.push(reconstructThread(filtered));
    }
    return threads;
}

/**
 * Writes threads array to patternsDir/threads.jsonl (overwrites each run).
 */
export function writeThreadsJsonl(patternsDir, threads) {
    const { mkdirSync } = await import("node:fs");  // already imported at top — use writeFileSync
    const outPath = join(patternsDir, "threads.jsonl");
    writeFileSync(outPath, threads.map((t) => JSON.stringify(t)).join("\n") + "\n");
    return outPath;
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

async function main() {
    const projectDir = new URL(".", import.meta.url).pathname;
    const processedDir = join(projectDir, "processed");
    const patternsDir = join(projectDir, "patterns");

    const { mkdirSync } = await import("node:fs");
    mkdirSync(patternsDir, { recursive: true });

    const state = loadState(patternsDir);
    const newFiles = detectNewFiles(processedDir, state.processed_files);

    if (newFiles.length === 0) {
        console.log("No new files to process.");
        return;
    }

    const allThreads = [];
    for (const filename of newFiles) {
        const filePath = join(processedDir, filename);
        const records = readJsonlFile(filePath);
        const threads = buildThreads(records);
        allThreads.push(...threads);
        state.processed_files.push(filename);
    }

    const outPath = join(patternsDir, "threads.jsonl");
    writeFileSync(outPath, allThreads.map((t) => JSON.stringify(t)).join("\n") + "\n");
    saveState(patternsDir, state);

    console.log(`Processed ${newFiles.length} new file(s), ${allThreads.length} threads written to patterns/threads.jsonl`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    main().catch((e) => { console.error(e.message); process.exit(1); });
}
```

**Note:** `writeFileSync` is already imported at the top via the named import. Remove the duplicate `writeThreadsJsonl` helper with the stray `await import` — replace its body with the direct call:

```js
export function writeThreadsJsonl(patternsDir, threads) {
    const outPath = join(patternsDir, "threads.jsonl");
    writeFileSync(outPath, threads.map((t) => JSON.stringify(t)).join("\n") + "\n");
    return outPath;
}
```

- [ ] **Step 2: Add pipeline tests to `preprocess-comments.test.mjs`**

Add at the bottom:

```js
import { readJsonlFile, buildThreads, loadState, saveState } from "./preprocess-comments.mjs";

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
```

- [ ] **Step 3: Run all tests — expect PASS**

```bash
node --test preprocess-comments.test.mjs
```

Expected: all tests pass.

- [ ] **Step 4: Smoke test CLI**

```bash
# Create a minimal processed/ file to test with
mkdir -p processed
echo '{"discussion_id":"test1","discussion_kind":"diff","discussion_resolved":false,"file_path":"src/foo.js","note_body":"Add timeout here","note_author_username":"reviewer","is_root_note":true,"reply_index_in_discussion":0,"note_by_mr_author":false,"mr_iid":1}' > processed/mr-notes-test.jsonl

node preprocess-comments.mjs
# Expected: "Processed 1 new file(s), 1 threads written to patterns/threads.jsonl"

cat patterns/threads.jsonl
# Expected: one JSON line with discussion_id, root_comment, replies, etc.

cat patterns/mining-state.json
# Expected: processed_files includes "mr-notes-test.jsonl"

node preprocess-comments.mjs
# Expected: "No new files to process."

# Cleanup test file
rm processed/mr-notes-test.jsonl
```

- [ ] **Step 5: Commit**

```bash
git add preprocess-comments.mjs preprocess-comments.test.mjs
git commit -m "feat: add pipeline functions and CLI entry point to preprocess-comments.mjs"
```

---

## Task 4: Claude Code skill — `mine-patterns.md`

**Files:**
- Create: `.claude/skills/mine-patterns.md`

The skill is a markdown file that Claude Code loads when user runs `/mine-patterns`. It instructs Claude to orchestrate the two-pass synthesis.

- [ ] **Step 1: Create `.claude/skills/` directory**

```bash
mkdir -p .claude/skills
```

- [ ] **Step 2: Create `.claude/skills/mine-patterns.md`**

```markdown
---
name: mine-patterns
description: Synthesize review patterns from processed GitLab MR comments. Runs CLI preprocessor, then two-pass LLM analysis to produce review-patterns.json and review-patterns.md.
---

# Mine Patterns Skill

You are orchestrating the Pattern Mining pipeline for the Review Collector project.
Working directory is the root of the review-collector project.

## Overview

Two-pass synthesis:
- **Pass 1:** Read `patterns/threads.jsonl` in chunks of 30 threads → extract raw patterns → accumulate in `patterns/mining-state.json`
- **Pass 2:** Read all raw patterns from `patterns/mining-state.json` → deduplicate, generalize, finalize → write `patterns/review-patterns.json` + `patterns/review-patterns.md`

---

## Step 1: Run preprocessor

Run the CLI preprocessor:

```bash
node preprocess-comments.mjs
```

Read the output:
- If "No new files to process." → skip Pass 1, go directly to Pass 2
- Otherwise note how many threads were written and proceed to Pass 1

---

## Step 2: Pass 1 — Raw pattern extraction (chunk by chunk)

Read `patterns/threads.jsonl`. Process in chunks of 30 threads at a time.

For each chunk, analyze the threads and extract raw patterns using this prompt:

---
*You are a senior code reviewer analyzing a batch of code review discussions from GitLab MRs.*

*Each thread below is a review discussion: a reviewer's comment (root_comment) and optionally the author's replies.*

*Your task: extract review patterns — rules that, if followed, would prevent these issues.*

*IMPORTANT:*
- *Synthesize a rule even from a single comment. Do not require repetition.*
- *Be specific and actionable: "Always set HTTP timeout explicitly" not "Be careful with HTTP"*
- *Each pattern must have: title, category, rule, evidence (1-2 quotes), frequency (count of threads supporting it)*

*Categories: robustness, security, performance, style, architecture, testing*

*Threads:*
[paste threads here]

*Respond in JSON array:*
```json
[
  {
    "id": "rp_NNN",
    "title": "...",
    "category": "robustness",
    "rule": "...",
    "evidence": ["quote from thread"],
    "source_discussions": ["discussion_id"],
    "frequency": 1
  }
]
```
---

After each chunk:
1. Parse the JSON response
2. Read current `patterns/mining-state.json`
3. Append new raw patterns to `raw_patterns[]` (generate sequential IDs: rp_001, rp_002, ...)
4. Write updated `patterns/mining-state.json`
5. Report progress: "Chunk N/M done — X raw patterns extracted so far"

---

## Step 3: Pass 2 — Finalization

Read all `raw_patterns` from `patterns/mining-state.json`.

Analyze them with this prompt:

---
*You are a senior code reviewer. Below are raw review patterns extracted from GitLab MR discussions.*

*Your task: produce a clean, deduplicated final list of review patterns.*

*Rules:*
- *Merge patterns that describe the same issue (even if worded differently)*
- *Sum frequencies of merged patterns*
- *Keep the most general and actionable formulation*
- *Assign priority: high (frequent or critical), medium (occasional), low (rare/minor)*
- *Assign final IDs: p_001, p_002, ...*

*Raw patterns:*
[paste raw_patterns here]

*Respond in JSON:*
```json
{
  "patterns": [
    {
      "id": "p_001",
      "title": "...",
      "category": "robustness",
      "priority": "high",
      "rule": "...",
      "rationale": "...",
      "example_comments": ["..."],
      "frequency": 5,
      "last_seen": "YYYY-MM-DD"
    }
  ]
}
```
---

After receiving the response:

**Write `patterns/review-patterns.json`:**
```json
{
  "schema_version": "1.0",
  "generated_at": "<current ISO timestamp>",
  "patterns": [ ...patterns from LLM response... ]
}
```

**Write `patterns/review-patterns.md`** — generate from the JSON:

```markdown
# Review Patterns

_Generated: <date>. Total: N patterns._

---

## <category>

### <id> · <title>
**Правило:** <rule>
**Почему:** <rationale>
**Встречалось:** <frequency> раз
**Пример:** "<first example_comment>"

---
```

Group patterns by category, sort by priority (high → medium → low) within each category.

---

## Step 4: Report to user

After completing both passes, report:

```
Pattern mining complete.

Pass 1: N threads processed, M raw patterns extracted
Pass 2: K final patterns (deduplicated from M)

Output files:
  patterns/review-patterns.json  — machine-readable
  patterns/review-patterns.md    — human-readable

Top patterns by category:
  robustness: X
  security: Y
  ...
```

Ask the user: "Would you like to review the patterns in `patterns/review-patterns.md`?"
```

- [ ] **Step 3: Verify skill is discoverable**

```bash
ls .claude/skills/mine-patterns.md
# Expected: file exists
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/mine-patterns.md
git commit -m "feat: add mine-patterns Claude Code skill"
```

---

## Task 5: Update PROGRESS.md and smoke test end-to-end

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Update PROGRESS.md**

In the "Что уже сделано" section, add under Pattern Mining:

```markdown
### Pattern Mining Skill (полностью готов)

| Файл | Назначение |
|------|-----------|
| `preprocess-comments.mjs` | CLI препроцессор: thread reconstruction, нормализация, state |
| `preprocess-comments.test.mjs` | Unit-тесты (node:test) |
| `.claude/skills/mine-patterns.md` | Claude Code скилл: Pass 1 + Pass 2 |

#### Возможности

- Инкрементальная обработка: только новые файлы из `processed/`
- Pass 1: чанки по 30 тредов → raw паттерны → `patterns/mining-state.json`
- Pass 2: финализация, дедупликация → `patterns/review-patterns.json` + `.md`

#### Запуск

```bash
# 1. Убедись что есть файлы в processed/
# 2. Запусти скилл
/mine-patterns
```
```

Mark Pattern Mining as ✅ in the three-subsystem list at the top.

- [ ] **Step 2: Run full test suite**

```bash
node --test mr-comments-collector.test.mjs
node --test preprocess-comments.test.mjs
```

Expected: all 27 + all new tests pass.

- [ ] **Step 3: Commit and push**

```bash
git add PROGRESS.md
git commit -m "docs: mark Pattern Mining as complete in PROGRESS.md"
git push
```

---

## Self-Review

**Spec coverage check:**
- ✅ CLI preprocessor reads state, detects new files — Task 3
- ✅ Thread reconstruction — Task 1
- ✅ Text normalization + code fence extraction — Task 1
- ✅ `filterAuthorNotes` — Task 2
- ✅ `mining-state.json` structure (processed_files + raw_patterns) — Task 3
- ✅ `threads.jsonl` format — Task 1/3
- ✅ Pass 1 chunked analysis (30 threads) — Task 4 skill
- ✅ Pass 2 finalization + deduplication — Task 4 skill
- ✅ `review-patterns.json` format — Task 4 skill
- ✅ `review-patterns.md` generation — Task 4 skill
- ✅ Incremental: skip Pass 1 if no new files — Task 4 skill
- ✅ Unit tests for all pure functions — Tasks 1–3
- ✅ PROGRESS.md update — Task 5

**Type consistency:** `reconstructThread` returns `{ discussion_id, kind, file_path, root_comment, replies, code_snippets, resolved, mr_iid, source_file }` — this shape is used consistently in `buildThreads` and referenced in the skill prompt. ✅

**No placeholders found.**

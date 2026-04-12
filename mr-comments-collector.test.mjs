import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, existsSync as fsExistsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    SCHEMA_VERSION,
    DEFAULT_BOT_PATTERNS,
    globToRegex,
    isBot,
    parsePeriod,
    dedupeMrsByIid,
    detectDiscussionKind,
    flattenNote,
    writeJsonlAtomic,
    writeMeta,
    findOverlappingExports,
    formatFileDateTime,
    parseDateTimeFromFilename,
    archiveOldProcessedFiles,
} from "./mr-comments-collector.mjs";

test("globToRegex: literal pattern", () => {
    assert.equal(globToRegex("ghost").test("ghost"), true);
    assert.equal(globToRegex("ghost").test("ghost-bot"), false);
});

test("globToRegex: wildcard suffix", () => {
    assert.equal(globToRegex("*-bot").test("gitlab-bot"), true);
    assert.equal(globToRegex("*-bot").test("project_1234-bot"), true);
    assert.equal(globToRegex("*-bot").test("alice"), false);
});

test("globToRegex: escapes regex metacharacters", () => {
    assert.equal(globToRegex("a.b").test("a.b"), true);
    assert.equal(globToRegex("a.b").test("axb"), false);
});

test("isBot: matches any pattern in list", () => {
    const patterns = ["*-bot", "*_bot", "ghost"];
    assert.equal(isBot("gitlab-bot", patterns), true);
    assert.equal(isBot("project_bot", patterns), true);
    assert.equal(isBot("ghost", patterns), true);
    assert.equal(isBot("alice", patterns), false);
});

test("isBot: empty username returns false", () => {
    assert.equal(isBot("", ["*-bot"]), false);
    assert.equal(isBot(null, ["*-bot"]), false);
});

test("parsePeriod: days", () => {
    const { from, to } = parsePeriod("7d");
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diffMs = toDate - fromDate;
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    assert.equal(diffDays, 7);
});

test("parsePeriod: months", () => {
    const { from, to } = parsePeriod("3m");
    const fromDate = new Date(from);
    const toDate = new Date(to);
    // 3 месяца ≈ 90 дней
    const diffDays = (toDate - fromDate) / (1000 * 60 * 60 * 24);
    assert.ok(diffDays >= 88 && diffDays <= 92, `expected ~90 days, got ${diffDays}`);
});

test("parsePeriod: invalid format throws", () => {
    assert.throws(() => parsePeriod("3months"), /Неверный формат периода/);
    assert.throws(() => parsePeriod(""), /Неверный формат периода/);
    assert.throws(() => parsePeriod("abc"), /Неверный формат периода/);
});

test("dedupeMrsByIid: keeps first occurrence", () => {
    const mrs = [
        { iid: 1, title: "first" },
        { iid: 2, title: "second" },
        { iid: 1, title: "dup" },
        { iid: 3, title: "third" },
    ];
    const result = dedupeMrsByIid(mrs);
    assert.equal(result.length, 3);
    assert.deepEqual(result.map((m) => m.iid), [1, 2, 3]);
    assert.equal(result[0].title, "first");
});

test("detectDiscussionKind: DiffNote → diff", () => {
    assert.equal(detectDiscussionKind({ type: "DiffNote" }), "diff");
});

test("detectDiscussionKind: note with position → diff", () => {
    assert.equal(detectDiscussionKind({ type: "Note", position: { new_path: "a.ts" } }), "diff");
});

test("detectDiscussionKind: plain note → overview", () => {
    assert.equal(detectDiscussionKind({ type: "DiscussionNote" }), "overview");
    assert.equal(detectDiscussionKind({}), "overview");
});

test("flattenNote: root diff note", () => {
    const mr = {
        iid: 1828,
        title: "feat: test",
        state: "merged",
        created_at: "2026-04-09T12:00:00Z",
        merged_at: "2026-04-10T08:00:00Z",
        author: { username: "ivanov", name: "Иван" },
        web_url: "https://gitlab/mr/1828",
        labels: ["backend"],
    };
    const note = {
        id: 100,
        type: "DiffNote",
        body: "Нужен timeout",
        author: { username: "petrov", name: "Пётр" },
        created_at: "2026-04-09T13:00:00Z",
        resolved: true,
        resolved_by: { username: "ivanov" },
        resolved_at: "2026-04-09T14:00:00Z",
        position: {
            new_path: "src/client.ts",
            new_line: 57,
            line_range: {
                start: { new_line: 57 },
                end: { new_line: 59 },
            },
        },
    };
    const discussion = { id: "disc1", notes: [note] };

    const record = flattenNote(mr, discussion, note, 0, "group/proj", "2026-04-10T15:00:00Z");

    assert.equal(record.schema_version, SCHEMA_VERSION);
    assert.equal(record.project_path, "group/proj");
    assert.equal(record.mr_iid, 1828);
    assert.equal(record.mr_author_username, "ivanov");
    assert.equal(record.discussion_kind, "diff");
    assert.equal(record.discussion_resolved, true);
    assert.equal(record.discussion_resolved_by_username, "ivanov");
    assert.equal(record.is_root_note, true);
    assert.equal(record.reply_index_in_discussion, 0);
    assert.equal(record.thread_root_note_id, 100);
    assert.equal(record.parent_note_id, null);
    assert.equal(record.note_by_mr_author, false);
    assert.equal(record.file_path, "src/client.ts");
    assert.equal(record.new_line, 57);
    assert.equal(record.line_range_start, 57);
    assert.equal(record.line_range_end, 59);
    assert.equal(record.has_suggestions, false);
});

test("flattenNote: reply note has parent", () => {
    const mr = {
        iid: 1,
        title: "t",
        state: "merged",
        created_at: "2026-01-01",
        author: { username: "a", name: "A" },
        web_url: "",
        labels: [],
    };
    const rootNote = {
        id: 100,
        type: "DiscussionNote",
        body: "root",
        author: { username: "b" },
        created_at: "2026-01-01",
    };
    const replyNote = {
        id: 101,
        type: "DiscussionNote",
        body: "reply",
        author: { username: "a" },
        created_at: "2026-01-02",
    };
    const discussion = { id: "d", notes: [rootNote, replyNote] };

    const rootRecord = flattenNote(mr, discussion, rootNote, 0, "g/p", "now");
    const replyRecord = flattenNote(mr, discussion, replyNote, 1, "g/p", "now");

    assert.equal(rootRecord.is_root_note, true);
    assert.equal(rootRecord.parent_note_id, null);

    assert.equal(replyRecord.is_root_note, false);
    assert.equal(replyRecord.parent_note_id, 100);
    assert.equal(replyRecord.reply_index_in_discussion, 1);
    assert.equal(replyRecord.note_by_mr_author, true); // reply author = MR author
});

test("flattenNote: note without position → overview kind", () => {
    const mr = {
        iid: 1, title: "t", state: "merged", created_at: "2026-01-01",
        author: { username: "a" }, web_url: "", labels: [],
    };
    const note = {
        id: 1, type: "DiscussionNote", body: "Общий коммент",
        author: { username: "b" }, created_at: "2026-01-01",
    };
    const discussion = { id: "d", notes: [note] };

    const record = flattenNote(mr, discussion, note, 0, "g/p", "now");
    assert.equal(record.discussion_kind, "overview");
    assert.equal(record.file_path, null);
    assert.equal(record.new_line, null);
});

test("flattenNote: suggestion detection in body", () => {
    const mr = {
        iid: 1, title: "t", state: "merged", created_at: "2026-01-01",
        author: { username: "a" }, web_url: "", labels: [],
    };
    const note = {
        id: 1, type: "Note", body: "fix:\n```suggestion\nnew code\n```",
        author: { username: "b" }, created_at: "2026-01-01",
    };
    const discussion = { id: "d", notes: [note] };

    const record = flattenNote(mr, discussion, note, 0, "g/p", "now");
    assert.equal(record.has_suggestions, true);
});

test("writeJsonlAtomic: writes records one per line", () => {
    const dir = mkdtempSync(join(tmpdir(), "mrc-test-"));
    const path = join(dir, "test.jsonl");
    try {
        writeJsonlAtomic(path, [{ a: 1 }, { b: 2 }]);
        const content = readFileSync(path, "utf-8");
        assert.equal(content, '{"a":1}\n{"b":2}\n');
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("writeJsonlAtomic: empty array writes empty file", () => {
    const dir = mkdtempSync(join(tmpdir(), "mrc-test-"));
    const path = join(dir, "empty.jsonl");
    try {
        writeJsonlAtomic(path, []);
        const content = readFileSync(path, "utf-8");
        assert.equal(content, "");
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("writeMeta: pretty-printed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "mrc-test-"));
    const path = join(dir, "meta.json");
    try {
        writeMeta(path, { a: 1, b: { c: 2 } });
        const content = readFileSync(path, "utf-8");
        assert.equal(content, '{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}');
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("findOverlappingExports: detects overlap", () => {
    const dir = mkdtempSync(join(tmpdir(), "mrc-test-"));
    const pendingDir = join(dir, "pending");
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(
        join(pendingDir, "mr-notes-2026-03-15T00-00-00.meta.json"),
        JSON.stringify({ period_from: "2026-03-01T00:00:00Z", period_to: "2026-03-15T00:00:00Z" }),
    );
    try {
        const overlaps = findOverlappingExports(dir, "2026-03-10T00:00:00Z", "2026-03-20T00:00:00Z");
        assert.equal(overlaps.length, 1);
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("findOverlappingExports: no overlap", () => {
    const dir = mkdtempSync(join(tmpdir(), "mrc-test-"));
    const pendingDir = join(dir, "pending");
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(
        join(pendingDir, "old.meta.json"),
        JSON.stringify({ period_from: "2026-01-01T00:00:00Z", period_to: "2026-01-31T00:00:00Z" }),
    );
    try {
        const overlaps = findOverlappingExports(dir, "2026-03-01T00:00:00Z", "2026-03-31T00:00:00Z");
        assert.equal(overlaps.length, 0);
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("findOverlappingExports: missing dirs return empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "mrc-test-"));
    try {
        const overlaps = findOverlappingExports(dir, "2026-01-01", "2026-12-31");
        assert.equal(overlaps.length, 0);
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("formatFileDateTime: produces filesystem-safe name", () => {
    const result = formatFileDateTime(new Date("2026-04-10T15:00:00.123Z"));
    assert.equal(result, "2026-04-10T15-00-00");
});

test("parseDateTimeFromFilename: valid", () => {
    const dt = parseDateTimeFromFilename("mr-notes-2026-04-10T15-30-45.jsonl");
    assert.ok(dt instanceof Date);
    assert.equal(dt.toISOString(), "2026-04-10T15:30:45.000Z");
});

test("parseDateTimeFromFilename: invalid returns null", () => {
    assert.equal(parseDateTimeFromFilename("random.jsonl"), null);
});

test("archiveOldProcessedFiles: moves old files to YYYY-MM", () => {
    const dir = mkdtempSync(join(tmpdir(), "mrc-test-"));
    const processed = join(dir, "processed");
    mkdirSync(processed, { recursive: true });

    writeFileSync(join(processed, "mr-notes-2026-02-15T10-00-00.jsonl"), "old");
    writeFileSync(join(processed, "mr-notes-2026-02-15T10-00-00.meta.json"), "{}");

    const now = new Date();
    const todayName = `mr-notes-${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}.jsonl`;
    writeFileSync(join(processed, todayName), "new");

    try {
        const result = archiveOldProcessedFiles(dir, 30, false);
        assert.equal(result.moved.length, 2); // .jsonl + .meta.json
        assert.ok(fsExistsSync(join(dir, "archive", "2026-02", "mr-notes-2026-02-15T10-00-00.jsonl")));
        assert.ok(fsExistsSync(join(dir, "archive", "2026-02", "mr-notes-2026-02-15T10-00-00.meta.json")));
        assert.ok(fsExistsSync(join(processed, todayName))); // свежий на месте
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("archiveOldProcessedFiles: dry run doesn't move", () => {
    const dir = mkdtempSync(join(tmpdir(), "mrc-test-"));
    const processed = join(dir, "processed");
    mkdirSync(processed, { recursive: true });

    writeFileSync(join(processed, "mr-notes-2026-01-01T00-00-00.jsonl"), "x");

    try {
        const result = archiveOldProcessedFiles(dir, 1, true);
        assert.equal(result.moved.length, 1);
        assert.ok(fsExistsSync(join(processed, "mr-notes-2026-01-01T00-00-00.jsonl"))); // не двинулся
        assert.equal(fsExistsSync(join(dir, "archive")), false); // архив не создан
    } finally {
        rmSync(dir, { recursive: true });
    }
});

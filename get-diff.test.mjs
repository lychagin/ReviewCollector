import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRef, parseCommits } from "./get-diff.mjs";

// ─── normalizeRef ─────────────────────────────────────────────────────────────

test("normalizeRef: HEAD~3 → HEAD~3..HEAD", () => {
    assert.equal(normalizeRef("HEAD~3"), "HEAD~3..HEAD");
});

test("normalizeRef: HEAD~1 → HEAD~1..HEAD", () => {
    assert.equal(normalizeRef("HEAD~1"), "HEAD~1..HEAD");
});

test("normalizeRef: HEAD → HEAD^..HEAD", () => {
    assert.equal(normalizeRef("HEAD"), "HEAD^..HEAD");
});

test("normalizeRef: sha → sha^..sha", () => {
    assert.equal(normalizeRef("abc1234"), "abc1234^..abc1234");
});

test("normalizeRef: range passes through unchanged", () => {
    assert.equal(normalizeRef("abc123..def456"), "abc123..def456");
});

test("normalizeRef: HEAD..abc123 passes through unchanged", () => {
    assert.equal(normalizeRef("HEAD..abc123"), "HEAD..abc123");
});

test("normalizeRef: empty string throws", () => {
    assert.throws(() => normalizeRef(""), /Empty git ref/);
});

test("normalizeRef: trims whitespace before processing", () => {
    assert.equal(normalizeRef("  HEAD~2  "), "HEAD~2..HEAD");
});

// ─── parseCommits ─────────────────────────────────────────────────────────────

test("parseCommits: parses single commit line", () => {
    const raw = "abc1234567890abcd\tfeat: add timeout\tSergey\n";
    const commits = parseCommits(raw);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].sha, "abc1234");
    assert.equal(commits[0].message, "feat: add timeout");
    assert.equal(commits[0].author, "Sergey");
});

test("parseCommits: parses multiple commit lines", () => {
    const raw = [
        "abc1234567890abcd\tfeat: add timeout\tSergey",
        "def5678901234567\tfix: null check\tAlex",
    ].join("\n") + "\n";
    const commits = parseCommits(raw);
    assert.equal(commits.length, 2);
    assert.equal(commits[0].sha, "abc1234");
    assert.equal(commits[1].sha, "def5678");
});

test("parseCommits: empty log returns empty array", () => {
    assert.deepEqual(parseCommits(""), []);
    assert.deepEqual(parseCommits("\n"), []);
});

test("parseCommits: sha truncated to 7 chars", () => {
    const raw = "1234567890abcdef\tmessage\tauthor\n";
    assert.equal(parseCommits(raw)[0].sha, "1234567");
});

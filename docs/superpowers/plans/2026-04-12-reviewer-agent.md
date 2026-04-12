# Reviewer Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/review-commits` skill that checks local git commits against the pattern base and reports only violations.

**Architecture:** Two components — `get-diff.mjs` (CLI helper: accepts a git ref, prints JSON with commits/diff/files) and `.claude/skills/review-commits/SKILL.md` (orchestrator: loads diff + patterns, identifies relevant patterns, analyses diff, writes report to `review/reports/`, prints to terminal). Pure functions exported from `get-diff.mjs` for unit testing; git operations isolated in thin wrappers.

**Tech Stack:** Node.js ESM (`.mjs`), `node:child_process` (`execSync`), `node:test` + `node:assert/strict`, no external dependencies.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `get-diff.mjs` | Create | CLI helper: normalise ref → run git → emit JSON |
| `get-diff.test.mjs` | Create | Unit tests for `normalizeRef` and `parseCommits` |
| `.claude/skills/review-commits/SKILL.md` | Create | Orchestrator skill for `/review-commits` |
| `.gitignore` | Modify | Add `review/reports/` so reports stay local |

---

## Task 1: `get-diff.mjs` — pure functions + tests

**Files:**
- Create: `get-diff.mjs`
- Create: `get-diff.test.mjs`

### Step 1 — Write failing tests

- [ ] Create `get-diff.test.mjs`:

```js
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
```

### Step 2 — Run tests, verify they fail

- [ ] Run:
```bash
node --test get-diff.test.mjs
```
Expected: `SyntaxError` or `ERR_MODULE_NOT_FOUND` — `get-diff.mjs` doesn't exist yet.

### Step 3 — Implement pure functions in `get-diff.mjs`

- [ ] Create `get-diff.mjs`:

```js
import { execSync } from "node:child_process";

// ─── Pure functions (exported for testing) ────────────────────────────────────

/**
 * Normalises a raw git ref argument into a two-dot range that both
 * `git log` and `git diff` accept.
 *
 * Supported inputs:
 *   HEAD~3          → HEAD~3..HEAD   (last N commits)
 *   HEAD            → HEAD^..HEAD    (last commit)
 *   abc123          → abc123^..abc123 (single SHA)
 *   abc123..def456  → abc123..def456  (explicit range, pass-through)
 */
export function normalizeRef(raw) {
    if (!raw || raw.trim() === "") throw new Error("Empty git ref");
    const trimmed = raw.trim();
    if (trimmed.includes("..")) return trimmed;
    if (/^HEAD~\d+$/.test(trimmed)) return `${trimmed}..HEAD`;
    return `${trimmed}^..${trimmed}`;
}

/**
 * Parses the raw stdout of `git log --format="%H\t%s\t%an"` into an array
 * of commit objects. SHA is truncated to 7 characters.
 */
export function parseCommits(rawLog) {
    return rawLog
        .split("\n")
        .filter(Boolean)
        .map((line) => {
            const [sha, message, author] = line.split("\t");
            return { sha: sha.slice(0, 7), message, author };
        });
}

// ─── Git wrappers ─────────────────────────────────────────────────────────────

export function runGitLog(range) {
    return execSync(`git log ${range} --format="%H\t%s\t%an"`, { encoding: "utf8" });
}

export function runGitDiff(range) {
    return execSync(`git diff ${range}`, { encoding: "utf8" });
}

export function runGitFilesChanged(range) {
    return execSync(`git diff --name-only ${range}`, { encoding: "utf8" })
        .split("\n")
        .filter(Boolean);
}

/**
 * Returns the full diff payload for a git ref.
 * Throws (from execSync) if the ref is invalid or not in a git repo.
 */
export function buildOutput(rawRef) {
    const range = normalizeRef(rawRef);
    const commits = parseCommits(runGitLog(range));
    const diff = runGitDiff(range);
    const files_changed = runGitFilesChanged(range);
    return { commits, diff, files_changed };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (process.argv[1] === new URL(import.meta.url).pathname) {
    const rawRef = process.argv[2] ?? "HEAD";
    try {
        const output = buildOutput(rawRef);
        process.stdout.write(JSON.stringify(output));
    } catch (e) {
        process.stderr.write(e.message + "\n");
        process.exit(1);
    }
}
```

### Step 4 — Run tests, verify they pass

- [ ] Run:
```bash
node --test get-diff.test.mjs
```
Expected: `12 pass, 0 fail`

### Step 5 — Smoke test the CLI

- [ ] Run:
```bash
node get-diff.mjs HEAD | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('commits:', d.commits.length, 'files:', d.files_changed.length)"
```
Expected: prints `commits: 1 files: N` (numbers > 0 since the repo has commits).

- [ ] Run error case:
```bash
node get-diff.mjs not-a-real-sha-xyz 2>&1; echo "exit: $?"
```
Expected: error message on stderr, `exit: 1`.

### Step 6 — Commit

- [ ] Commit:
```bash
git add get-diff.mjs get-diff.test.mjs
git commit -m "feat: add get-diff.mjs CLI helper with unit tests"
```

---

## Task 2: `.gitignore` — add `review/reports/`

**Files:**
- Modify: `.gitignore`

### Step 1 — Add reports dir to .gitignore

- [ ] Current `.gitignore` ends with `archive/`. Add one line:

```
review/reports/
```

The full file becomes:
```
.env
.env~
node_modules/
*.jsonl
*.meta.json
pending/
processed/
archive/
review/reports/
```

### Step 2 — Commit

- [ ] Commit:
```bash
git add .gitignore
git commit -m "chore: exclude review/reports/ from git (reports are local)"
```

---

## Task 3: `.claude/skills/review-commits/SKILL.md` — orchestrator skill

**Files:**
- Create: `.claude/skills/review-commits/SKILL.md`

> **Note:** Claude Code requires skills to be directories with a `SKILL.md` inside. The parent directory `.claude/skills/review-commits/` must be created too.

### Step 1 — Create the skill directory and SKILL.md

- [ ] Create `.claude/skills/review-commits/SKILL.md`:

````markdown
# Review Commits Skill

You are orchestrating the Review Commits pipeline for the Review Collector project.
Working directory is the root of the review-collector project.

## Purpose

Check local git commits against the pattern base and report only violations.
Main use case: verify your own commits before pushing.

---

## Step 1: Parse the argument

The skill is invoked as `/review-commits <arg>` where `<arg>` is optional.

**If no argument was given:** Ask the user: "Which commits should I review? (e.g. `HEAD~3`, a SHA, or `abc..def`)"

**If an argument was given**, determine the git ref:

| Input example | Git ref to use |
|---|---|
| `HEAD~3`, `HEAD~1` | Use as-is → becomes `HEAD~3..HEAD` in get-diff.mjs |
| `abc123` (40- or 7-char SHA) | Use as-is |
| `abc123..def456` | Use as-is |
| `HEAD` | Use as-is |
| "последние 3 коммита", "last 3 commits" | → `HEAD~3` |
| "последний коммит", "last commit" | → `HEAD` |
| "последние N коммитов", "last N commits" | → `HEAD~N` |

---

## Step 2: Get the diff

Run:
```bash
node get-diff.mjs <git-ref>
```

Read the JSON from stdout. It has the shape:
```json
{
  "commits": [{ "sha": "abc1234", "message": "...", "author": "..." }],
  "diff": "<unified diff>",
  "files_changed": ["src/foo.ts"]
}
```

If the command exits with code 1, stop and report the error to the user.

---

## Step 3: Check patterns file

Read `patterns/review-patterns.json`.

If the file does not exist, stop with:
> "Patterns not found. Run `/mine-patterns` first."

---

## Step 4: Identify relevant patterns

Look at the diff and the list of changed files. Select the patterns from `review-patterns.json` that are plausibly applicable to this diff.

Criteria for inclusion — include a pattern if ANY of:
- The pattern's `category` matches something visible in the diff (e.g. a pattern about `security` is worth checking whenever credentials, tokens, or auth logic appear)
- Keywords in the pattern's `rule` or `title` match identifiers, function names, or concepts visible in the diff
- The pattern describes a type of code structure that is present (e.g. pagination params, HTTP calls, database queries)

You do NOT need to apply every pattern. Skip patterns that are clearly irrelevant to the changed code.

---

## Step 5: Analyse the diff against selected patterns

For each selected pattern, examine the diff carefully. A violation exists when the diff introduces or modifies code that breaks the pattern's `rule`.

**Only flag actual violations** — do not flag code that is unchanged, and do not flag theoretical risks.

For each violation, note:
- Pattern ID and title
- The file path and approximate line number (from the diff `+++ b/...` and `@@` headers)
- The specific code fragment that violates the rule (copy from the `+` lines in the diff)
- A concise explanation of why it violates the pattern

---

## Step 6: Compose the report

Determine the short SHA: use the first SHA from `commits[0].sha` (7 chars).
Determine the commit count label:
- 1 commit → `"<sha> (1 commit)"`
- N commits → `"<first-sha>..<last-sha> (N commits)"`

### If violations found:

```markdown
# Code Review Report

**Commits:** <label>
**Date:** <YYYY-MM-DD>

---

## <pattern-id> · <pattern-title>

**Файл:** `<file-path>:<line>`
**Фрагмент:** `<code snippet from diff>`
**Проблема:** <concise explanation>

---

## <next pattern-id> · <next pattern-title>

...
```

### If no violations:

```markdown
# Code Review Report

**Commits:** <label>
**Date:** <YYYY-MM-DD>

✅ Нарушений паттернов не найдено.
```

---

## Step 7: Save the report

Save the report to:
```
review/reports/<YYYY-MM-DD>-<short-sha>.md
```

Create the `review/reports/` directory if it doesn't exist (use the Bash tool: `mkdir -p review/reports`).

Write the file using the Write tool.

---

## Step 8: Output to terminal

Print the full report to the terminal (output it as your response text).

Then print:
```
Report saved: review/reports/<YYYY-MM-DD>-<short-sha>.md
```
````

### Step 2 — Verify the skill file is readable

- [ ] Run:
```bash
cat .claude/skills/review-commits/SKILL.md | head -5
```
Expected: prints the first 5 lines of the skill file without error.

### Step 3 — Commit

- [ ] Commit:
```bash
git add .claude/skills/review-commits/SKILL.md
git commit -m "feat: add /review-commits skill orchestrator"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ `get-diff.mjs` CLI helper with JSON output — Task 1
- ✅ Supported arg formats (HEAD~N, SHA, range, HEAD, free text) — Task 1 (normalizeRef) + Task 3 (SKILL.md Step 1)
- ✅ Exit codes 0/1 — Task 1 Step 3 (CLI entry point)
- ✅ Pattern file not found → error message — Task 3 SKILL.md Step 3
- ✅ Agent selects relevant patterns (not all) — Task 3 SKILL.md Step 4
- ✅ Only violations in report — Task 3 SKILL.md Step 6
- ✅ No "checked but passed" section — SKILL.md Step 6 (only two branches: violations or ✅ line)
- ✅ Report saved to `review/reports/YYYY-MM-DD-<sha>.md` — Task 3 SKILL.md Steps 7-8
- ✅ Terminal output + file path — Task 3 SKILL.md Step 8
- ✅ `review/reports/` in .gitignore — Task 2
- ✅ Pure functions exported, CLI entry protected — Task 1 Step 3

**Type consistency:** `buildOutput` returns `{ commits, diff, files_changed }` — SKILL.md Step 2 uses those exact field names. `parseCommits` returns `{ sha, message, author }` — SKILL.md uses `commits[0].sha`. All consistent.

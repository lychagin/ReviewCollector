# Fix Preprocessor Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `preprocess-comments.mjs` to read from `review/raw/pending/` and automatically move processed files to `review/raw/processed/`, eliminating the manual `mv` step.

**Architecture:** Change `main()` in `preprocess-comments.mjs` to use `review/raw/pending/` as the source directory and `review/raw/processed/` as the destination. After successfully processing each `.jsonl` file, rename both the `.jsonl` and the corresponding `.meta.json` (if it exists) to `review/raw/processed/`. Export a `moveToProcessed` helper for testability. Update all documentation to reflect the new automated lifecycle.

**Tech Stack:** Node.js ESM, `node:fs` (`renameSync`, `mkdirSync`), `node:test` + `node:assert/strict`

---

### Task 1: Fix `preprocess-comments.mjs` — read from pending/, move to processed/

**Files:**
- Modify: `preprocess-comments.mjs:1-2` (add `renameSync` import)
- Modify: `preprocess-comments.mjs:157-185` (`main()` function)
- Add export: `moveToProcessed` function (new, before `main()`)

- [ ] **Step 1: Write the failing integration test**

Add to `preprocess-comments.test.mjs` (before last line):

```js
import { renameSync as fsRenameSync } from "node:fs";
import { moveToProcessed } from "./preprocess-comments.mjs";

test("moveToProcessed: moves .jsonl and .meta.json to processed dir", () => {
    const dir = mkdtempSync(pathJoin(tmpdir(), "rc-test-"));
    const pendingDir = pathJoin(dir, "pending");
    const processedDir = pathJoin(dir, "processed");
    mkdirSync(pendingDir, { recursive: true });
    mkdirSync(processedDir, { recursive: true });
    const filename = "mr-notes-2026-04-12.jsonl";
    const metaname = "mr-notes-2026-04-12.meta.json";
    fsWriteFileSync(pathJoin(pendingDir, filename), "{}");
    fsWriteFileSync(pathJoin(pendingDir, metaname), "{}");
    try {
        moveToProcessed(pendingDir, processedDir, filename);
        assert.ok(existsSync(pathJoin(processedDir, filename)), ".jsonl moved");
        assert.ok(existsSync(pathJoin(processedDir, metaname)), ".meta.json moved");
        assert.ok(!existsSync(pathJoin(pendingDir, filename)), ".jsonl removed from pending");
        assert.ok(!existsSync(pathJoin(pendingDir, metaname)), ".meta.json removed from pending");
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("moveToProcessed: works when .meta.json absent", () => {
    const dir = mkdtempSync(pathJoin(tmpdir(), "rc-test-"));
    const pendingDir = pathJoin(dir, "pending");
    const processedDir = pathJoin(dir, "processed");
    mkdirSync(pendingDir, { recursive: true });
    mkdirSync(processedDir, { recursive: true });
    const filename = "mr-notes-2026-04-12.jsonl";
    fsWriteFileSync(pathJoin(pendingDir, filename), "{}");
    try {
        moveToProcessed(pendingDir, processedDir, filename);
        assert.ok(existsSync(pathJoin(processedDir, filename)), ".jsonl moved");
    } finally {
        rmSync(dir, { recursive: true });
    }
});
```

Note: `existsSync` is already imported in the test file from `"node:fs"`. Add it to the existing import if needed.

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test preprocess-comments.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` or `moveToProcessed is not exported` for the new tests. All existing 17 tests pass.

- [ ] **Step 3: Add `renameSync` to the import in `preprocess-comments.mjs`**

Change line 1 from:
```js
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
```
to:
```js
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync } from "node:fs";
```

- [ ] **Step 4: Add `moveToProcessed` export before `main()`**

Insert after `writeThreadsJsonl` function (after line 153) and before the `// ─── CLI entry point` comment:

```js
/**
 * Moves a processed .jsonl file (and its .meta.json if present)
 * from pendingDir to processedDir.
 */
export function moveToProcessed(pendingDir, processedDir, filename) {
    renameSync(join(pendingDir, filename), join(processedDir, filename));
    const metaname = filename.replace(/\.jsonl$/, ".meta.json");
    const metaSrc = join(pendingDir, metaname);
    if (existsSync(metaSrc)) {
        renameSync(metaSrc, join(processedDir, metaname));
    }
}
```

- [ ] **Step 5: Rewrite `main()` to use the correct directories**

Replace the entire `main()` function (lines 157-185) with:

```js
function main() {
    const projectDir = new URL(".", import.meta.url).pathname;
    const pendingDir = join(projectDir, "review", "raw", "pending");
    const processedDir = join(projectDir, "review", "raw", "processed");
    const patternsDir = join(projectDir, "patterns");

    mkdirSync(patternsDir, { recursive: true });
    mkdirSync(processedDir, { recursive: true });

    const state = loadState(patternsDir);
    const newFiles = detectNewFiles(pendingDir, state.processed_files);

    if (newFiles.length === 0) {
        console.log("No new files to process.");
        return;
    }

    const allThreads = [];
    for (const filename of newFiles) {
        const filePath = join(pendingDir, filename);
        const records = readJsonlFile(filePath);
        const threads = buildThreads(records);
        allThreads.push(...threads);
        state.processed_files.push(filename);
        moveToProcessed(pendingDir, processedDir, filename);
    }

    writeThreadsJsonl(patternsDir, allThreads);
    saveState(patternsDir, state);

    console.log(`Processed ${newFiles.length} new file(s), ${allThreads.length} threads written to patterns/threads.jsonl`);
}
```

- [ ] **Step 6: Run all tests to verify they pass**

```bash
node --test preprocess-comments.test.mjs
```

Expected: all tests pass (17 existing + 2 new = 19 total). Zero failures.

- [ ] **Step 7: Smoke test with real filesystem**

```bash
ls review/raw/pending/
node preprocess-comments.mjs
ls review/raw/processed/
```

Expected: files that were in `pending/` are now in `processed/`, `patterns/threads.jsonl` written.

- [ ] **Step 8: Commit**

```bash
git add preprocess-comments.mjs preprocess-comments.test.mjs
git commit -m "fix: preprocess-comments reads from review/raw/pending/, auto-moves to processed/"
```

---

### Task 2: Update `mining-state.json` — reset stale state

The current `patterns/mining-state.json` lists `mr-notes-test.jsonl` and `mr-notes-smoke.jsonl` as already processed, but they were never actually read from the correct path. Reset it so the next run picks them up from their actual location.

**Files:**
- Modify: `patterns/mining-state.json`

- [ ] **Step 1: Check where the files actually are now**

```bash
ls review/raw/pending/
ls review/raw/processed/
```

- [ ] **Step 2: Reset mining-state.json**

Overwrite `patterns/mining-state.json` with:

```json
{
  "schema_version": "1.0",
  "processed_files": [],
  "raw_patterns": [],
  "last_updated": null
}
```

- [ ] **Step 3: If files are in processed/ (moved there manually earlier), move them back to pending/**

```bash
mv review/raw/processed/mr-notes-*.jsonl review/raw/pending/ 2>/dev/null || true
mv review/raw/processed/mr-notes-*.meta.json review/raw/pending/ 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
git add patterns/mining-state.json
git commit -m "fix: reset mining-state — stale processed_files from wrong-path runs"
```

---

### Task 3: Update documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/pattern-mining-usage.md`
- Modify: `PROGRESS.md`
- Modify: `.claude/skills/mine-patterns/SKILL.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `README.md` — remove manual mv, describe automated lifecycle**

In section "### Управление файлами", replace the paragraph starting with "После того как файлы из `pending/` проверены/обработаны, перемести их в `processed/` вручную." with:

```markdown
### Анализ паттернов

После сбора запусти Pattern Mining — он прочитает файлы из `pending/` и автоматически
переместит их в `processed/` после успешной обработки:

```
/mine-patterns
```

Либо запусти препроцессор напрямую (без LLM-анализа):

```bash
node preprocess-comments.mjs
# Переместит файлы из review/raw/pending/ → review/raw/processed/
# Запишет patterns/threads.jsonl
```
```

Also update the lifecycle diagram in the "Управление файлами" section to remove any mention of manual `mv`.

- [ ] **Step 2: Update `docs/pattern-mining-usage.md` — remove manual mv steps**

Replace the "Типичный рабочий сценарий" section with:

```markdown
## Типичный рабочий сценарий

```bash
# 1. Собрать комментарии (Extraction Tool)
node collect-mr-comments.mjs --period 3m

# 2. Запустить Pattern Mining
/mine-patterns
```

Скилл автоматически:
- Читает новые файлы из `review/raw/pending/`
- Переносит каждый обработанный файл в `review/raw/processed/`
- Пишет `patterns/threads.jsonl`, обновляет `patterns/mining-state.json`
- Выполняет LLM-анализ (Pass 1 + Pass 2)
```

Replace the Troubleshooting entry:
```markdown
**`preprocess-comments.mjs` не находит новых файлов**
- Убедись что файлы находятся в `review/raw/pending/`
- Проверь `mining-state.json` → `processed_files` — возможно файл уже отмечен как обработанный
  (был обработан в предыдущем запуске и перемещён в `review/raw/processed/`)
```

Also update the smoke-test section: replace `ls processed/` with `ls review/raw/pending/` and `ls review/raw/processed/`.

- [ ] **Step 3: Update `PROGRESS.md` — fix lifecycle description**

Find the section describing the lifecycle directories (around line 54):

```
review/raw/
  pending/     ← новые экспорты (ждут проверки)
  processed/   ← проверенные, готовы к анализу
```

Add a note below it:

```
  # Lifecycle управляется автоматически:
  # collect-mr-comments.mjs → pending/
  # preprocess-comments.mjs → читает pending/, перемещает в processed/
```

Also update any description of the pipeline flow that mentions manual steps.

- [ ] **Step 4: Update `.claude/skills/mine-patterns/SKILL.md` — fix Step 1 description**

In "Step 1: Run preprocessor", update the description of what the preprocessor does:

After the `node preprocess-comments.mjs` block, update the bullet about output:
```markdown
Read the output:
- If output is "No new files to process." → no `.jsonl` files in `review/raw/pending/`, skip Pass 1, go directly to Pass 2
- If output starts with "Processed" → note how many threads were written, files have been moved to `review/raw/processed/`, proceed to Pass 1
- If it exits with an error → stop and report the error to the user
```

- [ ] **Step 5: Update `CLAUDE.md` — fix project structure description**

Find the `processed/` entry in the structure and update:

```markdown
  review/raw/
    pending/   ← новые экспорты из collect-mr-comments.mjs
    processed/ ← после обработки prepropcess-comments.mjs (перемещается автоматически)
  patterns/    ← выход pattern mining
```

- [ ] **Step 6: Commit all docs**

```bash
git add README.md docs/pattern-mining-usage.md PROGRESS.md .claude/skills/mine-patterns/SKILL.md CLAUDE.md
git commit -m "docs: update pipeline docs — preprocessor auto-moves files from pending/ to processed/"
```

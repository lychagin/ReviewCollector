# GitLab MR Comments Extractor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разделить существующий тул `mcp-get-comments` на две чистые части — "только сбор комментариев из GitLab MR в плоский JSONL" (этот подпроект) и "анализ паттернов" (отдельный скилл, не в этом плане). Старый LLM-пайплайн уезжает в `legacy/`, совместимость с действующими MCP tools (`get_mr_comments`, `reply_to_discussion`, `resolve_mr_discussion`) сохраняется полностью.

**Architecture:** Новый модуль `mr-comments-collector.mjs` делает fetch → filter → flatten → write. CLI `collect-mr-comments.mjs` — тонкая обёртка над ним. `index.js` переключается со старого `collect_review_patterns` на новый `collect_mr_comments` MCP tool, импортирует из нового модуля вместо `llm-client.mjs`. Сырые файлы живут в lifecycle `pending/` → `processed/` → `archive/YYYY-MM/`.

**Tech Stack:** Node.js 20 (ESM), встроенный `node:test` для unit-тестов (без внешних зависимостей), существующий `gitlab-client.mjs` как GitLab API абстракция, MCP SDK `@modelcontextprotocol/sdk`.

**Spec:** `.docs/superpowers/specs/2026-04-10-gitlab-mr-comments-extractor-design.md`

---

## Критический инвариант

**`gitlab-client.mjs` трогать нельзя** — его импортирует `index.js` для действующих MCP tools, которые используются скиллами `/get-comment` и `/reply-comment`. Поломка = сломанные скиллы.

**Порядок миграции критичен:** сначала создаём новое, потом удаляем старое. `llm-client.mjs` переезжает в `legacy/` **только после** того как `index.js` перестанет из него импортировать.

---

## File Map

| Файл | Действие | Назначение |
|---|---|---|
| `.scripts/mcp/mcp-servers/mcp-get-comments/legacy/` | Create | Каталог для старых файлов |
| `.scripts/mcp/mcp-servers/mcp-get-comments/legacy/gitlab-review-collector.mjs` | Move | Старый пайплайн с LLM |
| `.scripts/mcp/mcp-servers/mcp-get-comments/legacy/collect-review-patterns.mjs` | Move | Старый CLI |
| `.scripts/mcp/mcp-servers/mcp-get-comments/legacy/test-llm.mjs` | Move | Старый тест LLM endpoint |
| `.scripts/mcp/mcp-servers/mcp-get-comments/legacy/llm-client.mjs` | Move (после правки index.js) | OpenAI-совместимый клиент |
| `.scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.mjs` | Create | Core модуль: fetch + filter + flatten + write |
| `.scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.test.mjs` | Create | Unit-тесты для pure функций |
| `.scripts/mcp/mcp-servers/mcp-get-comments/collect-mr-comments.mjs` | Create | Новый CLI |
| `.scripts/mcp/mcp-servers/mcp-get-comments/index.js` | Modify | Убрать старый tool, добавить новый |
| `.scripts/mcp/mcp-servers/mcp-get-comments/.env` | Modify | Убрать LLM_*, добавить BOT_USERNAME_PATTERNS |
| `.scripts/mcp/mcp-servers/mcp-get-comments/gitlab-client.mjs` | **Не трогать** | Используется MCP-сервером |
| `.scripts/mcp/mcp-servers/mcp-get-comments/Archi.md` | Modify | Обновить архитектуру под новый тул |
| `.scripts/mcp/mcp-servers/mcp-get-comments/USAGE.md` | Modify | Обновить примеры использования |
| `.scripts/mcp/mcp-servers/mcp-get-comments/README.md` | Modify | Обновить краткое описание |

---

## Task 1: Создать legacy/ и переместить standalone файлы

**Цель:** Убрать из корня 3 файла, которые не импортируются никем другим (`gitlab-review-collector.mjs` импортирует `llm-client.mjs`, но его самого никто не импортирует; `collect-review-patterns.mjs` и `test-llm.mjs` — standalone).

**Проверено:** grep показал, что из корня директории только `index.js` импортирует `./llm-client.mjs`. На `gitlab-review-collector.mjs`, `collect-review-patterns.mjs`, `test-llm.mjs` никто не ссылается — их можно двигать свободно.

**Files:**
- Create: `.scripts/mcp/mcp-servers/mcp-get-comments/legacy/` (директория)
- Move: `.scripts/mcp/mcp-servers/mcp-get-comments/gitlab-review-collector.mjs` → `legacy/`
- Move: `.scripts/mcp/mcp-servers/mcp-get-comments/collect-review-patterns.mjs` → `legacy/`
- Move: `.scripts/mcp/mcp-servers/mcp-get-comments/test-llm.mjs` → `legacy/`

- [ ] **Step 1: Создать каталог legacy/**

```bash
mkdir -p .scripts/mcp/mcp-servers/mcp-get-comments/legacy
```

- [ ] **Step 2: Переместить 3 файла через git mv (сохраняет историю)**

```bash
cd .scripts/mcp/mcp-servers/mcp-get-comments
git mv gitlab-review-collector.mjs legacy/
git mv collect-review-patterns.mjs legacy/
git mv test-llm.mjs legacy/
```

- [ ] **Step 3: Исправить относительные импорты в перемещённых файлах**

Файл `legacy/gitlab-review-collector.mjs` импортирует `./gitlab-client.mjs` и `./llm-client.mjs`. После перемещения эти пути должны стать `../gitlab-client.mjs` и `../llm-client.mjs` (llm-client ещё в корне).

Open `.scripts/mcp/mcp-servers/mcp-get-comments/legacy/gitlab-review-collector.mjs`, найти:

```js
} from "./gitlab-client.mjs";
```
Заменить на:
```js
} from "../gitlab-client.mjs";
```

Найти:
```js
import { loadLlmConfig, clusterComments as llmClusterComments, generateMarkdownReport } from "./llm-client.mjs";
```
Заменить на:
```js
import { loadLlmConfig, clusterComments as llmClusterComments, generateMarkdownReport } from "../llm-client.mjs";
```

Файл `legacy/collect-review-patterns.mjs` импортирует `./gitlab-review-collector.mjs` — теперь оба в `legacy/`, импорт остаётся относительным (`./gitlab-review-collector.mjs`). **Проверить и оставить как есть.**

Файл `legacy/test-llm.mjs` импортирует `./gitlab-client.mjs` и `./llm-client.mjs`. Заменить оба на `../gitlab-client.mjs` и `../llm-client.mjs`.

- [ ] **Step 4: Проверить синтаксис всех перемещённых файлов**

```bash
node --check .scripts/mcp/mcp-servers/mcp-get-comments/legacy/gitlab-review-collector.mjs
node --check .scripts/mcp/mcp-servers/mcp-get-comments/legacy/collect-review-patterns.mjs
node --check .scripts/mcp/mcp-servers/mcp-get-comments/legacy/test-llm.mjs
```

Ожидается: все три команды завершаются без вывода (exit 0).

- [ ] **Step 5: Проверить что index.js всё ещё загружается**

```bash
node --check .scripts/mcp/mcp-servers/mcp-get-comments/index.js
```

Ожидается: exit 0. Если ошибка — значит `index.js` импортирует что-то из перемещённых файлов, проверить diff миграции.

- [ ] **Step 6: Commit**

```bash
git add .scripts/mcp/mcp-servers/mcp-get-comments/legacy/
git commit -m "refactor(review-collector): move LLM pipeline to legacy/

Перемещаем gitlab-review-collector.mjs, collect-review-patterns.mjs,
test-llm.mjs в legacy/ для последующей замены новым extraction tool.
llm-client.mjs пока остаётся в корне — его ещё импортирует index.js,
переместим отдельным шагом после правки index.js.

Refs: .docs/superpowers/specs/2026-04-10-gitlab-mr-comments-extractor-design.md"
```

---

## Task 2: Создать скелет mr-comments-collector.mjs с pure функциями

**Цель:** Завести core-модуль с чистыми функциями которые легко тестировать: `globToRegex`, `isBot`, `parsePeriod`, `flattenNote`, `dedupeMrsByIid`, `detectDiscussionKind`. Без IO и без сети.

**Files:**
- Create: `.scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.mjs`

- [ ] **Step 1: Создать файл с pure функциями**

Создать `.scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.mjs`:

```js
/**
 * MR Comments Collector — core module.
 *
 * Собирает комментарии из GitLab Merge Request'ов за период и сохраняет
 * в плоский JSONL формат для последующего анализа паттернов ревью.
 *
 * См. .docs/superpowers/specs/2026-04-10-gitlab-mr-comments-extractor-design.md
 */

export const SCHEMA_VERSION = "1.0";

export const DEFAULT_BOT_PATTERNS = ["*-bot", "*_bot", "ghost"];

/**
 * Конвертирует glob-паттерн (* как wildcard) в regex.
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegex(glob) {
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const withWildcard = escaped.replace(/\*/g, ".*");
    return new RegExp(`^${withWildcard}$`);
}

/**
 * Проверяет, является ли username ботом по списку glob-паттернов.
 * @param {string} username
 * @param {string[]} patterns
 * @returns {boolean}
 */
export function isBot(username, patterns) {
    if (!username) return false;
    return patterns.some((p) => globToRegex(p).test(username));
}

/**
 * Преобразует строку периода (3m, 30d, 1y) в диапазон ISO дат.
 * @param {string} period
 * @returns {{ from: string, to: string }}
 */
export function parsePeriod(period) {
    const match = period.match(/^(\d+)(d|m|y)$/i);
    if (!match) {
        throw new Error(`Неверный формат периода: "${period}". Ожидается: 3m, 30d, 1y`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    const to = new Date();
    const from = new Date(to);

    if (unit === "d") from.setDate(from.getDate() - value);
    else if (unit === "m") from.setMonth(from.getMonth() - value);
    else if (unit === "y") from.setFullYear(from.getFullYear() - value);

    return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * Убирает дубликаты MR по iid (первое вхождение сохраняется).
 * @param {Array<{iid: number}>} mrs
 * @returns {Array<{iid: number}>}
 */
export function dedupeMrsByIid(mrs) {
    const seen = new Set();
    const result = [];
    for (const mr of mrs) {
        if (seen.has(mr.iid)) continue;
        seen.add(mr.iid);
        result.push(mr);
    }
    return result;
}

/**
 * Определяет тип discussion: "diff" (inline комментарий к коду) или "overview" (общий).
 * @param {object} note - GitLab note
 * @returns {"diff" | "overview"}
 */
export function detectDiscussionKind(note) {
    if (note.type === "DiffNote") return "diff";
    if (note.position) return "diff";
    return "overview";
}

/**
 * Преобразует GitLab note в плоскую запись согласно схеме.
 * @param {object} mr - MR объект из GitLab API
 * @param {object} discussion - Discussion объект из GitLab API
 * @param {object} note - Note внутри discussion.notes
 * @param {number} noteIndex - индекс note в discussion.notes (0-based)
 * @param {string} projectPath - путь проекта
 * @param {string} exportedAt - ISO timestamp
 * @returns {object} flat record
 */
export function flattenNote(mr, discussion, note, noteIndex, projectPath, exportedAt) {
    const rootNote = discussion.notes[0];
    const isRoot = noteIndex === 0;
    const position = note.position || null;
    const discussionKind = detectDiscussionKind(note);

    return {
        schema_version: SCHEMA_VERSION,
        project_path: projectPath,

        mr_iid: mr.iid,
        mr_title: mr.title,
        mr_state: mr.state,
        mr_created_at: mr.created_at,
        mr_merged_at: mr.merged_at ?? null,
        mr_author_username: mr.author?.username ?? "",
        mr_author_name: mr.author?.name ?? "",
        mr_web_url: mr.web_url,
        mr_labels: mr.labels ?? [],

        discussion_id: discussion.id,
        discussion_kind: discussionKind,
        discussion_resolved: rootNote.resolved ?? false,
        discussion_resolved_by_username: rootNote.resolved_by?.username ?? null,
        discussion_resolved_at: rootNote.resolved_at ?? null,
        discussion_notes_count: discussion.notes.length,

        note_id: note.id,
        note_body: note.body,
        note_author_username: note.author?.username ?? "",
        note_author_name: note.author?.name ?? "",
        note_created_at: note.created_at,
        note_type: note.type ?? "Note",

        is_root_note: isRoot,
        reply_index_in_discussion: noteIndex,
        thread_root_note_id: rootNote.id,
        parent_note_id: isRoot ? null : rootNote.id,

        note_by_mr_author: note.author?.username === mr.author?.username,

        file_path: position?.new_path ?? position?.old_path ?? null,
        new_line: position?.new_line ?? null,
        old_line: position?.old_line ?? null,
        line_range_start: position?.line_range?.start?.new_line ?? position?.new_line ?? null,
        line_range_end: position?.line_range?.end?.new_line ?? position?.new_line ?? null,

        has_suggestions:
            (note.suggestions?.length ?? 0) > 0 || /```suggestion/.test(note.body ?? ""),

        exported_at: exportedAt,
    };
}
```

- [ ] **Step 2: Проверить синтаксис**

```bash
node --check .scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.mjs
```

Ожидается: exit 0.

- [ ] **Step 3: Commit**

```bash
git add .scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.mjs
git commit -m "feat(review-collector): add core module skeleton with pure functions

Pure-функции для нового extraction tool:
- globToRegex / isBot — фильтрация ботов через glob-паттерны
- parsePeriod — 3m/30d/1y → ISO диапазон
- dedupeMrsByIid — дедупликация после merged+closed запросов
- detectDiscussionKind — diff vs overview
- flattenNote — нормализация в плоскую запись согласно schema 1.0

IO и сетевая логика будут добавлены отдельными шагами."
```

---

## Task 3: Unit-тесты для pure функций

**Цель:** Зафиксировать поведение pure-функций тестами. Используем встроенный `node:test` — никаких внешних зависимостей.

**Files:**
- Create: `.scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.test.mjs`

- [ ] **Step 1: Создать test файл**

Создать `.scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    SCHEMA_VERSION,
    DEFAULT_BOT_PATTERNS,
    globToRegex,
    isBot,
    parsePeriod,
    dedupeMrsByIid,
    detectDiscussionKind,
    flattenNote,
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
```

- [ ] **Step 2: Запустить тесты**

```bash
cd .scripts/mcp/mcp-servers/mcp-get-comments
node --test mr-comments-collector.test.mjs
```

Ожидается: все 15 тестов PASS, итоговое сообщение `# pass 15`, exit 0.

Если какой-то тест падает — НЕ коммитить, починить реализацию или тест.

- [ ] **Step 3: Commit**

```bash
git add .scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.test.mjs
git commit -m "test(review-collector): unit tests for pure functions

15 тестов через node:test для:
- globToRegex / isBot (фильтр ботов)
- parsePeriod (периоды 3m/30d/1y)
- dedupeMrsByIid
- detectDiscussionKind (diff vs overview)
- flattenNote (root note, reply, overview, suggestion detection)

Используем встроенный node:test, без внешних зависимостей."
```

---

## Task 4: Добавить IO-функции: writeJsonlAtomic, writeMeta, findOverlappingExports

**Цель:** Атомарная запись JSONL (через .tmp + rename), sidecar meta.json, проверка пересекающихся периодов для идемпотентности.

**Files:**
- Modify: `.scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.mjs`

- [ ] **Step 1: Добавить импорты и IO-функции в модуль**

В `mr-comments-collector.mjs` **в самом верху файла** (перед первой строкой документации или сразу после неё) добавить импорты:

```js
import { writeFileSync, readFileSync, mkdirSync, renameSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
```

Затем **дописать в конец файла** новые функции:

```js

/**
 * Атомарная запись JSONL: сначала в .tmp, потом rename.
 * @param {string} path
 * @param {object[]} records
 */
export function writeJsonlAtomic(path, records) {
    mkdirSync(dirname(path), { recursive: true });
    const tmpPath = `${path}.tmp`;
    const content = records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, path);
}

/**
 * Запись sidecar meta.json.
 * @param {string} path
 * @param {object} meta
 */
export function writeMeta(path, meta) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(meta, null, 2), "utf-8");
}

/**
 * Проверяет пересечение периода [from, to] с уже существующими экспортами.
 * Читает все *.meta.json в pending/ и processed/, проверяет period_from/period_to.
 * @param {string} outputRoot - корень lifecycle (где pending/, processed/)
 * @param {string} from - ISO
 * @param {string} to - ISO
 * @returns {Array<{file: string, period_from: string, period_to: string}>}
 */
export function findOverlappingExports(outputRoot, from, to) {
    const overlaps = [];
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();

    for (const subdir of ["pending", "processed"]) {
        const dirPath = join(outputRoot, subdir);
        if (!existsSync(dirPath)) continue;

        const files = readdirSync(dirPath).filter((f) => f.endsWith(".meta.json"));
        for (const file of files) {
            const fullPath = join(dirPath, file);
            try {
                const meta = JSON.parse(readFileSync(fullPath, "utf-8"));
                if (!meta.period_from || !meta.period_to) continue;
                const existingFrom = new Date(meta.period_from).getTime();
                const existingTo = new Date(meta.period_to).getTime();
                // Пересечение: NOT (existingTo < fromMs OR existingFrom > toMs)
                if (!(existingTo < fromMs || existingFrom > toMs)) {
                    overlaps.push({
                        file: fullPath,
                        period_from: meta.period_from,
                        period_to: meta.period_to,
                    });
                }
            } catch {
                // broken meta — игнорируем
            }
        }
    }

    return overlaps;
}

/**
 * Генерирует datetime-строку для имени файла: "2026-04-10T15-00-00".
 * @returns {string}
 */
export function formatFileDateTime(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
```

- [ ] **Step 2: Добавить тесты для IO-функций**

В `mr-comments-collector.test.mjs` **дополнить импорты в самом верху файла**. Найти существующий блок импортов из Task 3:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    SCHEMA_VERSION,
    DEFAULT_BOT_PATTERNS,
    globToRegex,
    isBot,
    parsePeriod,
    dedupeMrsByIid,
    detectDiscussionKind,
    flattenNote,
} from "./mr-comments-collector.mjs";
```

Заменить на:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
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
} from "./mr-comments-collector.mjs";
```

Затем **дописать в конец файла** новые тесты:

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
```

- [ ] **Step 3: Запустить все тесты**

```bash
cd .scripts/mcp/mcp-servers/mcp-get-comments
node --test mr-comments-collector.test.mjs
```

Ожидается: все 22 теста PASS (15 старых + 7 новых), exit 0.

- [ ] **Step 4: Commit**

```bash
git add .scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.mjs .scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.test.mjs
git commit -m "feat(review-collector): add IO helpers

- writeJsonlAtomic: атомарная запись через .tmp + rename
- writeMeta: sidecar .meta.json с pretty JSON
- findOverlappingExports: проверка пересекающихся периодов
  в pending/ и processed/ для идемпотентности
- formatFileDateTime: FS-safe имя файла из Date

+ 7 unit-тестов для всех новых функций."
```

---

## Task 5: Реализовать основную функцию `collectMrComments`

**Цель:** Собрать всё вместе: запросы к GitLab (merged + closed), дедупликация, fetch discussions, фильтрация, flattening, запись JSONL + meta. Использовать существующий `gitlab-client.mjs`.

**Files:**
- Modify: `.scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.mjs`

- [ ] **Step 1: Добавить импорты из gitlab-client и основную функцию**

В `mr-comments-collector.mjs` **в верхней части файла** (рядом с импортами из Task 4) добавить:

```js
import {
    loadConfig,
    createGitlabClient,
    fetchMrDiscussions,
    sleep,
} from "./gitlab-client.mjs";
```

Затем **дописать в конец файла** вспомогательную функцию и основную `collectMrComments`:

```js

/**
 * Получить список MR за период с фильтром по state.
 * Не используем fetchMrList из gitlab-client.mjs потому что он
 * хардкодит state=merged и не принимает параметр state в options.
 *
 * @param {Function} gitlabApiPaginated
 * @param {string} projectPath
 * @param {{from: string, to: string, state: string}} opts
 * @returns {Promise<object[]>}
 */
async function fetchMrListByState(gitlabApiPaginated, projectPath, { from, to, state }) {
    const params = new URLSearchParams({
        state,
        order_by: "updated_at",
        sort: "desc",
        updated_after: from,
        updated_before: to,
    });
    const endpoint = `/projects/${encodeURIComponent(projectPath)}/merge_requests?${params.toString()}`;
    return gitlabApiPaginated(endpoint);
}

/**
 * Полный пайплайн сбора комментариев из MR.
 *
 * @param {object} options
 * @param {string} options.projectPath - GitLab project path
 * @param {string} options.from - ISO дата начала
 * @param {string} options.to - ISO дата конца
 * @param {string[]} options.states - ["merged", "closed"]
 * @param {string} options.outputDir - каталог куда писать (будет создан подкаталог pending/)
 * @param {string[]} [options.botPatterns] - glob-паттерны ботов
 * @param {boolean} [options.force] - игнорировать warning о пересечении
 * @param {boolean} [options.verbose]
 * @returns {Promise<{outputPath: string, metaPath: string, stats: object, overlaps: object[]}>}
 */
export async function collectMrComments(options) {
    const {
        projectPath,
        from,
        to,
        states,
        outputDir,
        botPatterns = DEFAULT_BOT_PATTERNS,
        force = false,
        verbose = false,
    } = options;

    if (!projectPath) throw new Error("projectPath обязателен");
    if (!from || !to) throw new Error("from и to обязательны");
    if (!states || states.length === 0) throw new Error("states не может быть пустым");

    const config = loadConfig();
    if (!config.GITLAB_TOKEN) {
        throw new Error("GITLAB_TOKEN не задан. Укажите в .env или ~/.cursor/gitlab-token");
    }

    const { gitlabApiPaginated } = createGitlabClient(config.GITLAB_TOKEN, config.GITLAB_URL);

    // 1. Проверка идемпотентности
    const overlaps = findOverlappingExports(outputDir, from, to);
    if (overlaps.length > 0 && !force) {
        console.error(`[WARN] Найдены ${overlaps.length} пересекающихся экспорта:`);
        for (const o of overlaps) {
            console.error(`  ${o.file} (${o.period_from} — ${o.period_to})`);
        }
        console.error(`Используйте --force чтобы продолжить, либо удалите старые файлы.`);
        return { overlaps, cancelled: true };
    }

    // 2. Сбор MR для каждого state, дедупликация
    let allMrs = [];
    for (const state of states) {
        if (verbose) console.error(`Получение MR (state=${state})...`);
        const mrs = await fetchMrListByState(gitlabApiPaginated, projectPath, { from, to, state });
        if (verbose) console.error(`  state=${state}: ${mrs.length} MR`);
        allMrs.push(...mrs);
    }
    allMrs = dedupeMrsByIid(allMrs);
    console.error(`Найдено MR (после дедупликации): ${allMrs.length}`);

    // 3. Сбор discussions и flattening
    const exportedAt = new Date().toISOString();
    const records = [];
    const errors = [];
    const stats = {
        total_mrs_fetched: allMrs.length,
        total_discussions_fetched: 0,
        total_notes_raw: 0,
        total_notes_written: 0,
        filtered: { system: 0, bot: 0, empty: 0 },
    };

    for (let i = 0; i < allMrs.length; i++) {
        const mr = allMrs[i];
        if (verbose) console.error(`  [${i + 1}/${allMrs.length}] MR !${mr.iid}: ${mr.title}`);

        try {
            const discussions = await fetchMrDiscussions(gitlabApiPaginated, projectPath, mr.iid);
            stats.total_discussions_fetched += discussions.length;

            for (const discussion of discussions) {
                if (!discussion.notes || discussion.notes.length === 0) continue;

                for (let noteIndex = 0; noteIndex < discussion.notes.length; noteIndex++) {
                    const note = discussion.notes[noteIndex];
                    stats.total_notes_raw++;

                    if (note.system === true) {
                        stats.filtered.system++;
                        continue;
                    }
                    if (isBot(note.author?.username, botPatterns)) {
                        stats.filtered.bot++;
                        continue;
                    }
                    if (!note.body || note.body.trim() === "") {
                        stats.filtered.empty++;
                        continue;
                    }

                    const record = flattenNote(mr, discussion, note, noteIndex, projectPath, exportedAt);
                    records.push(record);
                    stats.total_notes_written++;
                }
            }
        } catch (err) {
            console.error(`    [ERROR] MR !${mr.iid}: ${err.message}`);
            errors.push({ mr_iid: mr.iid, error: err.message });
        }

        if (i < allMrs.length - 1) {
            await sleep(200);
        }
    }

    // 4. Запись JSONL + meta
    const dt = formatFileDateTime();
    const pendingDir = join(outputDir, "pending");
    const outputPath = join(pendingDir, `mr-notes-${dt}.jsonl`);
    const metaPath = join(pendingDir, `mr-notes-${dt}.meta.json`);

    writeJsonlAtomic(outputPath, records);
    writeMeta(metaPath, {
        schema_version: SCHEMA_VERSION,
        project_path: projectPath,
        period_from: from,
        period_to: to,
        mr_states: states,
        generated_at: exportedAt,
        generated_by: "mr-comments-collector.mjs v1.0",
        stats,
        config: {
            bot_username_patterns: botPatterns,
        },
        errors,
    });

    console.error(`JSONL сохранён: ${outputPath}`);
    console.error(`Meta сохранена: ${metaPath}`);

    return { outputPath, metaPath, stats, overlaps: [], cancelled: false };
}
```

- [ ] **Step 2: Проверить синтаксис**

```bash
node --check .scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.mjs
```

Ожидается: exit 0.

- [ ] **Step 3: Запустить существующие тесты (убедиться, что ничего не сломали)**

```bash
cd .scripts/mcp/mcp-servers/mcp-get-comments
node --test mr-comments-collector.test.mjs
```

Ожидается: все 22 теста PASS.

- [ ] **Step 4: Commit**

```bash
git add .scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.mjs
git commit -m "feat(review-collector): main collectMrComments pipeline

Собирает всё вместе:
- 2 запроса к fetchMrList (merged + closed) + дедупликация
- для каждого MR fetchMrDiscussions + flattenNote
- фильтры: system notes, боты, пустые тела
- запись JSONL + sidecar meta.json с полной статистикой
- idempotency check через findOverlappingExports (блокируется без --force)
- errors[] в meta.json для частичных сбоев"
```

---

## Task 6: Housekeeping — функция `archiveOldProcessedFiles`

**Цель:** Переместить `processed/*.jsonl` старше N дней в `archive/YYYY-MM/` по дате из имени файла. Dry-run режим.

**Files:**
- Modify: `.scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.mjs`
- Modify: `.scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.test.mjs`

- [ ] **Step 1: Добавить функцию архивации**

Дописать в `mr-comments-collector.mjs`:

```js
/**
 * Извлекает datetime из имени файла "mr-notes-2026-04-10T15-00-00.jsonl".
 * @param {string} filename
 * @returns {Date | null}
 */
export function parseDateTimeFromFilename(filename) {
    const match = filename.match(/mr-notes-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const [, date, hh, mm, ss] = match;
    return new Date(`${date}T${hh}:${mm}:${ss}Z`);
}

/**
 * Перемещает processed/*.jsonl (и .meta.json) старше N дней в archive/YYYY-MM/.
 * @param {string} outputRoot
 * @param {number} olderThanDays
 * @param {boolean} [dryRun]
 * @returns {{moved: Array<{from: string, to: string}>, skipped: string[]}}
 */
export function archiveOldProcessedFiles(outputRoot, olderThanDays, dryRun = false) {
    const processedDir = join(outputRoot, "processed");
    const archiveRoot = join(outputRoot, "archive");

    if (!existsSync(processedDir)) {
        return { moved: [], skipped: [] };
    }

    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const moved = [];
    const skipped = [];

    const files = readdirSync(processedDir).filter((f) => f.endsWith(".jsonl"));

    for (const jsonlFile of files) {
        const dt = parseDateTimeFromFilename(jsonlFile);
        if (!dt) {
            skipped.push(jsonlFile);
            continue;
        }

        if (dt.getTime() >= cutoff) {
            skipped.push(jsonlFile);
            continue;
        }

        const yyyyMm = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
        const targetDir = join(archiveRoot, yyyyMm);
        const metaFile = jsonlFile.replace(/\.jsonl$/, ".meta.json");

        const pairs = [
            { from: join(processedDir, jsonlFile), to: join(targetDir, jsonlFile) },
        ];
        if (existsSync(join(processedDir, metaFile))) {
            pairs.push({ from: join(processedDir, metaFile), to: join(targetDir, metaFile) });
        }

        if (!dryRun) {
            mkdirSync(targetDir, { recursive: true });
            for (const p of pairs) {
                renameSync(p.from, p.to);
            }
        }

        moved.push(...pairs);
    }

    return { moved, skipped };
}
```

- [ ] **Step 2: Добавить тест**

В `mr-comments-collector.test.mjs` **дополнить импорты наверху**. Найти блок:

```js
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
```

Заменить на:

```js
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, existsSync as fsExistsSync } from "node:fs";
```

И дополнить блок импортов из `mr-comments-collector.mjs` добавив `parseDateTimeFromFilename` и `archiveOldProcessedFiles`:

```js
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
```

Затем **дописать в конец файла** новые тесты:

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

    // Старый файл (февраль 2026)
    writeFileSync(join(processed, "mr-notes-2026-02-15T10-00-00.jsonl"), "old");
    writeFileSync(join(processed, "mr-notes-2026-02-15T10-00-00.meta.json"), "{}");

    // Свежий файл (сегодня — не должен двигаться)
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
```

- [ ] **Step 3: Запустить тесты**

```bash
cd .scripts/mcp/mcp-servers/mcp-get-comments
node --test mr-comments-collector.test.mjs
```

Ожидается: 26 тестов PASS (22 старых + 4 новых).

- [ ] **Step 4: Commit**

```bash
git add .scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.mjs .scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.test.mjs
git commit -m "feat(review-collector): housekeeping archive function

- parseDateTimeFromFilename: извлечение даты из mr-notes-<dt>.jsonl
- archiveOldProcessedFiles: перемещение старых processed файлов
  в archive/YYYY-MM/ по дате в имени, с dry-run режимом"
```

---

## Task 7: Создать CLI `collect-mr-comments.mjs`

**Цель:** Тонкая обёртка над `collectMrComments` и `archiveOldProcessedFiles` с парсингом аргументов. Подкоманда `archive` для housekeeping.

**Files:**
- Create: `.scripts/mcp/mcp-servers/mcp-get-comments/collect-mr-comments.mjs`

- [ ] **Step 1: Создать CLI**

Создать `.scripts/mcp/mcp-servers/mcp-get-comments/collect-mr-comments.mjs`:

```js
#!/usr/bin/env node

/**
 * CLI для сбора комментариев из GitLab MR в плоский JSONL формат.
 *
 * Использование:
 *   node collect-mr-comments.mjs [options]
 *   node collect-mr-comments.mjs archive [--older-than 30d] [--dry-run]
 */

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import {
    collectMrComments,
    archiveOldProcessedFiles,
    parsePeriod,
    DEFAULT_BOT_PATTERNS,
} from "./mr-comments-collector.mjs";
import { loadConfig } from "./gitlab-client.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function showHelp() {
    console.log(`
GitLab MR Comments Collector

Использование:
  node collect-mr-comments.mjs [options]
  node collect-mr-comments.mjs archive [--older-than 30d] [--dry-run]

Опции сбора:
  --period <value>    Период: 3m, 30d, 1y (по умолчанию: 3m)
  --from <ISO>        Начало периода (альтернатива --period)
  --to <ISO>          Конец периода (по умолчанию: сейчас)
  --project <path>    GitLab project path (по умолчанию: из .env)
  --states <list>     Comma-separated: merged,closed (по умолчанию)
  --output <path>     Путь к JSONL (переопределяет lifecycle дефолт)
  --force             Игнорировать warning о пересекающемся периоде
  --verbose           Подробный лог
  --help              Показать эту справку

Подкоманда archive:
  --older-than <value>  Архивировать processed файлы старше N дней (default: 30d)
  --dry-run             Показать что будет перемещено, ничего не делать

Примеры:
  node collect-mr-comments.mjs
  node collect-mr-comments.mjs --period 6m --verbose
  node collect-mr-comments.mjs --from 2026-01-01 --to 2026-03-31 --force
  node collect-mr-comments.mjs archive --older-than 60d --dry-run
`);
}

function getOutputRoot() {
    // .scripts/mcp/mcp-servers/mcp-get-comments → вверх на 4 уровня до repo root
    const repoRoot = resolve(__dirname, "..", "..", "..", "..");
    return join(repoRoot, ".swap", "requirements", "use_cases", "review", "raw");
}

function parseBotPatternsFromEnv() {
    const raw = process.env.BOT_USERNAME_PATTERNS;
    if (!raw) return DEFAULT_BOT_PATTERNS;
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseOlderThanDays(value) {
    const match = value.match(/^(\d+)d?$/);
    if (!match) throw new Error(`Неверный формат --older-than: "${value}". Ожидается число или Nd.`);
    return parseInt(match[1], 10);
}

async function runCollect(args) {
    // Загружаем .env через loadConfig (это populates process.env)
    const config = loadConfig();

    let from, to;
    if (args.from || args.to) {
        if (!args.from) {
            console.error("Ошибка: --from обязателен при указании --to");
            process.exit(1);
        }
        from = new Date(args.from).toISOString();
        to = args.to ? new Date(args.to).toISOString() : new Date().toISOString();
    } else {
        const period = args.period || "3m";
        ({ from, to } = parsePeriod(period));
    }

    const statesStr = args.states || "merged,closed";
    const states = statesStr.split(",").map((s) => s.trim()).filter(Boolean);

    const projectPath = args.project || config.DEFAULT_PROJECT_ID;
    if (!projectPath) {
        console.error("Ошибка: project path не задан (используйте --project или DEFAULT_PROJECT_ID в .env)");
        process.exit(1);
    }

    const outputDir = args.output ? dirname(args.output) : getOutputRoot();
    const botPatterns = parseBotPatternsFromEnv();

    if (args.verbose) {
        console.error(`Проект: ${projectPath}`);
        console.error(`Период: ${from} — ${to}`);
        console.error(`States: ${states.join(", ")}`);
        console.error(`Output: ${outputDir}`);
        console.error(`Bot patterns: ${botPatterns.join(", ")}`);
    }

    const result = await collectMrComments({
        projectPath,
        from,
        to,
        states,
        outputDir,
        botPatterns,
        force: args.force,
        verbose: args.verbose,
    });

    if (result.cancelled) {
        process.exit(2);
    }

    console.log(`\nГотово!`);
    console.log(`  MR:              ${result.stats.total_mrs_fetched}`);
    console.log(`  Discussions:     ${result.stats.total_discussions_fetched}`);
    console.log(`  Notes raw:       ${result.stats.total_notes_raw}`);
    console.log(`  Notes written:   ${result.stats.total_notes_written}`);
    console.log(`  Filtered system: ${result.stats.filtered.system}`);
    console.log(`  Filtered bot:    ${result.stats.filtered.bot}`);
    console.log(`  Filtered empty:  ${result.stats.filtered.empty}`);
    console.log(`  JSONL:           ${result.outputPath}`);
    console.log(`  Meta:            ${result.metaPath}`);
}

function runArchive(args) {
    const olderThan = args["older-than"] ? parseOlderThanDays(args["older-than"]) : 30;
    const dryRun = args["dry-run"] === true;

    const outputRoot = getOutputRoot();
    console.error(`Архивация processed файлов старше ${olderThan} дней в ${outputRoot}/archive/YYYY-MM/`);
    if (dryRun) console.error(`(DRY RUN — ничего не меняется)`);

    const result = archiveOldProcessedFiles(outputRoot, olderThan, dryRun);

    console.log(`Перемещено файлов: ${result.moved.length}`);
    for (const m of result.moved) {
        console.log(`  ${m.from} → ${m.to}`);
    }
    console.log(`Пропущено: ${result.skipped.length}`);
}

async function main() {
    const rawArgs = process.argv.slice(2);

    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
        showHelp();
        process.exit(0);
    }

    // Определяем подкоманду
    const subcommand = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs[0] : null;

    if (subcommand === "archive") {
        const { values } = parseArgs({
            args: rawArgs.slice(1),
            options: {
                "older-than": { type: "string" },
                "dry-run": { type: "boolean", default: false },
            },
            allowPositionals: false,
        });
        runArchive(values);
        return;
    }

    // Основной сбор
    const { values } = parseArgs({
        args: rawArgs,
        options: {
            period: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            project: { type: "string" },
            states: { type: "string" },
            output: { type: "string" },
            force: { type: "boolean", default: false },
            verbose: { type: "boolean", default: false },
        },
        allowPositionals: false,
    });

    try {
        await runCollect(values);
    } catch (err) {
        console.error(`\nОшибка: ${err.message}`);
        if (values.verbose) console.error(err.stack);
        process.exit(1);
    }
}

main();
```

- [ ] **Step 2: Проверить синтаксис**

```bash
node --check .scripts/mcp/mcp-servers/mcp-get-comments/collect-mr-comments.mjs
```

Ожидается: exit 0.

- [ ] **Step 3: Проверить --help**

```bash
node .scripts/mcp/mcp-servers/mcp-get-comments/collect-mr-comments.mjs --help
```

Ожидается: справка выводится, exit 0.

- [ ] **Step 4: Smoke test на 1 день**

```bash
node .scripts/mcp/mcp-servers/mcp-get-comments/collect-mr-comments.mjs --period 1d --verbose
```

Ожидается:
- Вывод «Проект:», «Период:», «States:»
- Список найденных MR
- Сообщение «JSONL сохранён: .../pending/mr-notes-<dt>.jsonl»
- Сообщение «Meta сохранена: .../pending/mr-notes-<dt>.meta.json»
- Итоговые цифры
- exit 0
- Файл существует и валиден:
  ```bash
  head -1 .swap/requirements/use_cases/review/raw/pending/mr-notes-*.jsonl | python3 -m json.tool
  ```
  должно выводить валидный JSON с полями `schema_version`, `mr_iid`, `note_body` и т.д.

- [ ] **Step 5: Проверить идемпотентность (второй запуск должен предупредить)**

```bash
node .scripts/mcp/mcp-servers/mcp-get-comments/collect-mr-comments.mjs --period 1d
```

Ожидается: `[WARN] Найдены ... пересекающихся экспорта`, exit 2.

Затем с `--force`:
```bash
node .scripts/mcp/mcp-servers/mcp-get-comments/collect-mr-comments.mjs --period 1d --force
```
Ожидается: работает, создаёт новый файл.

- [ ] **Step 6: Commit**

```bash
git add .scripts/mcp/mcp-servers/mcp-get-comments/collect-mr-comments.mjs
git commit -m "feat(review-collector): CLI wrapper collect-mr-comments.mjs

Тонкая обёртка над collectMrComments + archiveOldProcessedFiles.
Поддерживает --period, --from/--to, --project, --states, --output,
--force, --verbose. Подкоманда archive с --older-than и --dry-run.

Smoke-тестирован: --period 1d, идемпотентность, --force."
```

---

## Task 8: Обновить `index.js` — заменить `collect_review_patterns` на `collect_mr_comments`

**Цель:** Удалить импорт `llm-client.mjs`, старый tool definition, старый case в switch. Добавить новый импорт из `mr-comments-collector.mjs`, новый tool definition, новый case.

**Files:**
- Modify: `.scripts/mcp/mcp-servers/mcp-get-comments/index.js`

- [ ] **Step 1: Удалить импорт llm-client**

Open `.scripts/mcp/mcp-servers/mcp-get-comments/index.js`, найти строку 30:

```js
import { loadLlmConfig, clusterComments, generateMarkdownReport } from "./llm-client.mjs";
```

Заменить на:

```js
import { collectMrComments, parsePeriod } from "./mr-comments-collector.mjs";
```

- [ ] **Step 2: Удалить старый tool definition**

Найти блок (примерно строки 210-256) начинающийся с `name: "collect_review_patterns"` и заканчивающийся соответствующей `}` + `,`. Удалить весь блок.

На его место вставить:

```js
    {
        name: "collect_mr_comments",
        description:
            "Собрать комментарии из MR за период в плоский JSONL файл для последующего анализа паттернов ревью. " +
            "Возвращает путь к файлу и статистику. Фильтрует system notes, ботов и пустые комментарии.",
        inputSchema: {
            type: "object",
            properties: {
                period: {
                    type: "string",
                    description: "Период: 3m, 30d, 1y. Альтернатива from/to.",
                },
                from: {
                    type: "string",
                    description: "Начало периода (ISO 8601)",
                },
                to: {
                    type: "string",
                    description: "Конец периода (ISO 8601)",
                },
                project_id: {
                    oneOf: [{ type: "number" }, { type: "string" }],
                    description: "GitLab project path (по умолчанию: из .env)",
                },
                states: {
                    type: "array",
                    items: { type: "string", enum: ["merged", "closed"] },
                    description: "MR states (по умолчанию: merged,closed)",
                },
                output_path: {
                    type: "string",
                    description: "Путь к выходному JSONL файлу (переопределяет lifecycle дефолт)",
                },
                force: {
                    type: "boolean",
                    description: "Игнорировать warning о пересекающемся периоде",
                    default: false,
                },
            },
        },
    },
```

- [ ] **Step 3: Удалить старый case в switch**

Найти в функции `CallToolRequestSchema` handler блок `case "collect_review_patterns": { ... }` (примерно строки 449-585). Удалить весь case.

Вставить на его место:

```js
            case "collect_mr_comments": {
                const { period, from, to, project_id, states, output_path, force } = args;
                const projectPath = project_id ?? DEFAULT_PROJECT_ID;

                let resolvedFrom, resolvedTo;
                if (from || to) {
                    if (!from) throw new Error("from обязателен при указании to");
                    resolvedFrom = new Date(from).toISOString();
                    resolvedTo = to ? new Date(to).toISOString() : new Date().toISOString();
                } else {
                    const parsed = parsePeriod(period || "3m");
                    resolvedFrom = parsed.from;
                    resolvedTo = parsed.to;
                }

                const resolvedStates = states && states.length > 0 ? states : ["merged", "closed"];

                const repoRoot = resolve(__dirname, "..", "..", "..", "..");
                const defaultOutputDir = join(repoRoot, ".swap", "requirements", "use_cases", "review", "raw");
                const outputDir = output_path ? dirname(output_path) : defaultOutputDir;

                const result = await collectMrComments({
                    projectPath,
                    from: resolvedFrom,
                    to: resolvedTo,
                    states: resolvedStates,
                    outputDir,
                    force: force === true,
                });

                if (result.cancelled) {
                    return {
                        content: [{
                            type: "text",
                            text: `Сбор отменён: найдены пересекающиеся экспорты. Используйте force=true чтобы продолжить.\n${JSON.stringify(result.overlaps, null, 2)}`,
                        }],
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            output_path: result.outputPath,
                            meta_path: result.metaPath,
                            stats: result.stats,
                        }, null, 2),
                    }],
                };
            }
```

- [ ] **Step 4: Проверить синтаксис**

```bash
node --check .scripts/mcp/mcp-servers/mcp-get-comments/index.js
```

Ожидается: exit 0.

- [ ] **Step 5: Smoke test MCP-сервера (запуск + list tools)**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node .scripts/mcp/mcp-servers/mcp-get-comments/index.js 2>&1 | head -100
```

Ожидается: JSON ответ с массивом tools, в котором:
- **Есть** `get_mr_comments`, `add_mr_comment`, `add_mr_diff_comment`, `reply_to_discussion`, `resolve_mr_discussion`, `get_mr_info`, `collect_mr_comments`
- **Нет** `collect_review_patterns`

- [ ] **Step 6: Commit**

```bash
git add .scripts/mcp/mcp-servers/mcp-get-comments/index.js
git commit -m "refactor(review-collector): switch MCP tool to collect_mr_comments

- Убрать импорт llm-client.mjs (переезжает в legacy следующим шагом)
- Убрать tool definition и handler для collect_review_patterns
- Добавить tool collect_mr_comments c новыми параметрами:
  period/from/to, project_id, states, output_path, force
- Возвращает структурированный JSON с путями и stats
- Остальные tools (get_mr_comments, reply_to_discussion и пр.) не тронуты

Совместимость со скиллами /get-comment и /reply-comment сохранена."
```

---

## Task 9: Переместить `llm-client.mjs` в `legacy/`

**Цель:** После того как `index.js` перестал импортировать из `llm-client.mjs`, можно безопасно перемещать.

**Files:**
- Move: `.scripts/mcp/mcp-servers/mcp-get-comments/llm-client.mjs` → `legacy/`

- [ ] **Step 1: Проверить, что никто в корне не импортирует llm-client.mjs**

```bash
grep -rn "llm-client.mjs" .scripts/mcp/mcp-servers/mcp-get-comments/ --include="*.mjs" --include="*.js" --exclude-dir=legacy --exclude-dir=node_modules
```

Ожидается: **никаких совпадений** в корне (все ссылки должны быть либо в `legacy/`, либо отсутствовать).

- [ ] **Step 2: Переместить файл**

```bash
cd .scripts/mcp/mcp-servers/mcp-get-comments
git mv llm-client.mjs legacy/
```

- [ ] **Step 3: Проверить, что импорты в legacy/ всё ещё работают**

`legacy/gitlab-review-collector.mjs` и `legacy/test-llm.mjs` импортировали `../llm-client.mjs` — теперь этот путь невалиден. Исправить на `./llm-client.mjs`.

Open `.scripts/mcp/mcp-servers/mcp-get-comments/legacy/gitlab-review-collector.mjs`, найти:
```js
import { loadLlmConfig, clusterComments as llmClusterComments, generateMarkdownReport } from "../llm-client.mjs";
```
Заменить на:
```js
import { loadLlmConfig, clusterComments as llmClusterComments, generateMarkdownReport } from "./llm-client.mjs";
```

Open `.scripts/mcp/mcp-servers/mcp-get-comments/legacy/test-llm.mjs`, найти:
```js
import { loadLlmConfig } from "../llm-client.mjs";
```
Заменить на:
```js
import { loadLlmConfig } from "./llm-client.mjs";
```

- [ ] **Step 4: Проверить синтаксис всех legacy файлов + корня**

```bash
node --check .scripts/mcp/mcp-servers/mcp-get-comments/index.js
node --check .scripts/mcp/mcp-servers/mcp-get-comments/gitlab-client.mjs
node --check .scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.mjs
node --check .scripts/mcp/mcp-servers/mcp-get-comments/collect-mr-comments.mjs
node --check .scripts/mcp/mcp-servers/mcp-get-comments/legacy/llm-client.mjs
node --check .scripts/mcp/mcp-servers/mcp-get-comments/legacy/gitlab-review-collector.mjs
node --check .scripts/mcp/mcp-servers/mcp-get-comments/legacy/collect-review-patterns.mjs
node --check .scripts/mcp/mcp-servers/mcp-get-comments/legacy/test-llm.mjs
```

Ожидается: все 8 команд exit 0.

- [ ] **Step 5: Прогнать unit-тесты**

```bash
cd .scripts/mcp/mcp-servers/mcp-get-comments
node --test mr-comments-collector.test.mjs
```

Ожидается: все 26 тестов PASS.

- [ ] **Step 6: Commit**

```bash
git add .scripts/mcp/mcp-servers/mcp-get-comments/
git commit -m "refactor(review-collector): move llm-client.mjs to legacy/

После того как index.js переключился на mr-comments-collector.mjs,
llm-client.mjs больше не импортируется из корня директории.
Перемещаем в legacy/, исправляя относительные импорты внутри legacy/
с ../llm-client.mjs на ./llm-client.mjs."
```

---

## Task 10: Чистка `.env` + добавление `BOT_USERNAME_PATTERNS`

**Цель:** Убрать LLM-секции из `.env`, добавить опциональную `BOT_USERNAME_PATTERNS` с дефолтом.

**Files:**
- Modify: `.scripts/mcp/mcp-servers/mcp-get-comments/.env`

- [ ] **Step 1: Отредактировать .env**

Open `.scripts/mcp/mcp-servers/mcp-get-comments/.env`.

Текущее содержимое (пример):
```
# GitLab API Configuration
GITLAB_TOKEN=glpat-xxx
GITLAB_URL=https://kwannon.ukterra.ru/api/v4

# Проект по умолчанию (можно не указывать в запросах)
DEFAULT_PROJECT_ID=wone-it/terra-housing-mgmt

# LLM Configuration (OpenAI-compatible API for pattern analysis)
LLM_API_URL=https://api.z.ai/api/coding/paas/v4
#LLM_API_URL=https://api.z.ai/api/anthropic
LLM_API_KEY=xxx
LLM_MODEL=glm-4.7
```

Заменить на:
```
# GitLab API Configuration
GITLAB_TOKEN=glpat-xxx
GITLAB_URL=https://kwannon.ukterra.ru/api/v4

# Проект по умолчанию (можно не указывать в запросах)
DEFAULT_PROJECT_ID=wone-it/terra-housing-mgmt

# Фильтрация ботов (опционально)
# Comma-separated glob-паттерны username'ов, которые считать ботами
# Дефолт в коде: *-bot,*_bot,ghost
# BOT_USERNAME_PATTERNS=*-bot,*_bot,ghost,project_*_bot,gitlab-bot
```

**Важно:** сохранить реальные значения `GITLAB_TOKEN` и `GITLAB_URL` из существующего файла — только удалить LLM-строки и добавить комментарий про `BOT_USERNAME_PATTERNS`.

- [ ] **Step 2: Smoke test с новым .env**

```bash
node .scripts/mcp/mcp-servers/mcp-get-comments/collect-mr-comments.mjs --period 1d --verbose --force
```

Ожидается: работает как раньше (дефолтный список ботов подхватывается из кода).

- [ ] **Step 3: Commit (с осторожностью про секреты)**

**Проверка:** убедиться что `.env` уже в `.gitignore` и не коммитится.

```bash
git check-ignore -v .scripts/mcp/mcp-servers/mcp-get-comments/.env
```

Если ignored — `.env` локальный, коммитить не нужно. Если НЕ ignored — предупредить пользователя и не коммитить.

Если `.env` не отслеживается git'ом, коммит для этого шага не нужен — просто проверка локальных правок.

---

## Task 11: Обновить документацию (Archi.md, USAGE.md, README.md)

**Цель:** Привести документацию в соответствие с новой архитектурой. Старый LLM-пайплайн упомянуть как "legacy, см. `legacy/`".

**Files:**
- Modify: `.scripts/mcp/mcp-servers/mcp-get-comments/README.md`
- Modify: `.scripts/mcp/mcp-servers/mcp-get-comments/USAGE.md`
- Modify: `.scripts/mcp/mcp-servers/mcp-get-comments/Archi.md`

- [ ] **Step 1: Переписать README.md**

Перезаписать содержимое `.scripts/mcp/mcp-servers/mcp-get-comments/README.md`:

```markdown
# GitLab MR Comments MCP Server

MCP-сервер для работы с комментариями GitLab Merge Request'ов: чтение, добавление, ответы, resolve, а также сбор за период в плоский JSONL для последующего анализа паттернов.

## MCP Tools

Индивидуальная работа с MR (используется скиллами `/get-comment`, `/reply-comment`):

- `get_mr_comments` — получить все комментарии из MR
- `add_mr_comment` — добавить общий комментарий
- `add_mr_diff_comment` — добавить inline комментарий на строку
- `reply_to_discussion` — ответить на discussion
- `resolve_mr_discussion` — отметить discussion как resolved
- `get_mr_info` — получить метаданные MR

Массовый сбор:
- `collect_mr_comments` — собрать комментарии из MR за период в JSONL

## CLI

```bash
node collect-mr-comments.mjs --period 3m --verbose
node collect-mr-comments.mjs archive --older-than 30d --dry-run
```

Подробности — см. `USAGE.md`.

## Архитектура

См. `Archi.md`.

## Legacy

Старый LLM-пайплайн (кластеризация комментариев через OpenAI-совместимый API) лежит в `legacy/`. Он больше не используется и будет удалён после стабилизации нового extraction tool.
```

- [ ] **Step 2: Переписать USAGE.md**

Перезаписать `.scripts/mcp/mcp-servers/mcp-get-comments/USAGE.md`:

```markdown
# Usage: GitLab MR Comments Collector

## Установка

```bash
cd .scripts/mcp/mcp-servers/mcp-get-comments
npm install
```

Настроить `.env`:
```
GITLAB_TOKEN=glpat-xxx
GITLAB_URL=https://kwannon.ukterra.ru/api/v4
DEFAULT_PROJECT_ID=wone-it/terra-housing-mgmt
# BOT_USERNAME_PATTERNS=*-bot,*_bot,ghost (опционально)
```

## CLI: сбор комментариев за период

```bash
# Последние 3 месяца (дефолт), merged + closed MR
node collect-mr-comments.mjs

# За конкретный период
node collect-mr-comments.mjs --from 2026-01-01 --to 2026-03-31

# Только merged, с verbose логом
node collect-mr-comments.mjs --period 6m --states merged --verbose

# Форсированный повторный запуск (игнорирует warning о пересечении периодов)
node collect-mr-comments.mjs --period 1d --force
```

### Опции

| Опция | Описание | По умолчанию |
|---|---|---|
| `--period <value>` | `3m`, `30d`, `1y` | `3m` |
| `--from <ISO>` | Начало периода | — |
| `--to <ISO>` | Конец периода | сейчас |
| `--project <path>` | GitLab project path | из `.env` |
| `--states <list>` | merged, closed через запятую | `merged,closed` |
| `--output <path>` | Путь к JSONL | `<repo>/.swap/.../raw/pending/mr-notes-<dt>.jsonl` |
| `--force` | Игнорировать overlap warning | `false` |
| `--verbose` | Подробный лог | `false` |

## CLI: архивация старых processed файлов

```bash
# Dry-run — посмотреть что будет перемещено
node collect-mr-comments.mjs archive --older-than 30d --dry-run

# Реальное перемещение в archive/YYYY-MM/
node collect-mr-comments.mjs archive --older-than 30d
```

## Выход

Каталог: `.swap/requirements/use_cases/review/raw/`

```
pending/
├── mr-notes-2026-04-10T15-00-00.jsonl     ← данные (одна note на строку)
└── mr-notes-2026-04-10T15-00-00.meta.json ← метаданные экспорта и stats
processed/   ← скилл перемещает сюда после анализа
archive/     ← housekeeping перемещает сюда старые файлы по YYYY-MM
```

### Схема записи (mr-notes-*.jsonl)

Каждая строка — плоская JSON запись одной note с полями MR, discussion, note и position. Схема: см. `.docs/superpowers/specs/2026-04-10-gitlab-mr-comments-extractor-design.md`.

### Пример записи

```json
{
  "schema_version": "1.0",
  "project_path": "wone-it/terra-housing-mgmt",
  "mr_iid": 1828,
  "mr_title": "feat: правки",
  "mr_state": "merged",
  "mr_author_username": "ivanov",
  "discussion_id": "abc123",
  "discussion_kind": "diff",
  "discussion_resolved": true,
  "note_id": 12345,
  "note_body": "Нужно добавить обработку ошибок",
  "note_author_username": "petrov",
  "is_root_note": true,
  "parent_note_id": null,
  "file_path": "frontend/src/app/request-form.component.ts",
  "new_line": 144,
  "line_range_start": 144,
  "line_range_end": 146,
  "has_suggestions": false,
  "note_by_mr_author": false,
  "exported_at": "2026-04-10T15:00:00.000Z"
}
```

## MCP tool: collect_mr_comments

Из агента Claude можно вызвать:

```
mcp__get-comments__collect_mr_comments {
  "period": "3m",
  "states": ["merged", "closed"]
}
```

Возвращает:
```json
{
  "output_path": "...",
  "meta_path": "...",
  "stats": {
    "total_mrs_fetched": 87,
    "total_notes_written": 1286,
    "filtered": { "system": 156, "bot": 89, "empty": 12 }
  }
}
```

## Legacy

Старый тул `collect-review-patterns.mjs` с LLM-кластеризацией перенесён в `legacy/` и больше не используется. См. `Archi.md` раздел "Legacy".
```

- [ ] **Step 3: Переписать Archi.md**

Перезаписать `.scripts/mcp/mcp-servers/mcp-get-comments/Archi.md`:

```markdown
# Архитектура GitLab MR Comments MCP Server

## Обзор

MCP-сервер и CLI для работы с комментариями GitLab MR. Поддерживает:

1. **Индивидуальные операции с комментариями** — чтение, добавление, ответы, resolve для одного MR (используется скиллами `/get-comment`, `/reply-comment`)
2. **Массовый сбор за период** — выгрузка всех комментариев из MR за диапазон дат в плоский JSONL формат для последующего анализа паттернов ревью

## Компоненты

```
.scripts/mcp/mcp-servers/mcp-get-comments/
├── index.js                      ← MCP-сервер с tools
├── gitlab-client.mjs             ← абстракция над GitLab API (используется всеми)
├── mr-comments-collector.mjs     ← core модуль массового сбора (fetch → filter → flatten → write)
├── collect-mr-comments.mjs       ← CLI wrapper для mr-comments-collector
├── mr-comments-collector.test.mjs ← unit-тесты (node --test)
└── legacy/
    ├── gitlab-review-collector.mjs   ← старый пайплайн с LLM
    ├── llm-client.mjs                ← OpenAI-совместимый клиент
    ├── collect-review-patterns.mjs   ← старый CLI
    └── test-llm.mjs                  ← старый тест LLM endpoint
```

## MCP Tools

| Tool | Описание | Кем используется |
|---|---|---|
| `get_mr_comments` | Получить все комментарии из MR | `/get-comment` |
| `add_mr_comment` | Добавить общий комментарий | — |
| `add_mr_diff_comment` | Добавить inline комментарий | — |
| `reply_to_discussion` | Ответить на discussion | `/reply-comment` |
| `resolve_mr_discussion` | Отметить discussion как resolved | `/reply-comment` |
| `get_mr_info` | Метаданные MR | — |
| `collect_mr_comments` | Массовый сбор за период | CLI + будущий pattern mining skill |

## Pipeline: сбор комментариев за период

```
CLI/MCP ──→ collectMrComments({projectPath, from, to, states, outputDir, ...})
                │
                ▼
     findOverlappingExports  (проверка идемпотентности)
                │
                ▼
  fetchMrList(state=merged) + fetchMrList(state=closed)
                │
                ▼
        dedupeMrsByIid  (iid может повториться)
                │
                ▼
    FOR each mr:
      fetchMrDiscussions(mr.iid)
        FOR each discussion:
          FOR each note (с индексом):
            Filter:
              - system note         → skip (stats.filtered.system++)
              - bot username         → skip (stats.filtered.bot++)
              - empty body           → skip (stats.filtered.empty++)
            flattenNote(mr, discussion, note, index) → flat record
            buffer.push(record)
      sleep 200ms (rate limit)
                │
                ▼
    writeJsonlAtomic(pending/mr-notes-<dt>.jsonl, buffer)
    writeMeta(pending/mr-notes-<dt>.meta.json, stats + config + errors)
                │
                ▼
           { outputPath, metaPath, stats }
```

## Lifecycle выходных файлов

```
.swap/requirements/use_cases/review/raw/
├── pending/    ← только что собрано, ждёт анализа
├── processed/  ← скилл проанализировал (скилл перемещает руками)
└── archive/    ← housekeeping перенёс по YYYY-MM
    ├── 2026-01/
    └── 2026-02/
```

Housekeeping вызывается вручную через `node collect-mr-comments.mjs archive --older-than 30d`.

## Схема плоской записи (JSONL)

Полная схема и правила вычисления производных полей: см. `.docs/superpowers/specs/2026-04-10-gitlab-mr-comments-extractor-design.md`.

Ключевые поля:
- **Идентификация:** `schema_version`, `project_path`, `mr_iid`, `discussion_id`, `note_id`
- **MR-уровень:** `mr_title`, `mr_state`, `mr_author_username`, `mr_created_at`, `mr_labels`, `mr_web_url`
- **Discussion:** `discussion_kind` (diff/overview), `discussion_resolved`, `discussion_notes_count`
- **Note:** `note_body`, `note_author_username`, `note_created_at`, `note_type`
- **Thread:** `is_root_note`, `reply_index_in_discussion`, `thread_root_note_id`, `parent_note_id`
- **Position (для diff):** `file_path`, `new_line`, `old_line`, `line_range_start`, `line_range_end`
- **Сигналы:** `has_suggestions`, `note_by_mr_author`

Sidecar `.meta.json` содержит статистику фильтрации, конфиг (botPatterns) и список ошибок по MR.

## Фильтрация

Жёсткие фильтры (всегда):
1. `note.system === true` — system notes (merge events, labels, assignees)
2. `note.body.trim() === ""` — пустые

Настраиваемые через `.env`:
- `BOT_USERNAME_PATTERNS` — comma-separated glob-паттерны (дефолт: `*-bot,*_bot,ghost`)

Помечаются (не фильтруются):
- `note_by_mr_author: true` — автор комментария = автор MR (ответы автора, self-review)

## Error handling

- 4xx GitLab → fatal, exit 1
- 5xx / network → retry с exponential backoff, после 3 попыток skip MR + запись в `errors[]`
- 429 → respect `Retry-After`
- Атомарная запись через `.tmp` + rename → либо полный файл, либо ничего

## Тестирование

Unit-тесты для pure-функций: `node --test mr-comments-collector.test.mjs` (26+ тестов без внешних зависимостей).

Ручные smoke-тесты: `--period 1d --verbose`, idempotency check, `--force`.

## Legacy

Старый LLM-пайплайн (`collect-review-patterns.mjs` + `llm-client.mjs` + `gitlab-review-collector.mjs` + `test-llm.mjs`) перемещён в `legacy/`. Причины отказа:
- Промпт рассчитан на поиск повторений; с малым объёмом данных LLM честно возвращает 0 паттернов
- Внешний LLM ненадёжен (смешение OpenAI/Anthropic форматов, зависания, auth-ошибки)
- Смешаны сбор данных и их анализ — сложно отлаживать

Новая архитектура разделяет сбор (этот тул) и анализ паттернов (отдельный скилл в будущем) — см. spec.
```

- [ ] **Step 4: Проверить, что все .md файлы читаемы**

```bash
wc -l .scripts/mcp/mcp-servers/mcp-get-comments/README.md
wc -l .scripts/mcp/mcp-servers/mcp-get-comments/USAGE.md
wc -l .scripts/mcp/mcp-servers/mcp-get-comments/Archi.md
```

Ожидается: все три файла непустые.

- [ ] **Step 5: Commit**

```bash
git add .scripts/mcp/mcp-servers/mcp-get-comments/README.md .scripts/mcp/mcp-servers/mcp-get-comments/USAGE.md .scripts/mcp/mcp-servers/mcp-get-comments/Archi.md
git commit -m "docs(review-collector): rewrite README/USAGE/Archi for new extraction tool

Актуализирована документация под новую архитектуру:
- README.md: краткий обзор MCP tools + CLI
- USAGE.md: CLI команды (сбор + archive), опции, примеры вывода
- Archi.md: схема компонентов, pipeline, lifecycle, фильтрация, legacy

Ссылки на спек в .docs/superpowers/specs/"
```

---

## Task 12: Финальная проверка совместимости со скиллами

**Цель:** Убедиться, что скиллы `/get-comment` и `/reply-comment` продолжают работать после всех изменений.

**Files:** Только проверки, правок кода нет.

- [ ] **Step 1: Полный прогон unit-тестов**

```bash
cd .scripts/mcp/mcp-servers/mcp-get-comments
node --test mr-comments-collector.test.mjs
```

Ожидается: все тесты PASS.

- [ ] **Step 2: Проверить синтаксис всех файлов**

```bash
for f in \
  .scripts/mcp/mcp-servers/mcp-get-comments/index.js \
  .scripts/mcp/mcp-servers/mcp-get-comments/gitlab-client.mjs \
  .scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.mjs \
  .scripts/mcp/mcp-servers/mcp-get-comments/mr-comments-collector.test.mjs \
  .scripts/mcp/mcp-servers/mcp-get-comments/collect-mr-comments.mjs \
  .scripts/mcp/mcp-servers/mcp-get-comments/legacy/gitlab-review-collector.mjs \
  .scripts/mcp/mcp-servers/mcp-get-comments/legacy/collect-review-patterns.mjs \
  .scripts/mcp/mcp-servers/mcp-get-comments/legacy/llm-client.mjs \
  .scripts/mcp/mcp-servers/mcp-get-comments/legacy/test-llm.mjs; do
    node --check "$f" && echo "OK $f"
done
```

Ожидается: все файлы OK.

- [ ] **Step 3: Проверить MCP tools list**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node .scripts/mcp/mcp-servers/mcp-get-comments/index.js 2>&1
```

Ожидается JSON с 7 tools:
- ✅ `get_mr_comments`
- ✅ `add_mr_comment`
- ✅ `add_mr_diff_comment`
- ✅ `reply_to_discussion`
- ✅ `resolve_mr_discussion`
- ✅ `get_mr_info`
- ✅ `collect_mr_comments`
- ❌ `collect_review_patterns` (должен отсутствовать)

- [ ] **Step 4: Smoke test нового сбора**

```bash
node .scripts/mcp/mcp-servers/mcp-get-comments/collect-mr-comments.mjs --period 1d --force --verbose
```

Ожидается: работает, создаёт файл в `pending/`, выводит stats.

- [ ] **Step 5: Проверить что в JSONL валидные записи**

```bash
LATEST=$(ls -t .swap/requirements/use_cases/review/raw/pending/mr-notes-*.jsonl | head -1)
head -1 "$LATEST" | node -e 'process.stdin.on("data", d => { const r = JSON.parse(d); console.log("schema_version:", r.schema_version); console.log("mr_iid:", r.mr_iid); console.log("note_body length:", r.note_body?.length); console.log("discussion_kind:", r.discussion_kind); })'
```

Ожидается: вывод значений, без ошибок JSON.parse.

- [ ] **Step 6: Сверить количество строк с meta.json**

```bash
LATEST=$(ls -t .swap/requirements/use_cases/review/raw/pending/mr-notes-*.jsonl | head -1)
META="${LATEST%.jsonl}.meta.json"
LINES=$(wc -l < "$LATEST")
WRITTEN=$(node -e 'const m=require("fs").readFileSync(process.argv[1],"utf-8"); console.log(JSON.parse(m).stats.total_notes_written)' "$META")
echo "JSONL lines: $LINES"
echo "meta.total_notes_written: $WRITTEN"
```

Ожидается: `$LINES == $WRITTEN`.

- [ ] **Step 7: Документировать результаты в git log**

Если все проверки прошли, создать пустой финализирующий commit с итоговым сообщением:

```bash
git commit --allow-empty -m "chore(review-collector): extraction tool migration complete

Все проверки прошли:
- 26 unit-тестов PASS
- MCP tools list: 7 tools, collect_mr_comments заменил collect_review_patterns
- Smoke test --period 1d: JSONL валиден, meta.total_notes_written соответствует строкам
- Совместимость со скиллами /get-comment и /reply-comment сохранена
  (get_mr_comments, reply_to_discussion, resolve_mr_discussion работают)

Следующие шаги (отдельные подпроекты):
1. Pattern mining skill — нормализация, thread reconstruction, synthesis правил
2. Specialized reviewer agent — проверка diff против top-N patterns

Spec: .docs/superpowers/specs/2026-04-10-gitlab-mr-comments-extractor-design.md"
```

---

## Critical Path Summary

```
Task 1 (move 3 files → legacy/)
   ↓
Task 2 (pure functions skeleton)
   ↓
Task 3 (unit tests for pure)
   ↓
Task 4 (IO helpers + tests)
   ↓
Task 5 (main collectMrComments)
   ↓
Task 6 (archive function + tests)
   ↓
Task 7 (CLI + smoke test)
   ↓
Task 8 (index.js: swap tools)  ⚠️ ПОСЛЕ этого llm-client может переезжать
   ↓
Task 9 (move llm-client.mjs → legacy/)
   ↓
Task 10 (.env cleanup)
   ↓
Task 11 (docs: README/USAGE/Archi)
   ↓
Task 12 (final verification)
```

**Важно:** Task 9 (перемещение `llm-client.mjs`) строго после Task 8 (удаление импорта из `index.js`). Если поменять местами — сломается MCP-сервер и вместе с ним скиллы.

## Self-review заметки

**Spec coverage check:**
- ✅ Новый модуль + CLI — Task 2-7
- ✅ JSONL schema с вычисляемыми полями — Task 2, 5
- ✅ Sidecar `.meta.json` — Task 4, 5
- ✅ Lifecycle pending/processed/archive — Task 5, 6, 11 (docs)
- ✅ Идемпотентность через `findOverlappingExports` — Task 4, 5, 7
- ✅ Фильтры system/bot/empty + `note_by_mr_author` — Task 2, 5
- ✅ MCP tool rename в index.js — Task 8
- ✅ Legacy move — Task 1, 9
- ✅ Совместимость со скиллами — Task 8 (сохранение других tools), Task 12 (верификация)
- ✅ `.env` чистка — Task 10
- ✅ Документация — Task 11
- ✅ Unit-тесты — Task 3, 4, 6
- ✅ Smoke-тесты — Task 7, 12

Пробелов нет.

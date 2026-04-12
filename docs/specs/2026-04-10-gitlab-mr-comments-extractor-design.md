# GitLab MR Comments Extractor — Design Spec

**Дата:** 2026-04-10
**Автор:** Sergey Lychagin
**Статус:** Draft — ожидает review
**Ветка:** review-collector-final

## Контекст и мотивация

### Текущая проблема

В `.scripts/mcp/mcp-servers/mcp-get-comments/` существует тул `collect-review-patterns.mjs`, который:
1. Собирает комментарии из GitLab MR за период
2. Отправляет их во внешний LLM (Z.AI GLM-4.7) для кластеризации в паттерны
3. Генерирует markdown-отчёт

Проблемы текущей реализации:
- LLM часто не находит паттернов (промпт рассчитан на «поиск повторений», а не на «синтез правил»)
- Внешний LLM ненадёжен (зависания, смешение OpenAI/Anthropic форматов, ошибки аутентификации)
- Смешаны две ответственности: сбор данных и их анализ
- Markdown-формат не подходит для программной обработки будущим reviewer-агентом

### Целевая архитектура (высокоуровнево)

Задача разбивается на 3 независимых подсистемы:

1. **Extraction tool** — собирает MR за период, нормализует в плоский JSONL *(этот документ)*
2. **Pattern mining skill** — читает JSONL, чистит, реконструирует треды, синтезирует review patterns *(отдельный spec в будущем)*
3. **Specialized reviewer agent** — получает diff + top-N релевантных паттернов, проверяет только их *(отдельный spec в будущем)*

Этот спек покрывает **только Extraction tool**.

## Цели и не-цели

### Цели

- Собрать все комментарии из MR за произвольный период
- Захватить полный контекст: MR-метаданные, общие и inline комментарии, ответы, thread-структуру, resolution-статус, позиции в файлах
- Отдать структурированный JSONL пригодный для программного анализа
- Отфильтровать очевидный шум (system notes, боты, пустые тела) на этапе сбора
- Управлять жизненным циклом файлов (pending → processed → archive) чтобы не было свалки
- Сохранить совместимость с существующими MCP tools (`get_mr_comments`, `reply_to_discussion`, `resolve_mr_discussion`) которые используют скиллы `/get-comment` и `/reply-comment`

### Не-цели

- Никакого LLM-анализа, кластеризации или синтеза паттернов в рамках этого тула (это делает отдельный скилл)
- Никакой мульти-проектной выгрузки (за раз — один проект)
- Никакого инкрементального сбора (каждый запуск — полный дамп за период)
- Никакой интеграции с CI/CD (это ad-hoc инструмент)

## Архитектура

### Изменения файловой структуры

```
.scripts/mcp/mcp-servers/mcp-get-comments/
├── index.js                     # правим: удаляем collect_review_patterns tool, добавляем collect_mr_comments
├── gitlab-client.mjs            # без изменений (используется MCP-сервером)
├── mr-comments-collector.mjs    # НОВЫЙ: core модуль (fetch → filter → flatten → write)
├── collect-mr-comments.mjs      # НОВЫЙ: CLI entry point
├── .env                         # правим: удаляем LLM_API_URL, LLM_API_KEY, LLM_MODEL; добавляем BOT_USERNAME_PATTERNS
├── Archi.md                     # обновляем под новую архитектуру
├── USAGE.md                     # обновляем примеры
├── README.md                    # обновляем описание
└── legacy/                      # НОВАЯ папка, куда уезжает старый LLM-пайплайн
    ├── gitlab-review-collector.mjs
    ├── llm-client.mjs
    ├── collect-review-patterns.mjs
    └── test-llm.mjs
```

**Обоснование выбора Variant B (clean rewrite в `legacy/`):**
- Код нового модуля не переплетается со старой LLM-логикой → проще читать
- `gitlab-client.mjs` остаётся как общая абстракция над GitLab API (используется и MCP-сервером, и новым коллектором)
- Старый код не удаляется — может понадобиться для референса или как запасной вариант
- Избегаем накопления технического долга «смешанного» рефакторинга

### Пайплайн сбора (`mr-comments-collector.mjs`)

```
Входные параметры: { projectPath, from, to, states, botPatterns, outputDir }
   │
   ▼
1. fetchMrList(projectPath, state=merged, from, to) ─┐
2. fetchMrList(projectPath, state=closed, from, to)  │ (параллельно)
                                                     ▼
                                    mrs = merge + dedupe по iid
   │
   ▼
3. FOR each mr (последовательно, rate limit 200ms):
     discussions = fetchMrDiscussions(projectPath, mr.iid)
     FOR each discussion:
       FOR each note в discussion.notes (по индексу):
         IF note.system → stats.filtered.system++, skip
         IF isBot(note.author.username, botPatterns) → stats.filtered.bot++, skip
         IF note.body.trim() === "" → stats.filtered.empty++, skip

         flatRecord = flattenNote(mr, discussion, note, index)
         buffer.push(flatRecord)
         stats.written++
   │
   ▼
4. writeJsonlAtomic(outputDir/pending/mr-notes-<dt>.jsonl, buffer)
5. writeMeta(outputDir/pending/mr-notes-<dt>.meta.json, stats + config)
```

**Ключевые моменты:**
- `fetchMrList` вызывается дважды: GitLab API фильтрует по одному `state` за раз
- Дедупликация по `mr.iid` — если MR слит и потом закрыт, не дублируем
- Rate limiting: 200ms sleep между MR (паттерн из существующего `gitlab-client.mjs`)
- Буфер в памяти: при ~1000 MR × ~15 notes ≈ 15k записей, память не проблема
- Атомарная запись: сначала `<file>.jsonl.tmp`, потом `rename` → финальное имя

### JSONL Schema (plat record)

```typescript
interface MrNoteFlatRecord {
  // Версия схемы для будущей миграции
  schema_version: "1.0";

  // Project
  project_path: string;              // "wone-it/terra-housing-mgmt"

  // MR level
  mr_iid: number;                    // 1828
  mr_title: string;
  mr_state: "merged" | "closed";
  mr_created_at: string;             // ISO 8601
  mr_merged_at: string | null;       // null если state=closed
  mr_author_username: string;
  mr_author_name: string;
  mr_web_url: string;
  mr_labels: string[];

  // Discussion level (resolution живёт на уровне thread, не отдельной note)
  discussion_id: string;
  discussion_kind: "diff" | "overview";
  discussion_resolved: boolean;
  discussion_resolved_by_username: string | null;
  discussion_resolved_at: string | null;
  discussion_notes_count: number;

  // Note level
  note_id: number;
  note_body: string;                 // markdown, как в GitLab
  note_author_username: string;
  note_author_name: string;
  note_created_at: string;
  note_type: "DiffNote" | "DiscussionNote" | "Note";

  // Thread role (вычисляется extractor'ом)
  is_root_note: boolean;
  reply_index_in_discussion: number; // 0 для root, 1+ для replies
  thread_root_note_id: number;       // = notes[0].id
  parent_note_id: number | null;     // null для root, = thread_root_note_id для reply

  // Флаг: автор комментария = автор MR
  note_by_mr_author: boolean;

  // Position (только для discussion_kind="diff")
  file_path: string | null;          // new_path ?? old_path
  new_line: number | null;
  old_line: number | null;
  line_range_start: number | null;   // для multi-line комментариев
  line_range_end: number | null;

  // Сигналы
  has_suggestions: boolean;

  // Метаданные экспорта
  exported_at: string;               // ISO 8601
}
```

### Правила вычисления производных полей

| Поле | Правило |
|---|---|
| `discussion_kind` | `"diff"` если `note.type === "DiffNote"` ИЛИ `note.position` существует, иначе `"overview"` |
| `is_root_note` | `index === 0` внутри `discussion.notes[]` |
| `reply_index_in_discussion` | индекс в массиве `notes[]` (0-based) |
| `thread_root_note_id` | `discussion.notes[0].id` |
| `parent_note_id` | `null` если `is_root_note`, иначе `thread_root_note_id` (GitLab не хранит древовидность ответов, поэтому все replies считаем детьми root) |
| `note_by_mr_author` | `note.author.username === mr.author.username` |
| `file_path` | `note.position?.new_path ?? note.position?.old_path ?? null` |
| `new_line` | `note.position?.new_line ?? null` |
| `old_line` | `note.position?.old_line ?? null` |
| `line_range_start` | `note.position?.line_range?.start?.new_line ?? note.position?.new_line ?? null` |
| `line_range_end` | `note.position?.line_range?.end?.new_line ?? note.position?.new_line ?? null` |
| `has_suggestions` | `(note.suggestions?.length ?? 0) > 0` ИЛИ регулярка `/```suggestion/` в `note.body` |
| `mr_labels` | `mr.labels ?? []` |
| `discussion_resolved` | `discussion.notes[0].resolved ?? false` (в GitLab resolved хранится на каждой note, но всегда одинаково внутри discussion — берём с первой) |
| `discussion_resolved_by_username` | `discussion.notes[0].resolved_by?.username ?? null` |
| `discussion_resolved_at` | `discussion.notes[0].resolved_at ?? null` |

### Sidecar meta-файл

Рядом с каждым JSONL лежит `.meta.json`:

```json
{
  "schema_version": "1.0",
  "project_path": "wone-it/terra-housing-mgmt",
  "period_from": "2026-01-10T00:00:00Z",
  "period_to": "2026-04-10T00:00:00Z",
  "mr_states": ["merged", "closed"],
  "generated_at": "2026-04-10T15:00:00Z",
  "generated_by": "collect-mr-comments.mjs v1.0",
  "stats": {
    "total_mrs_fetched": 87,
    "total_discussions_fetched": 412,
    "total_notes_raw": 1543,
    "total_notes_written": 1286,
    "filtered": {
      "system": 156,
      "bot": 89,
      "empty": 12
    }
  },
  "config": {
    "bot_username_patterns": ["*-bot", "*_bot", "ghost"]
  },
  "errors": [
    { "mr_iid": 1753, "error": "GitLab API 500" }
  ]
}
```

## Lifecycle: pending → processed → archive

```
.swap/requirements/use_cases/review/raw/
├── pending/                                     # только что собрано, ждёт анализа скиллом
│   ├── mr-notes-2026-04-10T15-00-00.jsonl
│   └── mr-notes-2026-04-10T15-00-00.meta.json
├── processed/                                   # скилл проанализировал и извлёк уроки
│   └── mr-notes-2026-04-05T10-00-00.jsonl (+ .meta.json)
└── archive/                                     # старые processed, для аудита
    ├── 2026-01/
    └── 2026-02/
        └── mr-notes-2026-02-15T08-00-00.jsonl (+ .meta.json)
```

**Правила:**
- Extractor всегда пишет в `pending/`
- Pattern mining skill после успешной обработки делает `mv pending/X.* processed/X.*`
- Housekeeping: `processed/` файлы старше N дней (по дате в имени) → `archive/YYYY-MM/X.*`
- `archive/YYYY-MM/` хранится вечно до ручного удаления

**Housekeeping запускается отдельной подкомандой:**
```bash
node collect-mr-comments.mjs archive [--older-than 30d]
```

### Идемпотентность

Перед запуском extractor проверяет `pending/` и `processed/` на наличие файлов с пересекающимся периодом (читая `meta.json`). При обнаружении — **warning** в stderr + список пересечений. Не блокирует выполнение, но пользователь может подтвердить через `--force`. Это защита от случайных повторных запусков, не от злого умысла.

## CLI интерфейс

```bash
node collect-mr-comments.mjs [options]
```

| Опция | Описание | Значение по умолчанию |
|---|---|---|
| `--period <value>` | `3m`, `30d`, `1y`, `7d` | `3m` |
| `--from <ISO>` | Начало периода (взаимоисключающе с `--period`) | — |
| `--to <ISO>` | Конец периода | текущий момент |
| `--project <path>` | GitLab project path | из `.env` (`DEFAULT_PROJECT_ID`) |
| `--states <list>` | Comma-separated: `merged`, `closed` | `merged,closed` |
| `--output <path>` | Путь к JSONL (переопределяет lifecycle дефолт) | `<repo>/.swap/requirements/use_cases/review/raw/pending/mr-notes-<datetime>.jsonl` |
| `--force` | Игнорировать warning о пересекающемся периоде | `false` |
| `--verbose` | Подробный лог | `false` |
| `--help` | Справка | — |

**Подкоманды:**
```bash
node collect-mr-comments.mjs archive [--older-than 30d] [--dry-run]
# Перемещает processed/*.jsonl (и .meta.json) старше N дней в archive/YYYY-MM/
# --dry-run: показать что будет перемещено, ничего не делать
```

## MCP tool интерфейс

В `index.js`:
- **Удаляем:** tool `collect_review_patterns`
- **Добавляем:** tool `collect_mr_comments`

```typescript
{
  name: "collect_mr_comments",
  description: "Собрать комментарии из Merge Request'ов за период в JSONL файл для последующего анализа паттернов ревью. Возвращает путь к файлу и статистику.",
  inputSchema: {
    type: "object",
    properties: {
      period:      { type: "string", description: "Период: '3m', '30d', '1y'. Альтернатива from/to." },
      from:        { type: "string", description: "ISO дата начала периода" },
      to:          { type: "string", description: "ISO дата конца периода" },
      project_id:  { type: "string", description: "GitLab project path. По умолчанию из DEFAULT_PROJECT_ID" },
      states:      { type: "array",  items: { type: "string", enum: ["merged", "closed"] } },
      output_path: { type: "string", description: "Путь к JSONL файлу" }
    }
  }
}
```

Возвращает:
```json
{
  "output_path": "/abs/path/to/mr-notes-2026-04-10T15-00-00.jsonl",
  "meta_path": "/abs/path/to/mr-notes-2026-04-10T15-00-00.meta.json",
  "stats": {
    "total_mrs": 87,
    "total_notes_written": 1286,
    "filtered": { "system": 156, "bot": 89, "empty": 12 }
  }
}
```

## Фильтры

### Жёсткие фильтры (всегда)
1. `note.system === true` — все system notes (merge events, assignee changes, label updates)
2. `note.body.trim() === ""` — пустые тела

### Bot filtering
Через glob-паттерны в `.env`:
```bash
BOT_USERNAME_PATTERNS=*-bot,*_bot,ghost,project_*_bot,gitlab-bot
```

Дефолты в коде если переменная не задана: `["*-bot", "*_bot", "ghost"]`.

**Реализация `isBot()`:** конвертируем glob в regex, проверяем `username` против каждого паттерна.

### Помечаемые, но не отфильтрованные
- `note.author.username === mr.author.username` → записываем `note_by_mr_author: true`
- Эти записи важны для анализа — это либо ответы автора на ремарки ревьюеров, либо self-review

## Error handling

| Ошибка | Поведение |
|---|---|
| GitLab 4xx (auth, not found) | Фатально, exit 1 + ясное сообщение |
| GitLab 5xx (server error) | Retry с exponential backoff: 1s → 2s → 4s, после 3 попыток — skip MR, лог в stderr, запись в `meta.errors[]` |
| GitLab 429 (rate limit) | Respect `Retry-After` header, ждём, повторяем (без счётчика попыток) |
| Network failure (fetch throws) | Retry как для 5xx |
| Прерывание процесса | JSONL пишется в `<file>.tmp`, rename в финальное имя только после успешного завершения всего buffer'а → либо полный файл, либо его нет |
| Ошибка записи на диск | Фатально, exit 1 |

## Тестирование

### Smoke tests (ручные)
1. `node collect-mr-comments.mjs --period 1d --verbose` → JSONL существует, валиден (каждая строка парсится), `meta.json` существует, `stats.total_notes_written > 0`
2. Проверка обязательных полей: открыть первую запись, убедиться что все non-null поля присутствуют
3. `node collect-mr-comments.mjs --period 1d` (второй запуск) → warning про пересекающийся период
4. `node collect-mr-comments.mjs --period 1d --force` → новый файл создаётся несмотря на warning
5. `node collect-mr-comments.mjs archive --older-than 0d --dry-run` → список processed файлов без перемещения

### Unit tests (если дойдут руки)
- `flattenNote()`: моки GitLab-ответов (DiffNote root, DiffNote reply, overview note, multi-line), проверка вычисляемых полей
- `isBot()`: набор username + паттернов, positive и negative cases
- `dedupeMrs()`: дубликаты по iid, разные states

### Проверка совместимости со скиллами
- После правок `index.js` перезапустить Claude Code (reload MCP servers)
- Вызвать `mcp__get-comments__get_mr_comments` на любом MR — должно работать
- Вызвать `mcp__get-comments__reply_to_discussion` — должно работать
- Убедиться что `collect_review_patterns` больше нет в списке tools, а `collect_mr_comments` появился

## Миграция из текущего состояния

1. Создать `legacy/` и переместить 4 файла (`gitlab-review-collector.mjs`, `llm-client.mjs`, `collect-review-patterns.mjs`, `test-llm.mjs`)
2. Создать `mr-comments-collector.mjs` с core-логикой
3. Создать `collect-mr-comments.mjs` с CLI
4. Правка `index.js`: удалить импорты из legacy, удалить tool `collect_review_patterns`, добавить tool `collect_mr_comments`, импортирующий из `mr-comments-collector.mjs`
5. Чистка `.env`: удалить `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL`; добавить `BOT_USERNAME_PATTERNS`
6. Обновить `Archi.md`, `USAGE.md`, `README.md`
7. Smoke test новой функциональности
8. Проверка старых MCP tools (`get_mr_comments`, `reply_to_discussion`, `resolve_mr_discussion`)
9. Git commit

## Открытые вопросы

- **Bot detection за пределами username:** в GitLab Premium есть поле `author.bot`, но в self-managed инстансе нашего проекта неизвестно — если поле есть, использовать его дополнительно. *Решение: в коде проверять `note.author.bot === true` как дополнительный сигнал, но не полагаться только на него.*
- **Реестр для идемпотентности:** сейчас план — сканировать `pending/` и `processed/` на пересечения периодов. При большом количестве файлов (>100) это может стать медленным. *Решение: пока не оптимизируем, задокументируем ограничение.*
- **Auto-housekeeping:** сейчас housekeeping ручной. В будущем можно вешать на cron или pre-collection hook. *Решение: не в MVP.*

## Что остаётся за рамками

- Нормализация комментариев (trimming, markdown cleanup, выделение code fences) — задача Pattern mining skill
- Thread reconstruction (enriched threads с signals) — задача скилла
- Семантическая экстракция (issue_type, problem_statement, suggested_fix) — задача скилла
- Кластеризация и синтез review patterns — задача скилла
- Reviewer agent — отдельный подпроект

Эти 4 темы покрываются последующими специализированными specs и не должны ни в какой форме просачиваться в extraction tool.

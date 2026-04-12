# Review Collector — Progress & Continuation Guide

## Цель проекта

Standalone инструмент для сбора, хранения и анализа ревью-комментариев из GitLab MR.

**Конечная цель** — замкнутый цикл из трёх подсистем:

1. **Extraction Tool** ✅ — сбор комментариев из GitLab API за период → JSONL файлы
2. **Pattern Mining Skill** ✅ — чтение JSONL, нормализация, кластеризация, синтез правил ревью
3. **Specialized Reviewer Agent** 🔜 — получает diff нового MR + топ-N паттернов → проверяет только по известным правилам

---

## Что уже сделано

### Extraction Tool (полностью готов)

Реализован в рамках проекта `terra-housing-mgmt` на ветке `review-collector-final`, затем вынесен сюда.

#### Файлы

| Файл | Назначение |
|------|-----------|
| `mr-comments-collector.mjs` | Ядро: pure functions + pipeline сбора |
| `collect-mr-comments.mjs` | CLI обёртка |
| `mr-comments-collector.test.mjs` | 27 unit-тестов (node:test) |
| `gitlab-client.mjs` | HTTP клиент GitLab API (скопирован из Terra MCP) |
| `.env` | Конфигурация (GITLAB_TOKEN, GITLAB_URL, DEFAULT_PROJECT_ID) |

#### Возможности CLI

```bash
# Сбор за период
node collect-mr-comments.mjs --period 3m
node collect-mr-comments.mjs --from 2026-01-01 --to 2026-03-31

# Опции
--project wone-it/terra-housing-mgmt
--states merged closed
--output /custom/path/output.jsonl
--force          # игнорировать пересечение периодов
--verbose        # подробный лог

# Архивирование старых файлов
node collect-mr-comments.mjs archive --older-than 30d
node collect-mr-comments.mjs archive --older-than 30d --dry-run
```

#### Lifecycle директорий

```
review/raw/
  pending/     ← новые экспорты из collect-mr-comments.mjs
  processed/   ← после обработки preprocess-comments.mjs (перемещается автоматически)
  archive/
    2026-01/   ← автоархив по месяцам
    2026-02/
```

#### JSONL схема (schema_version: "1.0")

Каждая строка — один note (комментарий) с полями:
- `mr_iid`, `mr_title`, `mr_state`, `mr_author_username`, `mr_labels`
- `discussion_id`, `discussion_kind` (diff|overview), `discussion_resolved`
- `note_id`, `note_body`, `note_author_username`, `note_created_at`
- `is_root_note`, `reply_index_in_discussion`, `parent_note_id`
- `file_path`, `new_line`, `line_range_start`, `line_range_end`
- `has_suggestions`, `note_by_mr_author`, `exported_at`

#### Тесты

```bash
node --test mr-comments-collector.test.mjs
# 27/27 pass
```

Покрывают: `globToRegex`, `isBot`, `parsePeriod`, `dedupeMrsByIid`, `detectDiscussionKind`, `flattenNote`, `writeJsonlAtomic`, `writeMeta`, `findOverlappingExports`, `formatFileDateTime`, `parseDateTimeFromFilename`, `archiveOldProcessedFiles`

#### Что НЕ вошло в этот проект (остаётся в Terra)

- `index.js` — MCP сервер с инструментами `/get-comment`, `/reply-comment`, `resolve_mr_discussion` и др.
- `legacy/` — старый LLM-based pipeline (gitlab-review-collector.mjs, llm-client.mjs и др.)

---

### Pattern Mining Skill (полностью готов)

| Файл | Назначение |
|------|-----------|
| `preprocess-comments.mjs` | CLI препроцессор: thread reconstruction, нормализация, state |
| `preprocess-comments.test.mjs` | Unit-тесты (node:test), 24 теста |
| `.claude/skills/mine-patterns.md` | Claude Code скилл: Pass 1 + Pass 2 |

#### Возможности

- Инкрементальная обработка: только новые файлы из `review/raw/pending/`
- Pass 1: чанки по 30 тредов → raw паттерны → `patterns/mining-state.json`
- Pass 2: финализация, дедупликация → `patterns/review-patterns.json` + `.md`

#### Запуск

```bash
# 1. Убедись что есть файлы в review/raw/pending/
# 2. Запусти скилл в Claude Code
/mine-patterns
```

---

## Что предстоит сделать

### 2. Pattern Mining Skill

**Статус:** Не начат. Дизайн не написан.

**Идея (предварительная):**
- Читает JSONL файлы из `review/raw/pending/`
- Нормализует треды: реконструирует цепочки root-note → replies
- Разбивает на семантические единицы (одна мысль = один unit)
- Кластеризует похожие комментарии
- Синтезирует из каждого кластера правило ревью в формате:
  ```
  Паттерн: "Отсутствие timeout в HTTP клиентах"
  Категория: robustness
  Частота: 12 раз в 3 месяца
  Пример: "Нужен timeout, иначе при недоступности сервиса запросы будут висеть вечно"
  Правило: При создании HTTP клиента всегда задавай timeout явно
  ```
- Сохраняет паттерны в structured JSON/YAML

**Важно:** НЕ искать повторяющиеся паттерны (при малой выборке их нет) — СИНТЕЗИРОВАТЬ правила из любых комментариев, даже единичных.

### 3. Specialized Reviewer Agent

**Статус:** Не начат.

**Идея:**
- Получает diff нового MR
- Загружает топ-N паттернов из Pattern Mining
- Проверяет diff ТОЛЬКО по этим правилам (не general review)
- Выдаёт структурированный отчёт: "Паттерн X: нарушение в файле Y строка Z"

---

## Архитектура (3 подсистемы)

```
GitLab API
    ↓
[Extraction Tool] → JSONL files in pending/ → [preprocess-comments.mjs auto-moves to processed/]
    ↓
[Pattern Mining Skill] → review-patterns.json
    ↓
[Reviewer Agent] ← diff нового MR
    ↓
structured review report
```

---

## Настройка проекта

```bash
# .env (создай рядом с gitlab-client.mjs)
GITLAB_TOKEN=your_token_here
GITLAB_URL=https://your-gitlab.example.com/api/v4
DEFAULT_PROJECT_ID=your-group/your-project
```

Токен GitLab: Settings → Access Tokens → read_api scope.

---

## Prompt для продолжения работы

Если начинаешь новую сессию по этому проекту, скажи:

> Я работаю над проектом Review Collector в `/home/sergey/source/review-collector`.
> Это standalone инструмент для сбора GitLab MR комментариев и последующего анализа паттернов ревью.
> Прочитай PROGRESS.md чтобы понять что сделано и что предстоит.
> Extraction Tool полностью готов (27 тестов, CLI, lifecycle управление файлами).
> Следующий шаг — Pattern Mining Skill: проектирование и реализация.

---

## История изменений

| Дата | Что сделано |
|------|-------------|
| 2026-04-10 | Extraction Tool реализован (12 задач, 27 тестов) в Terra на ветке `review-collector-final` |
| 2026-04-10 | Проект вынесен в отдельный репозиторий `/home/sergey/source/review-collector` |
| | Remote: `git@github.com:lychagin/GetGitlabComments.git` |
| 2026-04-12 | Pattern Mining Skill реализован (24 теста, CLI препроцессор, скилл /mine-patterns) |

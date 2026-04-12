# Reviewer Agent — Design Spec

**Date:** 2026-04-12
**Status:** Approved

---

## Цель

Специализированный Claude Code скилл `/review-commits` для проверки локальных коммитов против базы паттернов ревью. Главный сценарий — проверить свои коммиты перед пушем.

---

## Компоненты

### 1. `get-diff.mjs` — CLI-хелпер получения diff

Принимает git-ссылку в argv[2], возвращает JSON в stdout:

```json
{
  "commits": [
    { "sha": "abc1234", "message": "feat: add timeout", "author": "Sergey" }
  ],
  "diff": "<полный unified diff>",
  "files_changed": ["src/foo.ts", "src/bar.ts"]
}
```

**Поддерживаемые форматы аргумента** (строго git-синтаксис):
- `HEAD~3` — последние 3 коммита
- `abc123` — один коммит
- `abc123..def456` — диапазон коммитов
- `HEAD` — последний коммит (дефолт если аргумент не передан)

Реализация: `git log` + `git diff` через `node:child_process`. Экспортирует pure functions для тестирования.

**Exit codes:**
- `0` — успех, JSON в stdout
- `1` — ошибка (invalid ref, не git-репозиторий), сообщение в stderr

---

### 2. `.claude/skills/review-commits/SKILL.md` — скилл-оркестратор

**Вызов:**
```
/review-commits HEAD~3
/review-commits abc123..def456
/review-commits abc123
/review-commits последние 3 коммита
/review-commits last 5 commits
/review-commits          ← без аргумента — спросить у пользователя
```

**Алгоритм:**

1. **Парсинг аргумента** — если git-синтаксис → использовать как есть. Если свободный текст → интерпретировать (например, "последние 3 коммита" → `HEAD~3`, "last commit" → `HEAD`). Если пусто → спросить пользователя.

2. **Получение diff** — запустить `node get-diff.mjs <git-ref>`, прочитать JSON из stdout.

3. **Загрузка паттернов** — прочитать `patterns/review-patterns.json`.

4. **Анализ** — для каждого файла в diff определить какие паттерны потенциально применимы (по категории, ключевым словам, типу файла). Проверить diff против выбранных паттернов.

5. **Формирование отчёта** — только нарушения (см. формат ниже).

6. **Сохранение** — записать отчёт в `review/reports/YYYY-MM-DD-<short-sha>.md`.

7. **Вывод** — напечатать отчёт в терминал + путь к файлу.

---

## Формат отчёта

### Есть нарушения:

```markdown
# Code Review Report

**Commits:** abc123..def456 (3 commits)
**Date:** 2026-04-12

---

## p_002 · Параметры пагинации без максимального лимита

**Файл:** `src/services/foo.service.ts:45`
**Фрагмент:** `take: params.take`
**Проблема:** параметр take передаётся без ограничения max. Клиент может запросить неограниченный объём данных.

---

## p_006 · Дублирование параметров пагинации

**Файл:** `src/services/bar.service.ts:12`
**Фрагмент:** `{ take, skip, sort, showDeleted }`
**Проблема:** те же поля уже объявлены в CALLS_GET_PARAMS — вынеси в переиспользуемую константу.
```

### Нарушений нет:

```markdown
# Code Review Report

**Commits:** abc123 (1 commit)
**Date:** 2026-04-12

✅ Нарушений паттернов не найдено.
```

После отчёта в терминале:
```
Report saved: review/reports/2026-04-12-abc1234.md
```

---

## Файловая структура

```
review-collector/
  get-diff.mjs                          # CLI-хелпер (новый)
  get-diff.test.mjs                     # Unit-тесты (новый)
  .claude/skills/review-commits/
    SKILL.md                            # Скилл-оркестратор (новый)
  review/
    reports/                            # Отчёты ревью (создаётся автоматически)
      2026-04-12-abc1234.md
      2026-04-12-def5678.md
```

---

## Соглашения

- `get-diff.mjs` следует паттерну проекта: pure functions экспортируются, CLI entry point защищён через `if (process.argv[1] === ...)`
- `review/reports/` добавляется в `.gitignore` — отчёты локальные, не коммитятся
- Если `patterns/review-patterns.json` не существует — скилл останавливается с сообщением: "Patterns not found. Run `/mine-patterns` first."

---

## Что не входит в скоуп

- Интеграция с GitLab API для remote MR (только локальный git)
- Автоматический запуск как git pre-push hook
- Фильтрация по файлам или директориям
- Сравнение с предыдущими отчётами

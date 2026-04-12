# Review Collector — Project Context

## Что это

Standalone инструмент для сбора GitLab MR комментариев и анализа паттернов ревью.
Три подсистемы: Extraction Tool → Pattern Mining → Reviewer Agent.

## Язык и стек

- **Runtime:** Node.js, ESM (`import`/`export`), без TypeScript
- **Тесты:** `node:test` + `node:assert/strict` (встроенные, без Jest/Mocha)
- **Зависимости:** намеренно минимальные — только стандартная библиотека Node.js
- **Файлы:** `.mjs` расширение для всех скриптов

## Запуск тестов

```bash
node --test mr-comments-collector.test.mjs
node --test preprocess-comments.test.mjs
```

## Структура проекта

```
review-collector/
  mr-comments-collector.mjs       # Extraction Tool: ядро (pure functions + pipeline)
  collect-mr-comments.mjs         # Extraction Tool: CLI обёртка
  mr-comments-collector.test.mjs  # Тесты Extraction Tool (27 тестов)
  gitlab-client.mjs               # HTTP клиент GitLab API
  preprocess-comments.mjs         # Pattern Mining: препроцессор
  preprocess-comments.test.mjs    # Тесты препроцессора
  .claude/skills/mine-patterns/SKILL.md # Claude Code скилл /mine-patterns
  review/raw/
    pending/                      # новые экспорты из collect-mr-comments.mjs
    processed/                    # после обработки (auto-moved by preprocess-comments.mjs)
  patterns/                       # Выход pattern mining
    mining-state.json             # Состояние: обработанные файлы + raw паттерны
    threads.jsonl                 # Промежуточный артефакт препроцессора
    review-patterns.json          # Финальные паттерны (source of truth)
    review-patterns.md            # Markdown view для чтения
  docs/
    superpowers/specs/            # Design specs
    superpowers/plans/            # Implementation plans
    adr/                          # Architectural Decision Records
```

## Ключевые соглашения

- **Pure functions экспортируются** именованными экспортами для тестирования
- **CLI entry point** защищён через `if (process.argv[1] === new URL(import.meta.url).pathname)`
- **Атомарная запись файлов:** сначала `.tmp`, потом `rename`
- **JSONL формат:** одна запись на строку, каждая строка валидный JSON

## Текущий статус

- ✅ **Extraction Tool** — готов (27 тестов)
- ✅ **Pattern Mining** — готов (препроцессор + скилл /mine-patterns)
- 🔜 **Reviewer Agent** — не начат

## Документация

- `PROGRESS.md` — детальное описание что сделано и что предстоит
- `docs/superpowers/specs/2026-04-12-pattern-mining-design.md` — дизайн Pattern Mining
- `docs/superpowers/plans/2026-04-12-pattern-mining.md` — план реализации
- `docs/adr/` — архитектурные решения с обоснованием

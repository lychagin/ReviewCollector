# Pattern Mining Skill — Design Spec

**Дата:** 2026-04-12  
**Автор:** Sergey Lychagin  
**Статус:** Approved  

---

## Контекст

Extraction Tool (подсистема 1) готов: собирает MR-комментарии из GitLab в JSONL файлы,
управляет lifecycle `pending/ → processed/ → archive/`.

Pattern Mining — подсистема 2. Читает `processed/*.jsonl`, синтезирует review паттерны
для последующего использования Specialized Reviewer Agent (подсистема 3).

**Приоритет: качество паттернов, не скорость.** Инструмент может работать минуты и часы —
это приемлемо.

---

## Цели и не-цели

### Цели

- Синтезировать review паттерны из любых комментариев, включая единичные (не искать повторения — синтезировать правила)
- Работать инкрементально: при повторном запуске обрабатывать только новые файлы
- Выдавать паттерны в двух форматах: JSON (source of truth) + Markdown (human-readable)
- Дедуплицировать паттерны при накоплении

### Не-цели

- Пакетная обработка всех комментариев за один LLM-вызов
- Полностью автономный pipeline без участия Claude Code
- Интеграция с CI/CD

---

## Архитектура

### Компоненты

```
processed/*.jsonl  +  patterns/mining-state.json
         ↓
[preprocess-comments.mjs]   ← CLI, механическая работа
         ↓
  patterns/threads.jsonl    ← реконструированные треды, компактные
         ↓
[/mine-patterns skill]      ← Claude управляет всем дальше
    │
    ├── Pass 1: читает threads.jsonl по чанкам (~30-50 тредов)
    │   каждый чанк → Claude анализирует → raw паттерны
    │   накапливаются в mining-state.json → raw_patterns[]
    │
    └── Pass 2: читает raw_patterns[] целиком
        Claude обобщает, дедуплицирует, финализирует
        ↓
  patterns/review-patterns.json   ← source of truth
  patterns/review-patterns.md     ← human-readable view
```

### Файловая структура

```
review-collector/
  processed/                      ← Extraction Tool (существует)
  patterns/
    mining-state.json             ← обработанные файлы + накопленные raw-паттерны
    threads.jsonl                 ← вывод препроцессора (перезаписывается каждый раз)
    review-patterns.json          ← финальные паттерны (source of truth)
    review-patterns.md            ← markdown view
  preprocess-comments.mjs         ← новый CLI скрипт
```

---

## Компонент 1: `preprocess-comments.mjs`

### Ответственность

Вся механическая работа с данными. Claude не читает raw JSONL.

### Алгоритм

1. Читает `patterns/mining-state.json` → список уже обработанных файлов
2. Определяет новые файлы: `processed/*.jsonl` минус `mining-state.processed_files`
3. Для каждого нового файла:
   - Группирует записи по `discussion_id`
   - Реконструирует тред: `root_note → replies[]`
   - Нормализует текст: убирает markdown-разметку, выносит code fences в `code_snippets[]`
   - Применяет фильтр `note_by_mr_author`: убирает из тела треда если это не единственная нота и не ответ автора на замечание ревьюера
4. Записывает все треды в `patterns/threads.jsonl` (один тред на строку, перезаписывает)
5. Выводит статистику: сколько новых файлов, сколько тредов

### Формат треда в `threads.jsonl`

```json
{
  "discussion_id": "abc123",
  "kind": "diff",
  "file_path": "src/http-client.js",
  "root_comment": "Нужен timeout, иначе зависнет",
  "replies": ["Исправил, добавил 5s timeout"],
  "code_snippets": ["const client = axios.create()"],
  "resolved": true,
  "mr_iid": 1828,
  "source_file": "mr-notes-2026-04-01.jsonl"
}
```

### Запуск

```bash
node preprocess-comments.mjs
# Stdout: "Processed 2 new files, 147 threads written to patterns/threads.jsonl"
# Exit 0 если нет новых файлов (скилл проверяет по выводу)
```

---

## Компонент 2: Скилл `/mine-patterns`

### Pass 1 — Синтез raw паттернов

- Читает `threads.jsonl` чанками по ~30-50 тредов
- Для каждого чанка Claude анализирует что критиковали ревьюеры и формулирует 1-3 raw паттерна
- Добавляет к `mining-state.json → raw_patterns[]`
- Прогресс виден пользователю (чанк N из M)

**Формат raw паттерна:**
```json
{
  "id": "rp_001",
  "title": "Отсутствие timeout в HTTP клиентах",
  "category": "robustness",
  "rule": "При создании HTTP клиента всегда задавай timeout явно",
  "evidence": ["Нужен timeout, иначе зависнет", "..."],
  "source_discussions": ["abc123", "def456"],
  "frequency": 3
}
```

### Pass 2 — Финализация

- Читает весь `raw_patterns[]` из `mining-state.json`
- Claude объединяет дубликаты, обобщает формулировки, расставляет приоритеты
- Записывает `review-patterns.json` и генерирует `review-patterns.md`

### Инкрементальность

- Если новых файлов нет → Pass 1 пропускается, только Pass 2
- `mining-state.processed_files` обновляется после успешного Pass 1

---

## Формат финальных паттернов

### `review-patterns.json`

```json
{
  "schema_version": "1.0",
  "generated_at": "2026-04-12T10:00:00Z",
  "patterns": [
    {
      "id": "p_001",
      "title": "Отсутствие timeout в HTTP клиентах",
      "category": "robustness",
      "priority": "high",
      "rule": "При создании HTTP клиента всегда задавай timeout явно",
      "rationale": "При недоступности сервиса запросы будут висеть вечно",
      "example_comments": [
        "Нужен timeout, иначе при недоступности сервиса запросы будут висеть вечно"
      ],
      "frequency": 5,
      "last_seen": "2026-04-01"
    }
  ]
}
```

### `review-patterns.md`

```markdown
# Review Patterns

## robustness

### p_001 · Отсутствие timeout в HTTP клиентах
**Правило:** При создании HTTP клиента всегда задавай timeout явно
**Почему:** При недоступности сервиса запросы будут висеть вечно
**Встречалось:** 5 раз
**Пример:** "Нужен timeout, иначе при недоступности сервиса..."
```

**Категории** (расширяются Claude при необходимости):
`robustness`, `security`, `performance`, `style`, `architecture`, `testing`

---

## `mining-state.json` — структура

```json
{
  "schema_version": "1.0",
  "processed_files": [
    "mr-notes-2026-04-01T10-00-00.jsonl"
  ],
  "raw_patterns": [ ],
  "last_updated": "2026-04-12T10:00:00Z"
}
```

---

## Тестирование

### Unit-тесты `preprocess-comments.mjs` (node:test)

- `reconstructThread()`: плоские записи → тред с root + replies
- `normalizeText()`: strip markdown, выделение code fences
- `filterAuthorNotes()`: правила фильтрации `note_by_mr_author`
- `detectNewFiles()`: сравнение `processed/` с `mining-state.processed_files`

### Качество паттернов (ручная проверка)

- Raw паттерны содержат `evidence` из реальных комментариев
- Финальные паттерны не дублируются
- Формулировка `rule` actionable: можно применить к новому MR

---

## Связь с другими подсистемами

| Подсистема | Интерфейс |
|---|---|
| Extraction Tool (вход) | Читает `processed/*.jsonl` + `meta.json` |
| Reviewer Agent (выход) | Читает `patterns/review-patterns.json` |

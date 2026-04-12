# Pattern Mining Skill — Usage & Testing Guide

## Обзор

Pattern Mining — подсистема 2 Review Collector. Читает MR-комментарии из `processed/`,
синтезирует review паттерны через двухпроходный LLM-анализ.

## Предварительные требования

- Extraction Tool отработал, файлы находятся в `processed/`
- Claude Code запущен в директории проекта

## Типичный рабочий сценарий

```bash
# 1. Собрать комментарии (Extraction Tool)
node collect-mr-comments.mjs --period 3m

# 2. Пометить как готово к анализу
mv pending/mr-notes-*.jsonl processed/
mv pending/mr-notes-*.meta.json processed/

# 3. Запустить Pattern Mining
/mine-patterns
```

## Запуск скилла

В Claude Code напишите:
```
/mine-patterns
```

Скилл выполнит:
1. Запустит `preprocess-comments.mjs` — реконструкция тредов из `processed/`
2. Pass 1 — анализ тредов чанками, синтез raw паттернов
3. Pass 2 — финализация, дедупликация, генерация output файлов

## Выходные файлы

| Файл | Назначение |
|---|---|
| `patterns/review-patterns.json` | Финальные паттерны, source of truth |
| `patterns/review-patterns.md` | Человекочитаемый view |
| `patterns/mining-state.json` | Состояние: обработанные файлы + raw паттерны |
| `patterns/threads.jsonl` | Промежуточный артефакт препроцессора |

## Повторный запуск (новые данные)

При появлении новых файлов в `processed/` просто запустите `/mine-patterns` снова.
Скилл обработает только новые файлы и пересинтезирует финальные паттерны.

## Просмотр паттернов

```bash
# Markdown view
cat patterns/review-patterns.md

# JSON (все паттерны)
cat patterns/review-patterns.json | jq '.patterns[]'

# Только high priority
cat patterns/review-patterns.json | jq '.patterns[] | select(.priority == "high")'

# По категории
cat patterns/review-patterns.json | jq '.patterns[] | select(.category == "robustness")'
```

## Ручной запуск препроцессора

Если нужно только переобработать треды без синтеза паттернов:

```bash
node preprocess-comments.mjs
# Stdout: "Processed N new files, M threads written to patterns/threads.jsonl"
```

---

## Тестирование

### Unit-тесты препроцессора

```bash
node --test preprocess-comments.test.mjs
```

Покрывают:
- `reconstructThread()` — плоские записи → тред с root + replies
- `normalizeText()` — strip markdown, выделение code fences
- `filterAuthorNotes()` — фильтрация `note_by_mr_author`
- `detectNewFiles()` — сравнение `processed/` с `mining-state.processed_files`

### Проверка качества паттернов (вручную)

После запуска `/mine-patterns` проверь:

**1. Raw паттерны содержат реальные evidence**
```bash
cat patterns/mining-state.json | jq '.raw_patterns[0].evidence'
# Должны быть реальные цитаты из комментариев
```

**2. Финальные паттерны не дублируются**
```bash
cat patterns/review-patterns.json | jq '[.patterns[].title]'
# Убедись что нет похожих заголовков
```

**3. Формулировки actionable**

Каждый паттерн проверь на вопрос: "Могу ли я применить это правило при ревью нового MR?"
- ✅ "При создании HTTP клиента всегда задавай timeout явно"
- ❌ "Нужно быть осторожнее с HTTP клиентами"

### Smoke-тест полного pipeline

```bash
# 1. Убедись что есть файлы в processed/
ls processed/

# 2. Запусти препроцессор
node preprocess-comments.mjs
# Ожидаем: "Processed N new files, M threads written"

# 3. Проверь threads.jsonl
head -1 patterns/threads.jsonl | jq .
# Ожидаем: валидный тред с полями discussion_id, root_comment, ...

# 4. Запусти скилл
/mine-patterns

# 5. Проверь выходные файлы
cat patterns/review-patterns.md
cat patterns/review-patterns.json | jq '.patterns | length'
# Ожидаем: > 0 паттернов
```

### Проверка инкрементальности

```bash
# 1. Запусти скилл
/mine-patterns

# 2. Запусти снова без новых файлов
/mine-patterns
# Ожидаем: Pass 1 пропущен ("No new files to process"), только Pass 2

# 3. Добавь новый файл в processed/ и запусти снова
/mine-patterns
# Ожидаем: обработан только новый файл
```

---

## Troubleshooting

**`preprocess-comments.mjs` не находит новых файлов**
- Убедись что файлы находятся в `processed/`, не в `pending/`
- Проверь `mining-state.json` → `processed_files` — возможно файл уже отмечен как обработанный

**Pass 1 генерирует слишком много дублирующихся raw паттернов**
- Это нормально — Pass 2 их объединит
- Если дубли остаются в финальных паттернах, запусти `/mine-patterns` повторно (только Pass 2)

**Паттерны слишком общие / слишком специфичные**
- Скорректируй промпт в скилле и перезапусти Pass 2
- Можно вручную отредактировать `mining-state.json → raw_patterns` перед Pass 2

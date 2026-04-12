# Review Collector

Инструмент для сбора ревью-комментариев из GitLab Merge Requests в плоский JSONL формат — для последующего анализа паттернов ревью.

## Зачем

Цикл работы выглядит так:

```
GitLab API
    ↓
[Review Collector]  →  JSONL файлы с комментариями
    ↓
[Pattern Mining]    →  правила ревью (планируется)
    ↓
[Reviewer Agent]    ←  diff нового MR
    ↓
structured review report
```

Review Collector — первая ступень: он скачивает все человеческие комментарии из MR за заданный период и сохраняет их в файлы для дальнейшей обработки.

## Требования

- Node.js 20+
- Доступ к GitLab (токен с правом `read_api`)
- Сеть до GitLab сервера (VPN если нужно)

Внешних npm-зависимостей нет — используется только стандартная библиотека Node.js.

## Установка

```bash
git clone git@github.com:lychagin/GetGitlabComments.git
cd GetGitlabComments
cp .env.example .env
```

Заполни `.env`:

```env
GITLAB_TOKEN=your_gitlab_token_here
GITLAB_URL=https://your-gitlab.example.com/api/v4
DEFAULT_PROJECT_ID=your-group/your-project
```

Токен создаётся в GitLab: **Settings → Access Tokens → read_api**.

## Запуск

### Сбор комментариев

```bash
# За последние 3 месяца (по умолчанию)
node collect-mr-comments.mjs

# За конкретный период
node collect-mr-comments.mjs --period 6m
node collect-mr-comments.mjs --period 30d --verbose
node collect-mr-comments.mjs --from 2026-01-01 --to 2026-03-31

# Другой проект
node collect-mr-comments.mjs --period 3m --project other-group/other-repo

# Только merged или только closed
node collect-mr-comments.mjs --states merged
node collect-mr-comments.mjs --states merged,closed

# Указать путь к файлу вручную
node collect-mr-comments.mjs --output /tmp/my-comments.jsonl

# Повторный сбор за тот же период (игнорировать предупреждение)
node collect-mr-comments.mjs --period 3m --force
```

Результат сохраняется в `pending/`:

```
output-root/
  pending/
    mr-notes-2026-04-12T10-30-00.jsonl      ← данные
    mr-notes-2026-04-12T10-30-00.meta.json  ← метаданные (период, статистика)
```

По умолчанию `output-root` — папка `.swap/requirements/use_cases/review/raw/` относительно репозитория, или задаётся через `--output`.

### Управление файлами

После того как файлы из `pending/` проверены/обработаны, перемести их в `processed/` вручную. Старые файлы из `processed/` можно архивировать:

```bash
# Показать что будет архивировано (ничего не трогает)
node collect-mr-comments.mjs archive --older-than 30d --dry-run

# Переместить в archive/YYYY-MM/
node collect-mr-comments.mjs archive --older-than 30d
node collect-mr-comments.mjs archive --older-than 60d
```

### Справка

```bash
node collect-mr-comments.mjs --help
```

## Формат выходных данных

JSONL — одна строка на комментарий. Каждая запись содержит:

| Поле | Описание |
|------|----------|
| `mr_iid`, `mr_title`, `mr_state` | Данные MR |
| `mr_author_username`, `mr_labels` | Автор и метки MR |
| `discussion_id`, `discussion_kind` | ID треда, тип: `diff` или `overview` |
| `discussion_resolved` | Решён ли тред |
| `note_id`, `note_body` | ID и текст комментария |
| `note_author_username` | Автор комментария |
| `is_root_note`, `parent_note_id` | Позиция в треде |
| `file_path`, `new_line` | Файл и строка (для inline комментариев) |
| `has_suggestions` | Есть ли `suggestion` блок |
| `exported_at` | Время экспорта |

Пример строки:

```json
{"schema_version":"1.0","mr_iid":1828,"mr_title":"feat: add timeout","discussion_kind":"diff","note_body":"Нужен timeout, иначе при недоступности сервиса запросы зависнут","file_path":"src/client.ts","new_line":57,"is_root_note":true,...}
```

## Тесты

```bash
node --test mr-comments-collector.test.mjs
```

27 unit-тестов покрывают все pure functions и IO-хелперы.

## Структура проекта

```
.
├── collect-mr-comments.mjs       # CLI
├── mr-comments-collector.mjs     # Ядро: pipeline + pure functions
├── mr-comments-collector.test.mjs # Unit тесты
├── gitlab-client.mjs             # HTTP клиент GitLab API
├── .env.example                  # Шаблон конфигурации
└── PROGRESS.md                   # История работы и планы
```

## Фильтрация

Автоматически отфильтровываются:
- System notes (GitLab служебные сообщения)
- Боты (по умолчанию: `*-bot`, `*_bot`, `ghost`)
- Пустые комментарии

Список ботов можно переопределить в `.env`:

```env
BOT_USERNAME_PATTERNS=*-bot,*_bot,ghost,ci-user
```

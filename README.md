# GOSTDocs

Плагин для Claude Code, который собирает пакет документации на информационную систему по российским ГОСТ — без ручной возни со скриншотами, нумерацией рисунков и подгонкой шрифтов.

Плагин читает код проекта и техническое задание, поднимает приложение в браузере, обходит его под каждой ролью, делает скриншоты, разбирает интерфейс через vision-модель и собирает готовый комплект документов в Markdown и DOCX. Поддерживается строгий ГОСТ Р 59795 (с титульным листом и Times New Roman 14) и облегчённый формат для внутренних задач.

## Что генерирует

| Документ | Назначение |
|---|---|
| Руководство пользователя | Что и как делает обычный пользователь системы, шаг за шагом, со скриншотами под его ролью |
| Руководство администратора | Управление пользователями, ролями, резервные копии, аудит, безопасность |
| Руководство оператора | Регламентные процедуры, мониторинг, реакция на инциденты |
| Техническое описание | Архитектура, технологический стек, схема БД, API, реализация безопасности |
| Архитектурный документ | Диаграммы компонентов, потоков данных, последовательностей авторизации |
| Руководство по развёртыванию | Команды установки и обновления, проверочные curl-запросы, тестовые учётные записи |

Стандарты, по которым оформляются документы:

| Стандарт | Что определяет |
|---|---|
| РД 50-34.698-90 | Структура разделов |
| ГОСТ 34.201-89 | Виды и номенклатура документов |
| ГОСТ Р 59795-2021 | Требования к содержанию |
| ГОСТ 2.105-95 | Оформление: шрифты, поля, нумерация |

## Установка

### Через маркетплейс Claude Code

В `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "gostdocs": {
      "source": {
        "source": "github",
        "repo": "borzov/gostdocs"
      }
    }
  }
}
```

Дальше в Claude Code:

```
/plugin install gostdocs@gostdocs
```

### Ручная установка

```bash
git clone https://github.com/borzov/gostdocs.git
cp -R gostdocs/skills/gostdocs ~/.claude/skills/gostdocs
```

### Через симлинк (для разработки)

```bash
git clone https://github.com/borzov/gostdocs.git ~/Develop/gostdocs
ln -s ~/Develop/gostdocs/skills/gostdocs ~/.claude/skills/gostdocs
```

## Зависимости

Обязательные системные пакеты:

```bash
brew install pandoc
pip3 install python-docx
```

Опционально:

```bash
brew install poppler          # чтобы скилл умел читать PDF-спецификации
brew install mermaid-cli      # рендер диаграмм в PNG; без него диаграмма попадает в документ как текстовый блок
```

Docker нужен только если хотите, чтобы плагин сам поднял приложение командой `docker compose up -d`.

Playwright и Chromium ставить вручную **не нужно** — плагин при первом запуске сам скачает их в свою папку (`skills/gostdocs/node_modules/`, `skills/gostdocs/.playwright-cache/`) и больше никогда не лезет в глобальное окружение.

## Быстрый старт

Откройте проект в Claude Code и введите:

```
/gostdocs
```

Дальше плагин:

1. Просканирует репозиторий и определит стек, версию, организацию из git и манифестов проекта.
2. Задаст несколько точечных вопросов: какие документы собрать, какой режим ГОСТ, путь к ТЗ, URL приложения, учётные данные для каждой роли.
3. Сохранит ответы в `docs/meta.yaml` (этот файл сразу попадает в `.gitignore` — там пароли).
4. Запустит проверочную фазу: проверит, что приложение поднято, API отвечает, под каждой ролью можно залогиниться.
5. Параллельно проанализирует код и спецификации двумя субагентами и извлечёт схему БД и OpenAPI.
6. Составит план съёмки (роли × вьюпорты × темы × локали × состояния), снимет скриншоты, разберёт каждый кадр vision-моделью.
7. Соберёт Markdown по шаблонам ГОСТ, прогонит через pandoc + reference.docx, дотащит DOCX до соответствия ГОСТ через python-docx.
8. Положит итоговый отчёт `REPORT.md` рядом с документами — там покрытие по ролям, повторяющиеся снимки, пустые разделы и подозрительные кадры.

При повторном запуске плагин предложит использовать сохранённые ответы из `meta.yaml` — переотвечать не придётся. Можно перезапустить любую отдельную фазу через `--only`, переснять только одну роль через `--rerun-screenshots <role>`, или вовсе пропустить съёмку через `--skip-screenshots`.

Если хочется без слэш-команды:

```
Сгенерируй руководство пользователя для этого проекта
```

— скилл активируется по триггеру и пройдёт ту же последовательность.

## Что получится на выходе

```
docs/
├── meta.yaml                            # параметры запуска (в .gitignore — там пароли)
├── screenshots/
│   ├── guest/desktop/light/ru/...       # скриншоты по роли × вьюпорту × теме × локали
│   ├── admin/...
│   ├── user/...
│   └── manifest.json                    # каталог всех снимков с ролями и метаданными
├── generated/
│   ├── user-guide.md
│   ├── admin-guide.md
│   ├── operator-guide.md
│   ├── technical-description.md
│   ├── architecture.md
│   ├── deployment-guide.md
│   ├── _captures/plan.json              # план съёмки
│   ├── _research/                       # выводы субагентов: код, ТЗ, схема БД, OpenAPI
│   ├── _inspection/                     # JSON-разбор каждого скриншота
│   ├── _diagrams/                       # отрисованные mermaid-диаграммы
│   ├── REPORT.md                        # отчёт о покрытии и проблемах
│   └── FINALIZATION_REPORT.md           # остатки шаблонных плейсхолдеров
└── output/
    ├── user_guide.docx
    ├── admin_guide.docx
    └── ...
```

При работе с двумя языками (`--lang ru,en`) DOCX-файлы получают суффикс: `user_guide_ru.docx`, `user_guide_en.docx`.

## Как это работает

Плагин разбит на семь самостоятельных фаз — каждую можно запустить отдельно через `--only <фаза>`.

1. **precheck** — проверяет окружение перед основной работой. Если приложение не отвечает или роль не пускают на `/health`, фаза останавливает запуск и выдаёт конкретные подсказки.
2. **research** — два субагента параллельно читают код и техническое задание, отдельный адаптер вытаскивает схему БД (Prisma — нативно, остальные ORM — через `pg_dump --schema-only`), ещё один разбирает локальный OpenAPI/Swagger. Результаты пишутся на диск и кешируются по хешу содержимого.
3. **plan-capture** — превращает декларативный конфиг в детерминированный список снимков: подставляет ID в параметризованные роуты (`/users/:id/edit`), разносит по ролям, вьюпортам, темам, локалям и состояниям (empty / error / permission-denied), добавляет шаги пользовательских сценариев из `journeys.yaml`.
4. **capture** — Playwright выполняет план, группируя снимки по роли × вьюпорту × теме × локали в общую сессию авторизации (API-login по умолчанию, форма как fallback). Перед каждым кадром выполняются заданные действия — клики, заполнение полей, ожидания, закрытие баннеров.
5. **ui-inspection** — каждый PNG отправляется в vision-модель, обратно прилетает JSON с заголовком, хлебными крошками, кнопками, фильтрами, таблицами, модалками. По умолчанию работает через Claude (внутренний Agent-tool), опционально подключается gpt-4o от OpenAI.
6. **generation** — данные из всех предыдущих фаз собираются в структурированный Doc-Model (JSON), затем рендерятся в Markdown с автоматической нумерацией рисунков и таблиц по разделу ("Рисунок 2.3 — …"). Pandoc собирает DOCX по reference-шаблону, python-docx правит таблицы, шрифты, отступы, поле оглавления.
7. **validation** — md-lint ловит остатки шаблонов и битые ссылки, SHA-256 группирует одинаковые скриншоты, формируется `REPORT.md` с покрытием и предупреждениями. На последнем шаге `finalisation` ищет в готовом DOCX забытые блоки `<!-- GEN:* -->` и плейсхолдеры из шаблонов.

## Конфигурация

Файл `docs/meta.yaml` плагин формирует сам — править вручную не нужно. Минимальный пример того, как это в итоге выглядит:

```yaml
skill_version: "1.0.0"
project_path: /path/to/project
spec_path: /path/to/specs           # опционально
doc_types: [user-guide, admin-guide, technical-description]
gost_mode: strict                   # или lite

app:
  url: http://localhost:3000
  launch: docker                    # docker | url | none

auth:
  method: api                       # api | form | none
  storage: auto
  roles:
    - role: guest
      credentials: null
    - role: admin
      api_endpoint: /api/auth/login
      username: admin@example.com
      password: secret
      token_key: access_token
    - role: user
      api_endpoint: /api/auth/login
      username: user@example.com
      password: secret
      token_key: access_token

capture:
  viewports:
    - { name: desktop, width: 1280, height: 800 }
    - { name: mobile,  width: 390,  height: 844 }
  themes: [light, dark]
  locales: [ru, en]

output:
  languages: [ru]
  formats: [docx]

vision:
  provider: claude                  # или openai

metadata:
  organization: "ООО Ромашка"
  system_name: "Платформа Х"
  doc_code: "RU.12345-01 34"
  city: "Москва"
```

Пользовательские сценарии живут в отдельном файле `journeys.yaml` рядом с `meta.yaml` — каждый шаг с `screenshot: true` превращается в кадр в документе.

## Поддерживаемые стеки

Плагин определяет стек автоматически — в том числе в монорепах с раздельными `backend/` и `frontend/`.

- **PHP**: Laravel, Yii2, Symfony
- **Python**: Django, Flask, FastAPI
- **Node.js**: Express, Fastify, NestJS
- **JVM**: Spring Boot
- **Ruby**: Rails
- **Go**: Gin, Echo, Fiber
- **.NET**: ASP.NET Core
- **Elixir**: Phoenix
- **Frontend**: Next.js, Nuxt, SvelteKit, Remix, Astro, Angular, Vue, React

Схема БД извлекается нативно из Prisma; для остальных ORM (Alembic, Django, Knex, TypeORM, Sequelize) плагин предложит запуститься с флагом `--live-db` и получит DDL через `pg_dump --schema-only`.

## Vision-провайдеры

По умолчанию каждый скриншот разбирает Claude через встроенный Agent-tool. Если нужно вынести разбор наружу — можно переключиться на gpt-4o:

```
node skills/gostdocs/scripts/ui-inspector.js --config docs/meta.yaml --vision-provider openai
```

Ключ читается из `OPENAI_API_KEY` и нигде не логируется — ни в выводе, ни в ошибках API.

## Режимы ГОСТ

| | Строгий | Облегчённый |
|---|---|---|
| Шрифт | Times New Roman 14pt | Arial 12pt |
| Поля | 20/10/20/20 мм | 20/10/20/20 мм |
| Интервал | 1.5 | 1.15 |
| Титульный лист | Да, с реквизитами | Нет |
| Нумерация страниц | Внизу справа | Внизу справа |
| Поведение при пустом разделе | Блокирует выпуск | Помечает предупреждением |

Структура разделов в обоих режимах соответствует РД 50-34.698-90.

## Запуск отдельных фаз

Любую фазу можно прогнать в одиночку — это удобно при отладке:

```bash
node skills/gostdocs/scripts/precheck.js     --config docs/meta.yaml
node skills/gostdocs/scripts/research.js     --config docs/meta.yaml
node skills/gostdocs/scripts/plan-capture.js --config docs/meta.yaml
node skills/gostdocs/scripts/capture.js      --config docs/meta.yaml
node skills/gostdocs/scripts/ui-inspector.js --config docs/meta.yaml
node skills/gostdocs/scripts/generate.js     --config docs/meta.yaml --only user-guide
node skills/gostdocs/scripts/finalize.js     --config docs/meta.yaml
```

Полезные флаги, общие для всех скриптов:

| Флаг | Что делает |
|---|---|
| `--yes` | Берёт ответы из meta.yaml без переспрашивания |
| `--only <doc>` | Сгенерировать только один документ |
| `--skip-screenshots` | Использовать уже снятые скриншоты |
| `--rerun-screenshots <role>` | Переснять только указанную роль |
| `--dry-run` | Показать, что будет сделано, без записи на диск |
| `--live-db` | Дать команду на `pg_dump --schema-only` для извлечения схемы БД |
| `--vision-provider claude\|openai` | Выбрать vision-провайдера |
| `--lang ru,en` | Несколько языков на выходе |

## Кастомизация стилей

Стили DOCX задаются файлами `templates/reference-strict.docx` и `templates/reference-lite.docx`. Их можно отредактировать вручную в Word (стили Heading 1–4, Normal, Caption) или пересобрать скриптом:

```bash
cd skills/gostdocs
python3 scripts/setup-reference-docx.py templates/
```

## Обновление

Через маркетплейс:

```
/plugin update gostdocs
```

Ручная установка — `git pull` и повторное копирование. Симлинк — достаточно `git pull`.

## Структура репозитория

```
gostdocs/
├── skills/gostdocs/
│   ├── SKILL.md                    # оркестратор скилла
│   ├── package.json                # runtime-зависимости sandbox
│   ├── templates/
│   │   ├── gost-strict/            # md-шаблоны строгого ГОСТ
│   │   ├── gost-lite/              # md-шаблоны облегчённого ГОСТ
│   │   ├── reference-strict.docx   # стили DOCX для строгого режима
│   │   └── reference-lite.docx     # стили DOCX для облегчённого режима
│   └── scripts/
│       ├── bootstrap.js            # установка sandbox при первом запуске
│       ├── precheck.js             # фаза 1
│       ├── research.js             # фаза 2
│       ├── plan-capture.js         # фаза 3a
│       ├── capture.js              # фаза 3b
│       ├── ui-inspector.js         # фаза 4
│       ├── generate.js             # фаза 6
│       ├── finalize.js             # фаза 7.5
│       ├── postprocess-docx.py     # постпроцессинг DOCX
│       ├── lib/                    # общие модули (meta, doc-model, render, …)
│       └── adapters/               # стек-агностичные адаптеры (auth, schema, vision, …)
├── tests/                          # jest + pytest
├── package.json
├── CHANGELOG.md
├── LICENSE
└── README.md
```

## Лицензия

MIT

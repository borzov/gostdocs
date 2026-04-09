# gen-docs

Плагин для Claude Code, автоматически генерирующий формальную документацию для информационных систем по российским стандартам ГОСТ.

## Возможности

- **4 типа документов**: Руководство пользователя, Руководство администратора, Руководство оператора, Техническое описание
- **Соответствие ГОСТ**: РД 50-34.698-90, ГОСТ 34.201-89, ГОСТ Р 59795-2021, ГОСТ 2.105-95
- **Два режима**: Строгий ГОСТ (титульный лист, рамки, поля) и облегчённый (структура ГОСТ, упрощённое оформление)
- **Автоматические скриншоты**: Playwright обходит работающее приложение и делает скриншоты интерфейса
- **Анализ кодовой базы**: Субагенты извлекают архитектуру, API, конфигурацию, БД из кода
- **Анализ ТЗ/спецификаций**: Чтение .md, .docx, .pdf документов
- **Выходные форматы**: Markdown (исходник в репозитории) + DOCX (через pandoc)
- **Повторная генерация**: Параметры сохраняются в `meta.yaml` для быстрого перезапуска

## Установка

### Вариант 1: Через маркетплейс Claude Code (рекомендуется)

После публикации репозитория на GitHub:

```bash
# Добавить маркетплейс (один раз)
# В ~/.claude/settings.json добавить в extraKnownMarketplaces:
# "gen-docs-marketplace": { "source": { "source": "github", "repo": "YOUR_USERNAME/gen-docs" } }

# Установить плагин
/plugin install gen-docs@gen-docs-marketplace
```

### Вариант 2: Ручная установка

```bash
# Клонировать репозиторий
git clone https://github.com/YOUR_USERNAME/gen-docs.git

# Скопировать скилл в Claude Code
cp -R gen-docs/skills/gen-docs ~/.claude/skills/gen-docs
```

### Вариант 3: Симлинк (для разработки)

```bash
git clone https://github.com/YOUR_USERNAME/gen-docs.git ~/Develop/gen-docs
ln -s ~/Develop/gen-docs/skills/gen-docs ~/.claude/skills/gen-docs
```

## Зависимости

Перед использованием убедитесь, что установлены:

```bash
# pandoc — конвертация Markdown → DOCX
brew install pandoc

# Playwright — автоматические скриншоты
npm install -g @playwright/test
npx playwright install chromium

# python-docx — генерация reference.docx (опционально, для кастомизации стилей)
pip3 install python-docx

# poppler — чтение PDF-спецификаций (опционально)
brew install poppler

# Docker — для запуска приложений перед скриншотами
# https://www.docker.com/products/docker-desktop/
```

## Использование

### Запуск через слеш-команду

В Claude Code откройте проект и введите:

```
/gen-docs
```

Скилл интерактивно спросит:
1. Какие документы генерировать
2. Режим ГОСТ (строгий / облегчённый)
3. Путь к кодовой базе
4. Путь к ТЗ/спецификациям
5. URL приложения для скриншотов (или запуск через Docker)
6. Метаданные для титульного листа (строгий режим)

### Запуск через чат

```
Сгенерируй руководство пользователя для этого проекта
```

Claude Code автоматически подхватит скилл gen-docs.

### Результат

```
docs/
├── generated/              # Исходники Markdown
│   ├── user-guide.md
│   ├── admin-guide.md
│   ├── operator-guide.md
│   └── technical-description.md
├── screenshots/            # Скриншоты Playwright
│   ├── *.png
│   └── manifest.json
├── output/                 # Финальные DOCX
│   ├── user_guide.docx
│   ├── admin_guide.docx
│   └── ...
└── meta.yaml               # Параметры для повторного запуска
```

## Архитектура

```
/gen-docs (скилл-оркестратор)
    │
    ├─ Фаза 1: Сбор параметров (AskUserQuestion)
    │
    ├─ Фаза 2a: Исследование (параллельные субагенты)
    │   ├─ doc-researcher  → код, конфиги, Docker
    │   └─ spec-reader     → ТЗ и спецификации
    │
    ├─ Фаза 2b: Скриншоты (после doc-researcher)
    │   └─ screenshotter   → Playwright
    │
    ├─ Фаза 3: Генерация Markdown по шаблонам ГОСТ
    │
    └─ Фаза 4: Конвертация → DOCX через pandoc
```

## Структура проекта

```
gen-docs/
├── skills/
│   └── gen-docs/
│       ├── SKILL.md                    # Главный скилл-оркестратор
│       ├── templates/
│       │   ├── gost-strict/            # Строгий ГОСТ
│       │   │   ├── user-guide.md
│       │   │   ├── admin-guide.md
│       │   │   ├── operator-guide.md
│       │   │   ├── technical-description.md
│       │   │   └── title-page.md
│       │   ├── gost-lite/              # Облегчённый ГОСТ
│       │   │   ├── user-guide.md
│       │   │   ├── admin-guide.md
│       │   │   ├── operator-guide.md
│       │   │   └── technical-description.md
│       │   ├── reference-strict.docx   # Стили DOCX (Times New Roman 14pt)
│       │   └── reference-lite.docx     # Стили DOCX (Arial 12pt)
│       └── scripts/
│           ├── screenshot.js           # Playwright-скриншоты
│           └── setup-reference-docx.py # Генерация reference.docx
├── package.json
├── LICENSE
└── README.md
```

## Стандарты ГОСТ

| Стандарт | Назначение |
|----------|-----------|
| РД 50-34.698-90 | Структура разделов документации АС |
| ГОСТ 34.201-89 | Виды и номенклатура документов АС |
| ГОСТ Р 59795-2021 | Современные требования к содержанию документов |
| ГОСТ 2.105-95 / ГОСТ Р 2.105-2019 | Оформление: шрифты, поля, нумерация |

### Строгий режим (ГОСТ 2.105)

- Шрифт: Times New Roman 14pt (12pt для таблиц)
- Поля: левое 20мм, правое 10мм, верхнее 20мм, нижнее 20мм
- Межстрочный интервал: 1.5
- Нумерация страниц: внизу справа
- Титульный лист с реквизитами организации

### Облегчённый режим

- Шрифт: Arial 12pt
- Те же поля
- Интервал: 1.15
- Без титульного листа с рамками

## Кастомизация

### Изменение стилей DOCX

```bash
# Пересоздать reference.docx с другими стилями
cd skills/gen-docs
python3 scripts/setup-reference-docx.py templates/
```

Или отредактируйте `templates/reference-strict.docx` вручную в Word, изменив стили Heading 1–4, Normal, Caption.

### Добавление нового типа документа

1. Создайте шаблон в `templates/gost-strict/` и `templates/gost-lite/`
2. Добавьте тип в секцию Phase 1 в `SKILL.md`

## Обновление

### При установке через маркетплейс

```
/plugin update gen-docs
```

### При ручной установке

```bash
cd ~/path/to/gen-docs
git pull
cp -R skills/gen-docs ~/.claude/skills/gen-docs
```

### При симлинке

```bash
cd ~/Develop/gen-docs
git pull
# Обновление автоматическое через симлинк
```

## Лицензия

MIT

# gen-docs v0.3 — остаточные задачи

Документ фиксирует три незакрытые фазы и служит входом для новой рабочей
сессии. Весь фундамент (Phase 1 – 8A) уже в `main`: 13 коммитов,
447/447 jest-тестов зелёных. Модули-строительные-блоки готовы — нужна
интеграция.

## Предусловия для любой задачи

- Node 18.17+, npm
- `node skills/gen-docs/scripts/bootstrap.js` — sandbox готов (первый прогон ~2 мин, далее idempotent)
- `npm test` — все тесты остаются зелёными после любых изменений
- Не добавлять новые runtime-зависимости без согласования: sandbox
  зафиксирован на `playwright@1.59.1`, `zod@3.23.8`, `yaml@2.6.1`
- Политики из `CLAUDE.md`: ответы пользователю на русском, код на
  английском, дочерние процессы — только через `spawn` без shell

## Приоритеты

| № | Фаза | Значение |
|---|---|---|
| 1 | **Phase 6C** generate.js | Без неё пайплайн не доезжает до DOCX |
| 2 | **Phase 7B** docx-валидатор + report CLI | Пользователь не видит проблем в результате |
| 3 | **Phase 8B** мульти-язык + постпроцесс | UX-полиш |

Рекомендуется сначала 6C, затем пилотный прогон на реальном проекте,
потом 7B и 8B — реальные дефекты могут изменить приоритеты.

---

## Задача 1 — Phase 6C: generate.js оркестратор

### Цель

Связать модули Phase 1–6B в единый пайплайн Markdown-генерации:
research + inspection + manifest + journeys + security + mermaid →
Doc-Model → Markdown с прогоном через md-lint.

### Deliverables

- `skills/gen-docs/scripts/generate.js` — CLI-entry
- `skills/gen-docs/scripts/lib/template-loader.js` — парсер старых
  шаблонов в skeleton Doc-Model (переходный слой)
- Обновлённые шаблоны (если принято решение полностью переехать
  в Doc-Model-YAML) — опционально на этой фазе
- Интеграционные тесты

### Вход (всё уже существует)

- `docs/meta.yaml` — через `scripts/lib/meta.load(configPath)`
- `docs/screenshots/manifest.json` — через `scripts/lib/manifest.read`
- `docs/generated/_research/*.summary.json` + `coverage.json` — через
  `scripts/lib/research-result.readSummary` и `scripts/research.runResearch`
- `docs/generated/_inspection/**.json` — через
  `scripts/lib/inspection-store.listAll`
- `journeys.yaml` — через `scripts/lib/journeys.load(path)`
- `skills/gen-docs/templates/gost-{strict|lite}/{doc-type}.md`

### Алгоритм

1. Загрузить meta через `lib/meta.load` (auto-migration + валидация).
2. Прогнать `research.runResearch` если `coverage.json` отсутствует или
   устарел (по sha-хешу источников через `lib/cache`).
3. Загрузить manifest, inspections, journeys.
4. Для каждого `doc-type` из `meta.doc_types`:
   1. Загрузить шаблон через `template-loader` → skeleton Doc-Model.
   2. Построить финальный Doc-Model:
      - метаданные → frontmatter (с учётом `metadata-autofill.mergeMetadata`)
      - разделы из research через соответствующие секции
      - для каждой страницы — элемент `page-description` из
        `inspection-store` (см. «Чек-лист страниц» ниже)
      - `renderJourneysSection` для journeys, подходящих под роль doc-type
      - Mermaid-блоки через `adapters/mermaid.renderToDocModelElement`
      - `security-recommendations.buildSection(docType)` как
        последний топ-уровневый раздел
   3. Применить `nfr-policy.applyNfrPolicy(coverage, meta.gost_mode, {lang})`
      — директивы вставить как placeholder-элементы, блокеры собрать.
   4. `doc-model.validate(doc)` — падаем на схеме если что-то сломано.
   5. Отрендерить в Markdown через `doc-model-md.render(doc)`.
   6. Запустить `md-lint.lintMarkdown` с `manifestFiles` = список файлов
      manifest, `excluded` = из meta если появится такое поле.
   7. **Strict mode + errors>0 → прервать с non-zero exit**.
   8. Записать `docs/generated/<doc-type>.md`.
5. Если из NFR пришли `blockers[]` и mode=strict — exit 1.
6. Сложить сводку в stdout:
   `[generate] N docs written, M warnings, K blockers`.

### «Чек-лист страниц» (требование ревью 3.1)

В Doc-Model ввести новый element-тип (расширить `doc-model.js`):

```yaml
type: page-description
page_id: string
title: string
file: string          # manifest file path
checklist:
  - { label: breadcrumb,    filled: bool, value: string|null, source: inspection|manual }
  - { label: heading,       filled: bool, value: string|null, source: ... }
  - { label: top_buttons,   filled: bool, count: number,      source: ... }
  - { label: filters,       filled: bool, count: number,      source: ... }
  - { label: columns,       filled: bool, count: number,      source: ... }
  - { label: row_actions,   filled: bool, count: number,      source: ... }
  - { label: bulk_actions,  filled: bool, count: number,      source: ... }
  - { label: pagination,    filled: bool, value: bool,        source: ... }
  - { label: empty_state,   filled: bool,                     source: ... }
  - { label: modals,        filled: bool, count: number,      source: ... }
```

Заполнение — из соответствующего inspection JSON. Рендер — отдельная
секция с чеклистом + figure + короткое описание. Валидатор (в рамках
`md-lint` или новой функции) считает «закрыто M из N пунктов на N_pages».

### Шаблоны — два варианта

**(A) Полный переезд в Doc-Model-YAML**
Шаблоны превращаются в YAML-структуру секций. Чище, но требует
переписать все 8 шаблонов (4 doc-type × 2 mode). Подходит, если
Phase 6C делается в одной сессии с запасом времени.

**(B) Переходный `template-loader`** _(рекомендуется для первой итерации)_
`lib/template-loader.js` парсит существующий Markdown с
`<!-- AGENT: ... -->` комментариями в skeleton Doc-Model: каждый H1/H2
становится секцией, комментарии — placeholder paragraph-ами, которые
generate.js заменяет на контент из research. Старые шаблоны остаются
как есть; переезд в YAML делается в следующей итерации по мере
необходимости.

### Тесты

- `tests/template-loader.test.js` — парсинг фикстурных шаблонов в
  skeleton Doc-Model
- `tests/generate.test.js` — интеграция на tmp-проекте с фейковыми
  manifest / inspections / research. Ожидаемый выход: один или
  несколько `*.md` файлов, каждый проходит `md-lint`, содержит
  security-раздел и journey-раздел (если применимо)
- Расширить `tests/doc-model.test.js` новым element-типом
  `page-description`

### Acceptance

- `node skills/gen-docs/scripts/generate.js --config docs/meta.yaml`
  создаёт `docs/generated/*.md`
- `--only user-guide` генерирует только один документ
- `--dry-run` печатает план, ничего не пишет
- В strict mode: AGENT:/TODO/XXX/плейсхолдер или NFR-блокер → exit 1
- Security-раздел присутствует в каждом сгенерированном документе
- Mermaid-блоки отрендерены в PNG (если `mmdc` доступен) или
  оставлены как fenced-код с предупреждением в stdout

---

## Задача 2 — Phase 7B: DOCX-валидатор + report CLI

### Цель

Финальная проверка сгенерированного DOCX на соответствие ГОСТ и
сборка единого `REPORT.md` пользователю.

### Deliverables

- `skills/gen-docs/scripts/validators/docx.py` — python-docx +
  OpenXML-валидатор
- `skills/gen-docs/scripts/report.js` — CLI-обёртка над
  `scripts/lib/report.buildReport`
- Тесты: pytest для Python, jest для report.js
- (опционально) `scripts/lib/phash.js` — perceptual hash через `sharp`
  для поиска почти-дубликатов. Если sharp тяжёл — отложить.

### DOCX-валидатор (Python)

Зависимости: `python-docx` (уже в README); `lxml` идёт с python-docx
транзитивно, этого хватает на OpenXML.

Проверки (по `gost_mode`):

**strict (все блокирующие):**
- Поля: 20/10/20/20 мм (± 1 мм)
- Шрифт: Times New Roman 14pt (12pt в таблицах)
- Межстрочный интервал: 1.5
- Титульный лист (первая страница содержит реквизиты из metadata)
- Штамп (frame на титульной странице)
- Нумерация страниц внизу справа
- Заголовки H1–H4 bold
- Bold header row в каждой таблице
- Структура разделов соответствует РД 50-34.698-90 для конкретного
  doc-type (проверка по списку заголовков)

**lite (всё warning):**
- Шрифт Arial 12pt
- Межстрочный интервал 1.15
- Остальные поля как в strict
- Без титульного и штампа

### Интерфейс

```
python3 skills/gen-docs/scripts/validators/docx.py \
  --doc docs/output/user-guide.docx \
  --mode strict \
  --doc-type user-guide \
  --output docs/generated/_validation/user-guide.json
```

Выход — JSON:
```json
{
  "passed": false,
  "doc": "docs/output/user-guide.docx",
  "mode": "strict",
  "doc_type": "user-guide",
  "checks": [
    { "name": "margins", "passed": true, "detail": "20/10/20/20" },
    { "name": "title_page", "passed": false, "detail": "not found",
      "remediation": "wrap strict-mode template around the document" }
  ]
}
```

Exit code: 0 если `passed=true`, иначе 1.

### report.js CLI

Агрегирует все артефакты:

1. Прочитать `docs/screenshots/manifest.json` через `lib/manifest.read`.
2. Прочитать `docs/generated/_research/coverage.json`.
3. Пройти `docs/generated/_inspection/` через `lib/inspection-store.listAll`.
4. Для каждого `docs/generated/*.md` — `lib/md-lint.lintMarkdown`.
5. `lib/file-hash.detectDuplicates` на всех PNG из manifest.
6. Сканировать `docs/output/*.docx` → список документов (имя, размер,
   опционально число страниц через python-docx в side-вызове).
7. Если `docs/generated/_validation/*.json` существуют — добавить в
   секцию «DOCX validation».
8. `lib/report.buildReport(...)` → запись в `docs/REPORT.md`.
9. Exit code non-zero в strict mode при наличии NFR-блокеров или
   DOCX-валидатор-блокеров.

### Тесты

- `tests/report-cli.test.js` — собирает tmp-проект со всеми
  артефактами, вызывает runReport, сверяет содержимое REPORT.md
- `tests/validators/test_docx.py` — pytest с двумя фикстурными DOCX:
  один соответствует strict-ГОСТ, другой намеренно сломан в полях и
  шрифте
- (опционально) `tests/phash.test.js` если sharp добавлен

### Acceptance

- `node skills/gen-docs/scripts/report.js --config docs/meta.yaml`
  пишет `docs/REPORT.md`
- Strict mode блокирует publish при отклонениях ГОСТ-формата или
  незаполненных чеклистах
- Lite mode — только warning, publish проходит
- REPORT.md покрывает всё что нужно править: документы, покрытие ролей,
  блокеры, предупреждения, подозрительные снимки, дубликаты, AI-MD
  в источниках, md-lint-ошибки, DOCX-валидатор

---

## Задача 3 — Phase 8B: мульти-язык + постпроцессор DOCX

### Цель

Генерировать DOCX на нескольких языках из одного Doc-Model с
общим глоссарием; сделать постпроцессор прозрачным с `--dry-run`.

### Deliverables

- `skills/gen-docs/scripts/lib/doc-model-translate.js` — перевод
  JSON-структуры с сохранением shape
- `skills/gen-docs/scripts/adapters/translator/{claude,openai}.js`
- `skills/gen-docs/scripts/postprocess.js` (новая Node-обёртка) или
  переработанный `scripts/postprocess-docx.py` с флагами
- Опциональный `_glossary.yaml` в корне пользовательского проекта
- Тесты

### Перевод Doc-Model

Входы:

- Базовый Doc-Model (lang=ru, сгенерирован Phase 6C)
- `meta.output.languages` — список target-языков
- Опциональный `<project>/_glossary.yaml` вида:
  ```yaml
  version: "1.0"
  terms:
    - ru: "пользователь"
      en: "user"
    - ru: "администратор"
      en: "administrator"
  ```

Алгоритм:

1. Для каждого `target ≠ ru`:
   1. Собрать все переводимые строки из Doc-Model: `title`, `subtitle`,
      `sections[].heading`, `element.text` (paragraph / admonition),
      `element.caption`, `element.headers` + `element.rows`
      (table), `element.items[].label` (checklist-result).
   2. Заранее применить glossary — термины с override-ом идут в промпт
      как «фиксированные соответствия, не переводи иначе».
   3. Batch-перевод через выбранный провайдер:
      - claude (default) — через subagent, SKILL.md описывает контракт
      - openai — через gpt-4o chat API (`adapters/translator/openai.js`)
   4. Вернуть строки в Doc-Model того же shape.
2. Отрендерить каждый target-Doc-Model через `doc-model-md.render` с
   `doc.lang = target`.
3. Сохранить как `docs/generated/<doc-type>.<target>.md`.
4. pandoc-конвертация делается для каждого `.md` отдельно — уже
   работает.

### Постпроцессор DOCX

Текущий `scripts/postprocess-docx.py` (17 KB) применяет фиксы
«за кулисами». Переработать:

- Каждый фикс → класс `Fix` с атрибутами:
  - `name: str` (`table_borders`, `figure_centering`, ...)
  - `required: bool` (must-have vs opt-in)
  - `description: str`
  - `apply(doc) -> List[Change]`
- Флаг `--must-have-only` пропускает `required=False`
- Флаг `--dry-run` печатает список применённых + пропущенных, DOCX
  не пишет
- Лог изменений в `docs/generated/_postprocess.log` построчно:
  `[table 3] added borders`, `[figure 4.1] centered`

Группы фиксов (текущие, переработать):
- tables: bold-header, borders, caption-placement
- figures: centering, caption-placement, alt-text
- lists: numbering, indents
- indents: paragraph-first-line 1.25cm
- headings: numbering strip (должно делать pandoc, но проверить)

### Тесты

- `tests/doc-model-translate.test.js` — перевод с mocked-translator:
  проверка что Doc-Model остаётся валидным, glossary работает,
  формат-элементы (figure/table) не трогаются
- Python-тесты постпроцессора: фикстурный DOCX, каждый фикс
  проверяется изолированно + проверка `--dry-run` не меняет файл
- `tests/postprocess-cli.test.js` если выбран Node-вариант обёртки

### Acceptance

- `output.languages: [ru, en]` → по 2 DOCX на каждый doc-type
- Термины из glossary одинаковы во всех документах одной пары
- `python3 scripts/postprocess.py --dry-run` печатает список
  преобразований без записи файла
- `python3 scripts/postprocess.py --must-have-only` применяет только
  `required=True` фиксы
- `docs/generated/_postprocess.log` читаем и показывает каждое
  изменение

---

## End-to-end acceptance для v0.3 RC

После закрытия всех трёх задач пайплайн должен работать
непрерывно на пилотном проекте:

```
npm run bootstrap
node scripts/precheck.js        --config docs/meta.yaml
node scripts/plan-capture.js    --config docs/meta.yaml
node scripts/capture.js         --config docs/meta.yaml
node scripts/ui-inspector.js    --config docs/meta.yaml
node scripts/research.js        --config docs/meta.yaml
node scripts/generate.js        --config docs/meta.yaml   # Phase 6C
pandoc ... (конвертация в DOCX — существующий шаг)
python3 scripts/postprocess.py --config docs/meta.yaml    # Phase 8B
python3 scripts/validators/docx.py                        # Phase 7B
node scripts/report.js          --config docs/meta.yaml   # Phase 7B
```

В strict-mode любой шаг может прервать пайплайн с конкретной
remediation-подсказкой. В lite-mode предупреждения собираются в
`docs/REPORT.md`, publish не прерывается.

## Навигация по существующему коду

Всё, что может понадобиться остаточным фазам, уже реализовано и
оттестировано:

| Нужно | Где | Экспортирует |
|---|---|---|
| Прочесть meta.yaml | `lib/meta.js` | `load, save, validate, migrate` |
| Запустить precheck | `scripts/precheck.js` | `runPrecheck, formatResult` |
| Получить capture plan | `scripts/plan-capture.js` + `lib/matrix.js` | `runPlanCapture, buildMatrix` |
| Снять скриншоты | `scripts/capture.js` | `runCapture, probeAccess` |
| Прочесть inspection | `lib/inspection-store.js` | `read, listAll, resolveJsonPath` |
| Построить prompt | `lib/inspection-prompt.js` | `buildPrompt` |
| Инспекция через OpenAI | `adapters/vision/openai.js` | `inspect` |
| Aggregated coverage | `lib/research-result.js` | `aggregate, readSummary, writeSummary` |
| NFR-политика | `lib/nfr-policy.js` | `applyNfrPolicy` |
| AI-артефакты | `lib/ai-artifact-filter.js` | `detect, partition` |
| Прочесть схему БД | `adapters/schema/index.js` | `extractSchema` |
| OpenAPI → Markdown | `adapters/openapi.js` | `loadAndNormalise, buildMarkdown` |
| Doc-Model | `lib/doc-model.js` | `newDocument, addSection, addElement, validate` |
| Markdown из Doc-Model | `lib/doc-model-md.js` | `render` |
| Pre-pandoc lint | `lib/md-lint.js` | `lintMarkdown` |
| Mermaid | `adapters/mermaid.js` | `renderToDocModelElement, isAvailable` |
| Security-раздел | `lib/security-recommendations.js` | `buildSection` |
| Journey → Doc-Model | `lib/journey-render.js` | `renderJourneyToDocModel, renderJourneysSection` |
| Manifest v2 | `lib/manifest.js` | `emptyManifest, upsertCapture, read, write, buildFilename` |
| Routes | `lib/routes.js` | `parseRoute, substitute, inferCollectionPath` |
| ID-резолвер | `adapters/id-resolver.js` | `planResolution, extractIdFromBody` |
| Dedupe | `lib/file-hash.js` | `sha256File, detectDuplicates` |
| REPORT.md | `lib/report.js` | `buildReport` |
| Autofill metadata | `lib/metadata-autofill.js` | `deriveMetadata, mergeMetadata` |
| Cache | `lib/cache.js` | `get, set, invalidate, computeHash` |
| CLI-парсер | `lib/cli.js` | `parseArgs, assertConsistent` |

Тестовые шаблоны — в `tests/*.test.js`, паттерн изолированных tmp-директорий
и mocked-fetch/readFile везде одинаковый.

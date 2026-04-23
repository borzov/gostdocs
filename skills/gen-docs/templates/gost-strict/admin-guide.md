---
title: "{system_name}. Руководство администратора"
lang: ru-RU
---

<!-- GOST mode: strict | Template version: 1.1 -->
<!-- Reference: РД 50-34.698-90, ГОСТ Р 59795-2021 -->

# Введение

## Область применения

<!-- AGENT: Describe the scope of this admin guide. State the system name, version, and that this document is intended for system administrators responsible for installation, configuration, and maintenance. Source: spec-reader SYSTEM PURPOSE + doc-researcher SYSTEM OVERVIEW -->

Настоящий документ является руководством администратора автоматизированной системы «{system_name}» версии {version}.

Документ предназначен для системных администраторов, ответственных за установку, настройку, сопровождение и обеспечение бесперебойной работы системы.

Руководство содержит сведения, необходимые для развёртывания системы, управления учётными записями, резервного копирования и восстановления данных.

## Краткое описание системы

<!-- AGENT: Provide a concise technical overview of the system from the administrator's perspective:
1. System purpose (1-2 sentences)
2. Architecture type (monolith, microservices, etc.)
3. Key technology stack components
4. Deployment model (Docker, bare metal, cloud)
Source: doc-researcher SYSTEM OVERVIEW + ARCHITECTURE -->

Система «{system_name}» представляет собой веб-приложение, построенное на базе клиент-серверной архитектуры. Серверная часть обеспечивает обработку бизнес-логики и хранение данных, клиентская часть реализует пользовательский интерфейс в веб-браузере.

# Требования к окружению

## Аппаратные требования

<!-- AGENT: Specify hardware requirements for the server(s) running the system.
Source: doc-researcher DEPLOYMENT, Dockerfile analysis, docker-compose.yml resource limits.
MUST include:
1. CPU (cores, architecture)
2. RAM (minimum and recommended)
3. Disk space (system, database, logs, backups — each separately)
4. Network interface requirements

If the system has multiple services (e.g., app server, database, cache), provide requirements for each separately.
If no explicit requirements found in source, derive reasonable estimates from the technology stack. -->

| Компонент | Минимальные требования | Рекомендуемые требования |
|-----------|----------------------|--------------------------|
| Процессор | 2 ядра, x86_64 | 4 ядра, x86_64 |
| Оперативная память | 4 ГБ | 8 ГБ |
| Дисковое пространство | 20 ГБ (SSD) | 50 ГБ (SSD) |
| Сетевой интерфейс | 100 Мбит/с | 1 Гбит/с |

## Программные требования

<!-- AGENT: List ALL software dependencies needed to run the system.
Source: doc-researcher SYSTEM OVERVIEW, docker-compose.yml, Dockerfile, package.json/requirements.txt.
MUST include:
1. Operating system (with versions)
2. Container runtime (Docker version, Docker Compose version)
3. Database server (with version)
4. Web server / reverse proxy (if applicable)
5. Runtime environment (Node.js, Python, PHP version)
6. Any additional system packages

Present as a table with columns: Software, Minimum Version, Purpose. -->

| Программное обеспечение | Минимальная версия | Назначение |
|------------------------|-------------------|------------|
| Операционная система | Ubuntu 22.04 LTS / Debian 12 | Серверная ОС |
| Docker | 24.0 | Контейнеризация |
| Docker Compose | 2.20 | Оркестрация контейнеров |

<!-- AGENT: Add rows for every dependency discovered in the project -->

# Установка и первоначальная настройка

## Развёртывание системы

<!-- AGENT: Provide COMPLETE deployment instructions from scratch.
Source: doc-researcher DEPLOYMENT + docker-compose.yml analysis.

MUST include:
1. Prerequisites check (Docker, Docker Compose installed)
2. Cloning/downloading the project
3. Environment file setup (.env from .env.example)
4. Building containers
5. Starting services
6. Verifying all services are running

Provide EXACT shell commands. Use code blocks with bash syntax highlighting.
Include expected output for verification commands.

Example format:
```bash
# Clone the repository
git clone {repo_url}
cd {project_dir}

# Copy environment configuration
cp .env.example .env

# Edit environment variables
nano .env

# Build and start services
docker compose up -d --build

# Verify all services are running
docker compose ps
```
-->

Для развёртывания системы выполните следующие действия:

```bash
# 1. Клонирование репозитория
git clone {repo_url}
cd {project_dir}

# 2. Настройка переменных окружения
cp .env.example .env
# Отредактируйте файл .env (см. раздел «Конфигурация»)

# 3. Сборка и запуск
docker compose up -d --build

# 4. Проверка статуса контейнеров
docker compose ps
```

## Конфигурация

<!-- AGENT: Document EVERY configuration parameter from .env.example.
Source: doc-researcher CONFIGURATION.

For EACH parameter provide:
1. Parameter name (exact env variable name)
2. Description in Russian
3. Default value
4. Valid values or format (range, regex, enum)
5. Whether it is required or optional
6. Security notes (if the parameter contains secrets)

Present as a table. Group parameters by category (database, application, mail, etc.).
Mark secrets with ⚠ and note that they must be changed from defaults. -->

### Параметры подключения к базе данных

| Параметр | Описание | Значение по умолчанию | Допустимые значения | Обязательный |
|----------|----------|----------------------|---------------------|-------------|
| `DB_HOST` | Адрес сервера базы данных | `db` | Имя хоста или IP-адрес | Да |
| `DB_PORT` | Порт базы данных | `5432` | 1–65535 | Да |
| `DB_NAME` | Имя базы данных | `app` | Строка без спецсимволов | Да |
| `DB_USER` | Пользователь базы данных | `app` | Строка | Да |
| `DB_PASSWORD` | Пароль базы данных ⚠ | — | Строка не менее 12 символов | Да |

<!-- AGENT: Continue with additional parameter groups:
- Application settings (APP_PORT, APP_SECRET, APP_DEBUG, etc.)
- Email/SMTP settings
- External service credentials
- Logging configuration
- Any other parameters found in .env.example -->

### Параметры приложения

| Параметр | Описание | Значение по умолчанию | Допустимые значения | Обязательный |
|----------|----------|----------------------|---------------------|-------------|
| `APP_PORT` | Порт веб-приложения | `3000` | 1–65535 | Да |
| `APP_SECRET` | Секретный ключ приложения ⚠ | — | Строка не менее 32 символов | Да |
| `APP_ENV` | Режим работы | `production` | `development`, `production` | Да |

## Инициализация базы данных

<!-- AGENT: Describe database initialization steps.
Source: doc-researcher DEPLOYMENT + DATABASE.
MUST include:
1. Running migrations (exact commands)
2. Seeding initial data (admin user, reference data)
3. Verifying database state
4. Default admin credentials (with WARNING to change immediately)

Provide exact shell commands. -->

После запуска контейнеров выполните инициализацию базы данных:

```bash
# Выполнение миграций
docker compose exec {service_name} {migration_command}

# Создание начальных данных
docker compose exec {service_name} {seed_command}
```

**Внимание!** После инициализации в системе создаётся учётная запись администратора по умолчанию. Незамедлительно измените пароль при первом входе.

## Проверка работоспособности

<!-- AGENT: Describe how to verify that the deployed system works correctly.
Source: doc-researcher DEPLOYMENT + ROUTES.
MUST include:
1. Health check endpoint (URL and expected response)
2. Accessing the web interface (URL)
3. Logging in as admin
4. Checking each service status (database connectivity, cache, etc.)
5. Checking application logs for errors

Provide exact commands and expected output. -->

Для проверки работоспособности выполните следующие действия:

1. Проверьте доступность системы:

```bash
curl -f http://localhost:{port}/health
# Ожидаемый ответ: {"status":"ok"}
```

2. Откройте веб-интерфейс в браузере: `http://localhost:{port}`.

3. Выполните вход с учётными данными администратора.

4. Проверьте журнал приложения на наличие ошибок:

```bash
docker compose logs --tail=50 app
```

# Управление пользователями и правами доступа

<!-- AGENT: Comprehensive user and access management guide.
Source: doc-researcher AUTH + FEATURES.
MUST include:
1. User creation (via UI and/or CLI/API)
2. Role assignment and available roles (list all roles with their permissions)
3. Password policy configuration
4. Account deactivation/deletion
5. Bulk user operations if available
6. LDAP/SSO integration if applicable

For each operation provide step-by-step instructions. -->

## Роли и права доступа

<!-- AGENT: Create a permission matrix table:
Rows = operations/features, Columns = roles.
Mark with ✓ (allowed) or — (denied).
Source: doc-researcher AUTH (role definitions, guards, middleware) -->

| Функция | Пользователь | Администратор |
|---------|:------------:|:-------------:|
| Просмотр данных | ✓ | ✓ |
| Редактирование данных | ✓ | ✓ |
| Управление пользователями | — | ✓ |
| Настройка системы | — | ✓ |

## Создание учётной записи

Для создания новой учётной записи пользователя:

1. Перейдите в раздел «Администрирование» → «Пользователи».

2. Нажмите кнопку «Создать пользователя».

3. Заполните обязательные поля формы.

4. Назначьте роль.

5. Нажмите «Сохранить».

## Блокировка и удаление учётных записей

<!-- AGENT: Describe account deactivation and deletion procedures.
Note the difference: deactivation preserves data, deletion may be irreversible. -->

# Резервное копирование и восстановление

## Резервное копирование базы данных

<!-- AGENT: Provide exact backup commands for the database used in the project.
Source: doc-researcher DATABASE + DEPLOYMENT.
MUST include:
1. Manual backup command
2. Automated backup setup (cron job example)
3. Backup file naming convention (include date)
4. Backup storage recommendations
5. Backup retention policy recommendation

Adapt commands to the actual database engine (PostgreSQL, MySQL, MongoDB, etc.) -->

```bash
# Ручное резервное копирование базы данных
docker compose exec db pg_dump -U {db_user} {db_name} > backup_$(date +%Y%m%d_%H%M%S).sql
```

Рекомендуется настроить автоматическое резервное копирование с помощью cron:

```bash
# Ежедневное резервное копирование в 02:00
0 2 * * * docker compose -f /path/to/docker-compose.yml exec -T db pg_dump -U {db_user} {db_name} | gzip > /backups/{system_name}_$(date +\%Y\%m\%d).sql.gz
```

## Резервное копирование файлов конфигурации

<!-- AGENT: List all configuration files and directories that must be backed up.
Include: .env, docker-compose.yml, nginx configs, SSL certificates, uploaded files directory. -->

## Восстановление из резервной копии

<!-- AGENT: Step-by-step restore procedure.
MUST include:
1. Stopping the application
2. Restoring the database
3. Restoring configuration files
4. Restarting services
5. Verification after restore -->

```bash
# Остановка приложения
docker compose down

# Восстановление базы данных
cat backup_file.sql | docker compose exec -T db psql -U {db_user} {db_name}

# Запуск приложения
docker compose up -d

# Проверка работоспособности
docker compose ps
```

# Мониторинг и журналирование

## Просмотр журналов

<!-- AGENT: Describe all log sources and how to access them.
Source: doc-researcher analysis of logging configuration.
MUST include:
1. Application logs (location, format, rotation)
2. Web server logs (access, error)
3. Database logs
4. Container logs
5. How to filter logs by severity, date, component -->

```bash
# Просмотр журналов всех контейнеров
docker compose logs -f

# Просмотр журналов конкретного сервиса
docker compose logs -f {service_name}

# Просмотр журналов за последний час
docker compose logs --since 1h {service_name}
```

## Мониторинг состояния

<!-- AGENT: Describe monitoring endpoints, metrics, and what to watch for.
Include: health check endpoints, resource utilization monitoring, alerting recommendations. -->

## Журнал действий пользователей

<!-- AGENT: If the system has an audit log, describe:
1. What actions are logged
2. Where audit logs are stored
3. How to search and filter audit logs
4. Retention policy
Source: doc-researcher FEATURES (audit/logging features) -->

# Обновление системы

<!-- AGENT: Provide a complete update procedure.
Source: doc-researcher DEPLOYMENT.
MUST include:
1. Pre-update checklist (backup, notify users, maintenance window)
2. Pulling new version
3. Running migrations
4. Restarting services
5. Post-update verification
6. Rollback procedure if update fails -->

Для обновления системы до новой версии выполните следующие действия:

## Подготовка к обновлению

1. Создайте резервную копию базы данных (см. раздел «Резервное копирование базы данных»).

2. Создайте резервную копию файлов конфигурации (см. раздел «Резервное копирование файлов конфигурации»).

3. Уведомите пользователей о плановых работах.

## Выполнение обновления

```bash
# Получение новой версии
cd {project_dir}
git pull origin main

# Пересборка и перезапуск контейнеров
docker compose down
docker compose up -d --build

# Выполнение миграций
docker compose exec {service_name} {migration_command}
```

## Проверка после обновления

Выполните проверку работоспособности в соответствии с разделом «Проверка работоспособности».

## Откат обновления

В случае обнаружения критических ошибок после обновления:

1. Остановите контейнеры: `docker compose down`.

2. Верните предыдущую версию кода.

3. Восстановите базу данных из резервной копии (см. раздел «Восстановление из резервной копии»).

4. Запустите контейнеры: `docker compose up -d`.

# Устранение неполадок

<!-- AGENT: Create a comprehensive troubleshooting guide for administrators.
Source: doc-researcher code analysis, common issues with the technology stack.
MUST include a table with:
1. Problem symptom
2. Possible cause
3. Diagnostic commands
4. Solution steps

Cover at least these categories:
- Container startup failures
- Database connection issues
- Application errors (500, OOM, etc.)
- Authentication/authorization failures
- Performance degradation
- Disk space issues
- SSL/TLS certificate problems -->

| № | Проблема | Возможная причина | Диагностика | Решение |
|---|---------|-------------------|-------------|---------|
| 1 | Контейнер не запускается | Ошибка конфигурации | `docker compose logs {service_name}` | Проверить переменные окружения в `.env` |
| 2 | Ошибка подключения к БД | Некорректные параметры подключения | `docker compose exec {service_name} ping {db_host}` | Проверить `DB_HOST`, `DB_PORT`, `DB_PASSWORD` |
| 3 | Ошибка 502 Bad Gateway | Приложение не отвечает | `docker compose ps` | Перезапустить контейнер: `docker compose restart {service_name}` |
| 4 | Медленная работа | Нехватка ресурсов | `docker stats` | Увеличить ресурсы сервера или оптимизировать конфигурацию |
| 5 | Нет свободного места | Переполнение диска | `df -h` | Очистить старые журналы и резервные копии |

# Административные экраны системы

<!-- GEN:page-description role="admin" -->


# {system_name}

## Руководство администратора

**Версия:** {version}

---

<!-- GOST mode: lite | Template version: 1.0 -->
<!-- Based on: РД 50-34.698-90 section structure -->
<!-- Formatting: relaxed — no title page, no document code, no stamp frames. -->
<!-- Section structure follows GOST strictly; presentation is simplified. -->

## 1 Введение

### 1.1 Область применения
<!-- AGENT: Describe scope of admin guide. Source: spec-reader SYSTEM PURPOSE -->

### 1.2 Краткое описание системы
<!-- AGENT: System overview from admin perspective. Source: doc-researcher SYSTEM OVERVIEW -->

## 2 Требования к окружению

### 2.1 Аппаратные требования
<!-- AGENT: CPU, RAM, disk. Source: doc-researcher DEPLOYMENT -->

### 2.2 Программные требования
<!-- AGENT: OS, Docker, dependencies. Source: doc-researcher SYSTEM OVERVIEW -->

## 3 Установка и первоначальная настройка

### 3.1 Развёртывание системы
<!-- AGENT: Docker Compose instructions with actual commands -->

### 3.2 Конфигурация
<!-- AGENT: ALL .env parameters in table format: | Параметр | Описание | Значение по умолчанию | Обязательный | -->

### 3.3 Инициализация базы данных
<!-- AGENT: Migration/seed commands -->

### 3.4 Проверка работоспособности
<!-- AGENT: Health check verification -->

## 4 Управление пользователями и правами доступа
<!-- AGENT: User/role management procedures. Source: doc-researcher AUTH + spec-reader USER ROLES -->

## 5 Резервное копирование и восстановление
<!-- AGENT: Backup and restore procedures. Include schedule recommendations and commands. -->

## 6 Мониторинг и журналирование
<!-- AGENT: Logs location, monitoring endpoints, alerting setup. Source: doc-researcher DEPLOYMENT -->

## 7 Обновление системы
<!-- AGENT: Update procedure: pull, migrate, restart. Include rollback steps. -->

## 8 Устранение неполадок
<!-- AGENT: Common issues table: | Проблема | Возможная причина | Решение | -->

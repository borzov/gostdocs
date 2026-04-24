---
title: "{system_name}. Техническое описание"
lang: ru-RU
---

<!-- GOST mode: lite | Template version: 1.0 -->
<!-- Based on: РД 50-34.698-90 section structure -->
<!-- Formatting: relaxed — no title page, no document code, no stamp frames. -->
<!-- Section structure follows GOST strictly; presentation is simplified. -->

# Общие сведения

## Наименование и назначение
<!-- AGENT: Full system name and purpose. Source: spec-reader SYSTEM PURPOSE -->

## Перечень используемых технологий
<!-- AGENT: Technology stack table: | Компонент | Технология | Версия |
Source: doc-researcher SYSTEM OVERVIEW -->

# Архитектура системы

## Общая схема
<!-- AGENT: Architecture diagram (Mermaid). Source: doc-researcher SYSTEM OVERVIEW -->

## Описание компонентов
<!-- AGENT: Each component: purpose, technology, responsibilities.
Source: doc-researcher SYSTEM OVERVIEW + DEPLOYMENT -->

## Взаимодействие компонентов
<!-- AGENT: Communication protocols, message formats, data flow.
Source: doc-researcher ROUTES + SYSTEM OVERVIEW -->

# Структура данных

## Описание базы данных
<!-- AGENT: Database type, schema overview, ER diagram (Mermaid).
Source: doc-researcher DATABASE -->

## Основные сущности
<!-- AGENT: Entity table per model: | Поле | Тип | Описание | Ограничения |
Source: doc-researcher DATABASE -->

# Описание API
<!-- AGENT: Endpoints table: | Метод | URL | Описание | Авторизация |
Source: doc-researcher ROUTES + AUTH -->

# Архитектура

<!-- GEN:mermaid source="architecture" title="Общая архитектура системы" -->

# Структура базы данных

<!-- GEN:db-schema scope="all" headingLevel="3" -->

# Масштабирование и отказоустойчивость
<!-- AGENT: Scaling strategy, HA approach, load balancing, replication.
Source: doc-researcher DEPLOYMENT + spec-reader NON-FUNCTIONAL REQUIREMENTS -->


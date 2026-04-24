---
title: "{system_name}. Описание архитектуры"
lang: ru-RU
---

<!-- GOST mode: strict | Template version: 2.0 -->
<!-- Reference: РД 50-34.698-90, ГОСТ 34.602-2020, ГОСТ 34.601-90 -->

<!-- AGENT: This is the DIAGRAM-CENTRIC companion to technical-description.
Rules:
  1. Do NOT duplicate data that lives in technical-description. Specifically
     do not emit tech-stack-table, protocols-table, tech-components,
     full db-schema, tech-security, or tech-scaling — they belong there.
  2. Every major architectural statement is backed by a diagram. Prose
     around diagrams explains trade-offs and operational implications.
  3. Cross-reference technical-description with a plain phrase
     ("детали см. в техническом описании, раздел …") when the reader
     would need concrete tables or endpoint listings. -->

# Общие сведения

## Назначение документа

Настоящий документ содержит визуальное описание архитектуры автоматизированной системы «{system_name}» версии {version}. Документ предназначен для архитекторов, разработчиков и экспертов, принимающих решения о развитии, интеграции и эксплуатации системы.

Документ фокусируется на структурных свойствах решения: составе компонентов, потоках данных, модели развёртывания и сценариях аутентификации. Табличные сведения — стек технологий, полный перечень сущностей базы данных, список эндпоинтов API — вынесены в документ «Техническое описание».

## Контекст системы

<!-- GEN:research-section source="doc-researcher" section="Обзор системы,System Overview" max_words="400" -->

## Архитектурные принципы

<!-- GEN:research-section source="doc-researcher" section="Архитектура,Architecture" max_words="400" -->

<!-- AGENT: If the research section above does not list explicit principles,
add 3–5 bullets describing the principles followed in practice: layered
architecture, inversion of control, separation of concerns, idempotent
operations, event-driven where applicable. Source: doc-researcher
ARCHITECTURE + observed code patterns. -->

# Высокоуровневая архитектура

## Компонентная схема

<!-- GEN:mermaid source="component" title="Компонентная схема системы" -->

<!-- AGENT: 2–3 paragraphs describing the components on the diagram: their
responsibilities, boundaries, and why the chosen decomposition fits the
domain. Do NOT restate the technology versions — those are in the
technical description. Source: doc-researcher ARCHITECTURE. -->

## Архитектурная диаграмма

<!-- GEN:mermaid source="architecture" title="Архитектура приложения" -->

<!-- AGENT: One paragraph clarifying what the diagram visualises and the
relation to the component schema above. Source: doc-researcher
ARCHITECTURE. -->

# Взаимодействие компонентов

## Последовательность типового сценария

<!-- GEN:mermaid source="sequence" title="Последовательность операций для типового пользовательского сценария" -->

## Поток данных

<!-- GEN:mermaid source="dataflow" title="Поток данных через компоненты" -->

<!-- AGENT: 2–3 paragraphs describing the dataflow: the route a user
request takes from the browser to the storage layer, where validation
happens, which caches are warmed, how response formatting is performed.
Omit protocol/format details — those are in technical-description. -->

# Модель данных

## Схема сущностей и связей

<!-- GEN:mermaid source="er-diagram" title="Схема сущностей и связей" -->

<!-- AGENT: One paragraph summarising the main entity groups visible on
the ERD and the key relationships (e.g. "users → events → registrations").
Full column listing and index descriptions are in technical-description,
раздел «Структура базы данных». -->

# Безопасность на уровне архитектуры

## Схема аутентификации

<!-- GEN:mermaid source="auth-sequence" title="Последовательность аутентификации пользователя" -->

<!-- AGENT: One short paragraph describing the concrete auth flow visible
on the diagram: which tokens are issued, where they live on the client,
how they are validated on every request, and how refresh is handled.
Source: security_facts.auth + doc-researcher AUTH. -->

## Модель разграничения доступа

<!-- AGENT: rbac-matrix renders a structured table if role-discovery emits rbac_matrix;
otherwise the GEN:research-section below falls through to the prose summary. -->

<!-- GEN:rbac-matrix silent_if_missing="true" -->

<!-- GEN:research-section source="role-discovery" section="Модель ролей,Role Model" max_words="450" level_shift="1" -->

# Модель развёртывания

## Топология развёртывания

<!-- GEN:research-section source="doc-researcher" section="Развёртывание,Deployment" max_words="500" -->

<!-- AGENT: After the extracted block, add a short diagram interpretation
paragraph: which services are stateful vs stateless, where TLS is
terminated, where persistent volumes are mounted. Source: docker-compose
+ doc-researcher DEPLOYMENT. -->

# Сопровождение

## Точки расширения

<!-- GEN:extension-points -->

<!-- AGENT: After the auto-detected list, describe in 2–3 sentences how
a developer should extend the system along these points (where to
register a new adapter, what contract the plugin must satisfy, how the
system picks it up). Source: code conventions. -->

## Допущения и ограничения

<!-- GEN:research-section source="spec-reader" section="Non-Functional Requirements,Нефункциональные требования,Допущения и ограничения,Constraints" max_words="400" -->

<!-- AGENT: If the research section above is missing or thin, list
3–5 architectural assumptions the reader should keep in mind:
single-region deployment, eventual consistency where applicable,
shared-nothing workers, maximum concurrent user count tested. -->

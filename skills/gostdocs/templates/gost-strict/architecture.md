---
title: "{system_name}. Описание архитектуры"
lang: ru-RU
---

<!-- GOST mode: strict | Template version: 1.0 -->
<!-- Reference: РД 50-34.698-90, ГОСТ 34.602-2020, ГОСТ 34.601-90 -->

<!-- AGENT: This document complements the Technical Description with a
visualisation-first view of the system: every major structural decision
must be backed by a diagram. Prose paragraphs explain context, trade-offs,
and operational implications the diagram alone cannot convey. -->

# Общие сведения

## Назначение документа

<!-- AGENT: Explain the purpose of this architecture description: a reviewer
uses it to understand how the system is decomposed into components, how
data flows between them, and which architectural principles guide the
design. Source: spec-reader SYSTEM PURPOSE. -->

Настоящий документ содержит описание архитектуры автоматизированной системы «{system_name}» версии {version}. Документ предназначен для архитекторов, разработчиков и экспертов, принимающих решения о развитии, интеграции и эксплуатации системы.

Документ фокусируется на структурных свойствах решения: составе компонентов, протоколах взаимодействия, потоках данных, модели развёртывания и сценариях аутентификации. Для детального описания эндпоинтов, форматов данных и настроек безопасности следует обращаться к техническому описанию.

## Контекст системы

<!-- AGENT: Short (2-3 sentences) summary of what external actors and
systems interact with this application. Source: doc-researcher SYSTEM
OVERVIEW + spec-reader CONSTRAINTS. -->

## Архитектурные принципы

<!-- AGENT: List the top-level architectural principles the system follows
(e.g. Clean Architecture, hexagonal boundaries, event-driven fan-out,
multi-tenant isolation). Each principle — one short paragraph explaining
the intent, the trade-off, and the consequence for maintenance. Source:
doc-researcher ARCHITECTURE + spec-reader NON-FUNCTIONAL REQUIREMENTS. -->

# Высокоуровневая архитектура

## Компонентная схема

<!-- GEN:mermaid source="component" title="Компонентная схема системы" -->

<!-- AGENT: 2-3 paragraphs describing the components on the diagram above:
their responsibilities, the boundaries between them, and why the chosen
decomposition is appropriate for the domain. Source: doc-researcher
ARCHITECTURE. -->

## Архитектурная диаграмма

<!-- GEN:mermaid source="architecture" title="Архитектура приложения" -->

## Стек используемых технологий

<!-- GEN:tech-stack-table -->

# Взаимодействие компонентов

## Протоколы и форматы данных

<!-- GEN:protocols-table -->

<!-- AGENT: Follow the protocol table with a short note about the choice
rationale: why HTTPS/REST for the external boundary, why binary protocols
for internal links, why this particular message-broker if one is used.
Source: doc-researcher ARCHITECTURE. -->

## Последовательность операций

<!-- GEN:mermaid source="sequence" title="Последовательность операций для типового пользовательского сценария" -->

## Поток данных

<!-- GEN:mermaid source="dataflow" title="Поток данных через компоненты" -->

<!-- AGENT: Describe the dataflow diagram in 2-3 paragraphs: the route a
user request takes from the browser to the storage layer, where
validation happens, which caches are warmed, and how response formatting
is performed. Source: doc-researcher ARCHITECTURE. -->

# Модель данных

## Схема базы данных

<!-- GEN:mermaid source="er-diagram" title="Схема сущностей и связей" -->

## Ключевые сущности

<!-- GEN:db-schema scope="all" headingLevel="3" -->

# Безопасность на уровне архитектуры

## Схема аутентификации

<!-- GEN:mermaid source="auth-sequence" title="Последовательность аутентификации пользователя" -->

<!-- AGENT: One short paragraph below the diagram describing the concrete
flow: what tokens are issued, where they are stored on the client,
how they are validated on every request, and how refresh is handled.
Source: security_facts.auth + doc-researcher AUTH. -->

## Модель разграничения доступа

<!-- GEN:rbac-matrix -->

<!-- AGENT: If the rbac-matrix above is populated, describe the role
lattice it represents (2-3 sentences). Otherwise explain why the matrix
is absent — usually because role-discovery did not produce a rbac_matrix
structure; fill it in manually from backend/seeders/*. -->

## Архитектурные меры защиты

<!-- GEN:tech-security headingLevel="3" -->

# Модель развёртывания

## Состав развёртывания

<!-- AGENT: Describe the deployment topology: how many containers, where
each runs, which network segments are public vs private, where TLS is
terminated. Source: doc-researcher DEPLOYMENT + docker-compose.yml. -->

## Контейнеры и образы

<!-- GEN:tech-components -->

## Масштабирование

<!-- GEN:tech-scaling headingLevel="3" -->

# Сопровождение

## Точки расширения

<!-- AGENT: List the places where the architecture was designed for
future extension: plugin interfaces, webhook consumers, adapter ports,
background-job registries, event subscribers. One short paragraph per
point explaining how to add a new implementation without breaking the
existing contract. Source: doc-researcher ARCHITECTURE. -->

## Допущения и ограничения

<!-- AGENT: Briefly document the architectural assumptions the reader
should keep in mind: single-region deployment, eventual consistency
where applicable, shared-nothing workers, maximum concurrent user
count tested, etc. Source: spec-reader CONSTRAINTS + NON-FUNCTIONAL
REQUIREMENTS. -->

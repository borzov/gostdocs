---
title: "{system_name}. Инструкция по развёртыванию"
lang: ru-RU
---

<!-- GOST mode: lite | Template version: 1.0 -->
<!-- Shortest guide — reviewer goes from zero to a populated running system. -->

# Назначение

Инструкция описывает порядок запуска дистрибутива системы «{system_name}» ({version}) на компьютере эксперта для локальной проверки функциональности.

# Развёртывание

<!-- GEN:deploy-commands -->

# Проверка

Откройте адрес `{system_url}` в браузере. Главная страница должна загрузиться без ошибок; признаком исправной работы считается доступность входа в систему под тестовыми учётными записями из следующего раздела.

# Тестовые учётные записи

<!-- GEN:test-accounts -->

# Проверочные сценарии

<!-- AGENT: 3-5 minimal smoke-test scenarios that exercise the major
features end-to-end. Source: doc-researcher FEATURES + spec-reader
USER STORIES. -->

# Остановка

```bash
docker compose down
```

Для полного сброса состояния (очистка базы и демонстрационных данных) используйте `docker compose down -v`.

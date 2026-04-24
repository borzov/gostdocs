---
title: "{system_name}. Инструкция по развёртыванию"
lang: ru-RU
---

<!-- GOST mode: lite | Template version: 2.0 -->

# Назначение

Инструкция описывает порядок запуска дистрибутива системы «{system_name}» ({version}) на компьютере эксперта для локальной проверки функциональности.

# Состав дистрибутива

<!-- GEN:distribution-composition -->

# Развёртывание

<!-- GEN:deploy-commands -->

# Проверка

Откройте адрес `{system_url}` в браузере. Главная страница должна загрузиться без ошибок.

# Тестовые учётные записи

<!-- GEN:test-accounts -->

# Проверочные сценарии

<!-- GEN:smoke-scenarios -->

# Остановка

```bash
docker compose down
```

Для полного сброса состояния (очистка базы и демонстрационных данных) используйте `docker compose down -v`.

# Типовые проблемы

<!-- GEN:common-issues -->

# Контакты сопровождения

<!-- GEN:maintenance-contacts -->

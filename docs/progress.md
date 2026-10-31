# Hotel MVP — статус реализации

Обновлено: 31 октября 2026

| Этап | Состояние | Проверяемый результат |
| --- | --- | --- |
| V0 Основа | Готово | Monorepo, Expo, Fastify, PostgreSQL, общие пакеты, CI |
| V1 Аккаунт и отель | Готово | Регистрация, вход, Secure Store, восстановление сессии, профиль отеля |
| V2 Номера и тарифы | Готово | Expo CRUD, API, запрет пересечений и preview расчёта |
| V3 Заявка и предложение | Готово | Embed-виджет, экран установки, allowlist, idempotency, honeypot, автоподбор и Delivery worker |
| V4 Страница и Accept | Готово для MVP | SSR-страница, выбор варианта, идемпотентный Accept и состояние `requires_confirmation` в dashboard |
| V5 Google email | Реализовано, нужны credentials | Шаблоны, preview/test-send, OAuth, refresh token и отправка Gmail |
| V6 WAHA | Реализовано, нужна session | Настройка/проверка session, test-send и реальная отправка WhatsApp |
| V7 Пилот | Запланировано | Production domain, storage, legal copy и release accounts |

## Уже подтверждено

- Все текущие TypeScript-пакеты проходят typecheck.
- 89 unit/integration tests проходят.
- Expo Doctor: 20/20.
- Drizzle schema check проходит.
- Миграции применяются на чистой PostgreSQL.
- Реальный HTTP smoke на чистой PostgreSQL: аккаунт → отель → номер → тариф → intake → активное предложение → Accept → `requires_confirmation`; контрольная сумма €200.
- Expo web export собран; визуально проверены dashboard, settings, шаблоны и подключения.
- Серверный production bundle запускается автономно и отдаёт embed script и HTML предложения.
- Delivery worker атомарно забирает задания из PostgreSQL, поддерживает backoff и различает повторяемые и неоднозначные ошибки.
- Операционный dashboard рассчитан на поток до 1000 заявок в день: PostgreSQL выбирает только текущий день в часовом поясе отеля, Expo использует виртуализированный плотный список, а принятые предложения агрегируются как `Payment pending` с общей суммой.
- Строка заявки раскрывает состав предложения, адресата и результат каждой отправки; технические сбои каналов отделены от обычных бизнес-статусов.

## Известный технический риск

`npm audit` сообщает 13 advisory в транзитивной цепочке Expo CLI/config (`deepmerge`, `glob`, `minimatch` и вложенный `zod`). Предлагаемый `npm audit fix --force` понижает Expo до несовместимого SDK 54, поэтому он намеренно не применён. Текущий Expo SDK 58 проходит Expo Doctor 20/20; зависимости нужно обновить после совместимого исправления upstream.

## Внешние зависимости

Код интеграций готов, но для реальной отправки и пилотного релиза понадобятся:

- Google OAuth client ID/secret и подтверждённый redirect URI;
- работающая WAHA-сессия и тестовый номер;
- production PostgreSQL и object storage;
- домен для формы и страницы предложения;
- Apple/Google developer accounts;
- финальные название, логотип, фотографии и privacy/WhatsApp consent.

В текущем MVP фотографии задаются URL. Загрузка файлов в object storage, push-уведомления и отдельный экран деталей принятого предложения оставлены на пилотный этап; факт принятия уже виден в живом dashboard как `requires_confirmation`.

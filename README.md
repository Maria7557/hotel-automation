# Hotel

Мобильное приложение для автоматической обработки гостиничных заявок: тарифы по датам, персональные предложения, Google email, WhatsApp через WAHA и подтверждение гостя.

## Структура

- `apps/mobile` — Expo Native приложение владельца отеля.
- `apps/server` — единый API, embed-форма, веб-предложение и worker.
- `packages/domain` — подбор, тарифный расчёт и состояние заявки.
- `packages/contracts` — общие схемы API.
- `packages/design` — общие бренд-токены для React Native и web.
- `packages/templates` — безопасные email/WhatsApp-шаблоны и SSR-страница предложения.

Подробный порядок реализации: [docs/implementation-plan.md](docs/implementation-plan.md).
Текущий прогресс: [docs/progress.md](docs/progress.md).

## Локальный запуск

Требования: Node.js 24+, npm и PostgreSQL 16+ либо Docker.

```bash
npm install
cp apps/server/.env.example apps/server/.env
cp apps/mobile/.env.example apps/mobile/.env
docker compose up -d postgres
npm run db:migrate --workspace @hotel/server
```

Перед запуском замените `AUTH_SECRET` в `apps/server/.env` случайной строкой длиной не менее 32 символов.
Для фактической отправки предложений включите `DELIVERY_WORKER_ENABLED=true`. Без этого заявки и доставки создаются, но worker намеренно не отправляет сообщения.

В двух терминалах:

```bash
npm run dev:server
npm run dev:mobile
```

Для физического телефона укажите в `apps/mobile/.env` LAN-адрес компьютера вместо `127.0.0.1`, например `http://192.168.1.20:4000`.

## Быстрый вход

- Google web: задайте `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; в Google Cloud добавьте точный web origin приложения.
- Google iOS/Android: используйте тот же Web client ID, задайте `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` и `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`, создайте отдельные iOS/Android OAuth clients для `com.hotel.staff` и Android signing SHA-1. Нужен Expo development/production build — Expo Go не включает нативный модуль.
- Apple iOS: включите Sign in with Apple для App ID `com.hotel.staff` в Apple Developer. Проверять нужно на реальном iPhone.
- Сервер: перечислите допустимые Google audiences в `GOOGLE_AUTH_CLIENT_IDS`, Apple bundle/Services IDs — в `APPLE_AUTH_CLIENT_IDS`.

Вход в аккаунт запрашивает только базовый профиль и подтверждённый email. OAuth-доступ к Gmail для отправки писем подключается отдельно в настройках.

## Проверка

```bash
npm run check
npm run build --workspace @hotel/server
npm run export --workspace @hotel/mobile
npx expo-doctor@latest apps/mobile
npm exec --workspace @hotel/server -- drizzle-kit check
```

Текущая база включает регистрацию и сессии, профиль и фотографии по URL, комнаты, тарифы по датам, серверный расчёт, публичный intake, автоматическое неизменяемое предложение, веб-страницу Accept и живой dashboard в Expo. В приложении доступны редактор шаблонов, preview, тестовая отправка, подключение Google OAuth и WAHA. Встроенный worker отправляет реальные email/WhatsApp, безопасно повторяет только однозначно повторяемые ошибки и не дублирует отправку при неоднозначном сетевом ответе.

## Форма для сайта

После создания отеля и добавления домена в intake settings вставьте на сайт:

```html
<script
  async
  src="https://YOUR_API_DOMAIN/embed.js"
  data-public-key="YOUR_HOTEL_PUBLIC_KEY"
></script>
```

Виджет наследует только собственные безопасные стили, отправляет заявку в публичный API с `Idempotency-Key` и показывает результат гостю. Сервер принимает запрос только с разрешённого домена отеля.

Тот же код можно получить и скопировать в мобильном приложении: `Настройки → Форма на сайте`. Разрешённые сайты указываются как точные origin, например `https://hotel.example`.

## Подключения

- Google: задайте `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` и точный `GOOGLE_REDIRECT_URI`, затем запустите OAuth из приложения. Используется только scope отправки Gmail.
- WAHA: оператор платформы задаёт `WAHA_BASE_URL` и `WAHA_API_KEY` на сервере один раз. Отель нажимает `Connect WhatsApp`, сканирует QR-код и не видит технические параметры шлюза.
- В локальной среде без реальных подключений test-send возвращает явно обозначенный fake-результат и не утверждает, что сообщение доставлено.

Подробности worker и его гарантий: [apps/server/docs/delivery-worker.md](apps/server/docs/delivery-worker.md).

## Дизайн-система

- [Бренд-бук и правила интерфейса](docs/brand-book.md)
- [Дизайн-токены JSON](design/tokens.json)
- [CSS-переменные](design/tokens.css)

Референс: Smart Home App UI Kit в Figma. Из него перенесены визуальная логика, типографическая шкала, геометрия, цветовые роли и подход к компонентам. Тематика и пользовательские сценарии адаптированы под гостиничный продукт.

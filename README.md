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

В трёх терминалах:

```bash
npm run dev:server
npm run dev:mobile
npm run dev:clients
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

Каждая заявка получает постоянный уникальный номер бронирования: `1`, `2`, `3` и далее, без букв и ведущих нулей. Он отображается в списке заявок, доступен для поиска и копирования во внутреннюю систему отеля, а также возвращается API как `reservationNumber`. Миграция `0013_reservation_numbers` присваивает номера существующим заявкам. Номера общие для всех отелей, не переиспользуются после удаления и могут иметь пропуски при повторных запросах или откате транзакций.

Staff can add enquiries from phone calls, walk-ins and other conversations using **Requests → New request**, including before website setup is complete. Enter the guest, stay dates, occupancy, BB/HB/FB and optional notes. By default the request is saved for review without sending a guest message; contact details are optional. Enable **Prepare & send offer** to calculate an offer using the existing rates and queue delivery to the supplied email and/or WhatsApp. At least one contact is required in that mode; missing rooms or rates leave the request needing review. The authenticated `POST /v1/inquiries` endpoint requires an `Idempotency-Key` (1–153 characters) and takes the hotel from the signed-in user. Manual source and staff identity are recorded with the request. Demo entries remain in memory and never send messages.

Use **Duplicate** on a reservation page to open a new request with the guest, contacts, language, dates, occupancy, board, notes and priced room offers prefilled. Review and edit the copied information before saving; copied offer prices are retained rather than recalculated. Saving creates a separate reservation number, resets acceptance/payment/delivery history and leaves sending off by default. A saved client is not required: requests store their guest details directly, and the existing contact worker handles client linking separately.

Open a reservation and select **Prepare offers** or **Edit & send offers** to send 1–6 priced choices on that same reservation. Staff can change the room, terms, total stay price and guest note using arrangements recorded by phone or in the original request notes. Dates, occupancy and board remain those of the request. Offers have `available`, `expired` or `accepted` status and are valid for seven days. Accepting one expires all alternatives; the accepted choice stays accepted after seven days. Sending edits creates an immutable replacement offer set, expires the previous links and cancels their pending deliveries, while keeping the existing reservation ID and number. Expired email links still display an expired reservation screen with a link to the hotel website (or first configured website origin) for a new booking and availability check. Configure the hotel website for phone-only requests. The authenticated `POST /v1/inquiries/:inquiryId/offers` endpoint requires an `Idempotency-Key`, `baseOfferId` (or `null` for the first set), and 1–6 `offers` containing `roomId`, `planName`, integer `totalCents` and an optional `note`. Concurrent edits or changes after acceptance return `409`. Run PostgreSQL concurrency checks with `OFFERS_TEST_DATABASE_URL` pointing to a disposable test database.

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

Клиенты и отдельный фоновый worker: [apps/server/docs/clients.md](apps/server/docs/clients.md).

## Board basis: BB / HB / FB

Every new website enquiry must send a required `mealPlan` with exactly `BB`, `HB`, or `FB` (case-sensitive). Legacy values and missing codes are rejected. The widget provides the choice; existing forms must map it using `data-meal-plan="[name='mealPlan']"` or `data-hotel-field="mealPlan"`. Radio groups and selects are supported. The board is persisted on the enquiry and immutable offer snapshot, displayed in request summaries, and included in guest/staff messages.

Rates and previews also require `mealPlan`. A room can have BB, HB and FB rates for the same dates and plan code; overlaps are rejected within the same room + plan + board. Automatic offers use only the requested board. Missing matching board rates create a request needing attention and never substitute another board.

`nightlyBaseCents` is the package price for the included occupancy. `extraAdultCents` / `extraChildCents` add the extra guest's accommodation and board. Optional `boardAdultCents` / `boardChildCents` are additional charges for every adult/child per night; leave them zero when the package already includes all meals. The existing age threshold determines adult/child pricing. The price is calculated night by night and frozen before delivery and acceptance.

Migration `0012_strict_board_basis` renames breakfast charge columns to board charges, converts breakfast rates to BB, and soft-archives room-only rates without inventing meal inclusions. Historical requests get a board only when their selected or consistent offer establishes it. Unresolved requests show “Board needed”; their active offers are revoked and scheduled deliveries cancelled. Existing offer snapshots remain unchanged. Run the normal server database migration before starting the updated server.

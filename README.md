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

Staff can add enquiries from any channel using **Requests → New request**, including before website setup is complete. Enter guest details or choose a saved client to fill the name, email, phone and language. Both email and a phone number with its country code are required before saving, including for saved clients with incomplete contact details. Guest language uses a dropdown. Enter the stay dates, occupancy, BB/HB/FB and optional notes. **Send offer now** is enabled by default for new requests: off saves for review; on prepares an offer and queues email and WhatsApp. The authenticated `POST /v1/inquiries` endpoint requires an `Idempotency-Key` (1–153 characters) and takes the hotel from the signed-in user. Manual source and staff identity are recorded with the request. Demo entries remain in memory and never send messages.

Use **Duplicate** on a reservation page to open a new request with the guest, contacts, language, dates, occupancy, board, notes and priced room offers prefilled. Review and edit the copied information before saving; copied offer prices are recalculated from the current rates for the new stay. Saving creates a separate reservation number, resets acceptance/payment/delivery history and leaves sending off by default. A saved client is not required: requests store their guest details directly, and the existing contact worker handles client linking separately.

**Received via** supports Phone call, Walk-in, Website form, Email, WhatsApp and Other. The selected channel is shown on the reservation and preserved when duplicating it. Website enquiries are recognised automatically.

Guest language defaults to Italian (`it`) across enquiry forms, contacts, website intake, email/WhatsApp offers and proposal pages. Staff can select another language; duplicates and saved contacts retain the guest’s existing choice. Guest language is independent of the hotel locale. The website script accepts `data-language="en"` as an explicit override, or an existing form can supply a `data-hotel-field="language"` field (custom selector: `data-guest-language`).

Open **Settings → Testing → Form** to submit a complete hotel enquiry with guest contacts and language, stay dates, adults, children’s ages, BB/HB/FB and a message. Submissions follow the ordinary website enquiry flow: calculate offers, queue email/WhatsApp delivery, send staff notifications and appear as Website form requests, with no test label. A non-empty message pauses automation for staff review; no offer or guest delivery is created until staff review and send it. The authenticated `POST /v1/inquiries/form` endpoint uses the signed-in user’s hotel and an `Idempotency-Key` (1–155 characters); website origin setup is not required. Demo submissions stay local and never send messages.

Open a reservation and select **Create offer** in the page header or beside the offer count. Guest contacts, language, stay dates, adults, children’s ages, room, board, rate plan, deposit and cancellation terms are prefilled. Each of the 1–6 choices can have alternative dates, guests, board and extras. Rates are calculated automatically from the room’s complete nightly tariff coverage; missing rates block sending instead of inventing a price. Discounts apply to accommodation plus extras, and deposit amounts are calculated from the discounted total. The editor previews prices and the server recalculates on send, rejecting a changed quotation with `409 OFFER_PRICE_CHANGED`.

Use **Settings → Extras & offer defaults** to create services with prices charged once per stay, per night, per guest, or per guest per night. Per-guest extras include adults and children. Extras marked **Include by default** are included in automatic offers; staff can deselect them. Configure the default deposit percentage and cancellation policy here. Staff views and the guest page show each offer’s selected settings, charge quantities, totals and `available`, `expired` or `accepted` status. Email and WhatsApp also include the quoted settings and price breakdown. Sent snapshots retain their prices and terms after catalog changes. Migration `0014_offer_settings` adds the hotel’s extras/defaults storage; run the normal server migration before using these settings.

Website requests send offers automatically unless the guest leaves a non-blank note. Such requests retain the note, show `manual_review` and schedule no guest messages. Staff review the request and use **Create offer** to send the calculated choices. All choices stay under one reservation ID and number. They are valid for seven days; accepting one expires every alternative and applies its chosen stay to that reservation. Sending edits creates an immutable replacement set and expires previous links. Expired links still display a booking/availability link to the hotel website (or its first configured website origin). Accepted reservations display their selected settings and cannot be edited or sent again.

The authenticated editor endpoints are `GET /v1/inquiries/:inquiryId/offer-editor` and `POST /v1/inquiries/:inquiryId/offers/preview`. Send using `POST /v1/inquiries/:inquiryId/offers` with an `Idempotency-Key`, `baseOfferId` (or `null` for the first set), and 1–6 `offers`. The current editor uses `pricingMode: "automatic"`, `roomId`, `planCode`, stay settings, selected `extraIds`, optional discount/deposit/policy and `quotedTotalCents`; catalog prices are never accepted from the client. Legacy staff clients can still send an explicit manual total, recorded with `pricingSource: "staff"`. Settings use `GET/PUT /v1/offer-settings`. Run PostgreSQL concurrency and persistence checks with `OFFERS_TEST_DATABASE_URL` pointing to a disposable test database.

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

## English and Italian

The staff app supports English and Italian. Choose **English / Italiano** on the welcome or sign-in screen, or under **Settings → App language**. The app detects the browser/device language on first use and saves the choice locally. Signed-in users also save it to their account; staff email/push notifications use that preference. App language does not change the hotel's currency, timezone or a guest's saved language.

The shared `@hotel/i18n` package contains the Italian message catalog, English source keys, normalization, interpolation and plural handling. UI labels and dates/prices are translated when rendered, so existing requests update immediately after switching languages. Property names, reservation numbers, internal codes and authored guest/hotel content remain stable.

Guest offers and email/WhatsApp messages use the guest language saved with the offer. Public offer pages have an English/Italian selector; choosing a display language does not modify the accepted offer. The website widget supports `data-lang="en"` or `data-lang="it"`; absent that attribute it uses the website's supported HTML language for the widget UI. Existing `data-language` and guest-language field mappings continue to work, and the default guest communication language remains Italian.

Under **Settings → Offer messages**, edit and save English and Italian templates separately. Existing templates are retained as Italian legacy templates. Each guest receives their language's saved variant; if none exists, the built-in message for that language is used. Use **Legacy template language** to assign existing English custom templates to English before rollout, then save.

Apply migration `0015_app_languages` before starting the updated server:

```bash
npm run db:migrate --workspace @hotel/server
```

A new native build is required for the added Expo Localization module. The web app needs the normal export and deploy. Validation: `npm run check`, server build, web export, and English/Italian browser checks.

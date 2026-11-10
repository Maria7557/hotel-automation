# Clients and request isolation

The app has a Clients tab with search, backend filters, cursor pagination and manual contact creation. The list renders contacts only and never fetches reservation history or summaries. Paginated reservation history loads only on the client profile. Each client has a “View reservations” link to their profile. Each reservation has an “Open reservation #…” link to its own detail page, including historical requests outside today’s dashboard. Web links can be copied or opened in a new tab; native links use the app navigation stack. A name and at least one email or international phone number are required. Contact identities are scoped to a hotel; matching never uses names. Ambiguous email/phone identities require review rather than an automatic merge. Contact creation does not confirm a reservation or payment.

`GET /v1/clients` accepts `stayFrom`/`stayTo` (inclusive calendar dates overlapping a stay, excluding its check-out day), `minGuests`/`maxGuests`, `minAdults`/`maxAdults`, `minChildren`/`maxChildren`, `minNights`/`maxNights`, `roomId`, `mealPlan`, `status`, `source`, `locale`, `contact` (`email`, `phone`, `both`), `reservations` (`with`, `without`), `notes` (`with`, `without`), and `addedFrom`/`addedTo` (inclusive UTC dates). All are optional and combine with search before the 50-contact cursor page is selected. Counts include all occupancies in a request; room matching uses the latest offer's selected option, or its first option before selection. Status matches the dashboard workflow. Every reservation condition must match the same linked request. The default list reads contacts and link counts only. `GET /v1/clients/filter-options` returns hotel-scoped room categories, including archived categories, and contact languages without reservation details. The UI loads those options when its filter panel opens, and sends applied filters with every page request. Invalid dates, negative/fractional counts, reversed ranges, and a no-reservations filter combined with stay conditions return 400.

Request rows independently load contact status. Visible indicators are batched (at most 100 IDs), use a four-second timeout and refresh every minute. The dashboard response, request list loading and payment actions do not depend on this endpoint. Missing contacts get an “add client to contacts” button and explanatory info box. Lookup failures get a “failed to load client status” badge with retry. Existing contacts have no indicator. Manual contact creation is recognised even before background linking finishes.

## Running

Apply migrations before starting the new API and worker:

```sh
npm run db:migrate --workspace @hotel/server
npm run dev:server
# Separate terminal/process:
npm run dev:clients
```

Production build includes `dist/index.js` and `dist/client-worker.js`. Install and enable `deploy/hotel-automation-clients.service` alongside the API unit. The worker is intentionally not launched by the API process. `CLIENT_WORKER_INTERVAL_MS` defaults to 30000; `CLIENT_WORKER_BATCH_SIZE` defaults to 25 and cannot exceed 25.

For production:

```sh
npm run build --workspace @hotel/server
npm run export --workspace @hotel/mobile
# Use the existing deployment's release procedure for the generated app files.
sudo install -m 644 deploy/hotel-automation-clients.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hotel-automation-clients.service
```

## Resource limits and durability

The API contact repository has a dedicated two-connection pool and accepts at most two concurrent contact operations. Excess operations return 503 and do not queue behind request database work. The worker has its own single-connection pool, separate process and low systemd CPU/I/O weights with CPU and memory limits. Contact connections have a 1.5-second statement timeout, 100ms lock timeout and three-second idle-transaction timeout. No external services are called.

Inserting a request sets `client_sync_pending` through a database default. There is no contact lookup, queue insert or contact write in intake, offer acceptance or payment processing. A partial index identifies pending requests, including historical requests after migration. Each tick selects the least recently served active hotel with due work, then processes at most 25 requests sequentially. This provides fairness between hotels. Backlogs may increase Clients-list freshness delays rather than consume the API pool.

Contact upsert and the request link commit together in separate contact tables. Acknowledging the pending flag is a separate short statement that skips locked request rows; the worker never holds a request update lock during contact creation. If acknowledgement fails, replay finds the existing link and safely retries acknowledgement. Failures are durable, use exponential backoff up to six hours and do not stop the batch. Restarting resumes pending work. Unique identities and one link per request protect retries and concurrent manual/background additions.

Contact processing shares PostgreSQL hardware with requests, so its impact is bounded rather than zero. The worker can be stopped without interrupting intake, offers, delivery or payment actions. Monitor `Contact batch completed`, `Contact processing deferred`, pending request counts and core API latency before increasing capacity. The default maximum is 25 contacts per tick across all hotels; scale only from measured backlog and latency.

## Verification

`npm run check` runs normal checks and contact identity, worker and independent indicator-store tests. PostgreSQL integration tests run when `CONTACTS_TEST_DATABASE_URL` points to a disposable test database:

```sh
CONTACTS_TEST_DATABASE_URL=postgresql://localhost/hotel_contacts_test npm run test --workspace @hotel/server -- test/clients.integration.test.ts
```

Those tests apply migrations, create their own test accounts/hotels and remove those records afterward. They exercise tenant isolation, historic backfill, duplicate/race handling, retries, manual creation, request status and request processing while contacts are locked.

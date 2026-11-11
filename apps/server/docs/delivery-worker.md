# Offer delivery worker

The worker handles only `Delivery` rows with `kind = offer`, `state = scheduled`, and a due `next_attempt_at`.
PostgreSQL claims one row in a transaction with `FOR UPDATE SKIP LOCKED`, then changes it to `processing` before any provider request. Test deliveries are never claimed.

## Outcomes

- A provider HTTP success becomes `provider_accepted` and stores the provider message ID.
- A permanent provider error, including ordinary 4xx responses, becomes `failed`.
- A 429, 5xx response, or explicit timeout returns to `scheduled` with exponential backoff. The retry limit defaults to five provider attempts.
- A missing or disconnected channel returns to `scheduled` after five minutes without consuming a provider attempt.
- A network failure without any HTTP response is ambiguous: the provider may have accepted the message. It becomes `unknown` and is not retried automatically.
- A process crash after claim leaves the row in `processing`. It is intentionally not reclaimed automatically because the crash may have happened after the provider accepted the request. Manual reconciliation is safer than a duplicate guest message.

The loop runs in the API process only when `DELIVERY_WORKER_ENABLED=true`. Shutdown stops new polling and waits for the current batch to finish.

## Mail account selection

Email tests and queued offers share the Google/Microsoft/SMTP dispatcher. Successful OAuth or SMTP setup activates that provider and disconnects the other mail providers for the same hotel in one transaction. WhatsApp and other hotels are unchanged. Starting a new authorization does not disconnect a different working provider before authorization succeeds.

Older data may contain more than one connected mail provider. In that case the server does not guess: email offers wait without consuming attempts, and connection status/test-send reports `MAIL_CONNECTION_AMBIGUOUS`. Reconnect the intended provider to resolve this. There is no automatic fallback to a disconnected or different account when sending fails.

Provider sends acquire a hotel-scoped PostgreSQL advisory lock, reread the selected account, and check its generation before using credentials. Successful account setup assigns a new generation. OAuth attempts retain an attempt ID after state consumption; callbacks recheck it before any connection-test email and activation. Switching, disconnecting, and beginning another OAuth attempt participate in the same lock. A request already being sent finishes before a normal switch; a waiting old snapshot never silently uses the replacement account.

Each held lock uses a dedicated PostgreSQL connection with durable autocommit credential writes. Rotated tokens are saved before the send, even if the send subsequently fails. Operations for the same hotel are serialized, while other hotels can proceed. The dedicated connection is permanently closed when the lock is lost; scoped writes reject, HTTP calls receive cancellation, and SMTP checks cancellation after DNS and closes its transport. Already accepted provider results remain accepted even if secondary status/connection cleanup fails. An interrupted in-flight send can have an unknown result and must not be retried automatically.

Deployment requires **direct PostgreSQL or session pooling**, not transaction pooling. Up to five dedicated mail connections can be active per standard ten-connection application DB instance. They are separate from the main pool and close after each operation. Connection parameters come from the existing database factory; no new credentials or environment variables are required.

Microsoft stored credentials use camelCase; parsing also accepts the existing snake_case token-response format. Missing Microsoft platform configuration waits without spending an attempt, like Google. No OAuth scopes were expanded.

Run repository integration tests against a dedicated disposable PostgreSQL database with `MAIL_TEST_DATABASE_URL` and `npm test --workspace @hotel/server -- --run test/mail-repository.integration.test.ts`. Tests apply migrations and create/delete only their synthetic hotels/users. Two tests terminate the dedicated mail-lock backend to simulate connection loss, so **never use a shared or production database**. The suite covers distinct sessions, account isolation, simultaneous activation/refresh, connection loss, stale snapshots/callbacks, and pool saturation. The database test role must be allowed to terminate its own test sessions.

Remaining boundary: OAuth `senderEmail` still comes from the entered address rather than verified provider identity. This change does not prove real mailbox identity, OAuth consent, provider publication, or live deliverability. A connection-test email or guest send already handed to an external provider cannot be recalled by disconnecting.

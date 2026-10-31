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

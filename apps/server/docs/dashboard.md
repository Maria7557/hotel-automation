Both request lists use `GET /v1/dashboard`. The endpoint accepts `status` (`all`, `new`, `waiting`, `payment`, `completed`, `attention`), `search`, `sort` (`asc` or `desc` by time received), `page` (starting at 1), and `limit` (1–30, default 30). The app requests 30 offers per page. Changing filters, search or sort returns to the first page.

Filtering, search, sorting and pagination happen in PostgreSQL. Requests with identical timestamps are ordered by ID. The response includes `pagination: { page, limit, total }`, where `total` is the full filtered count, and dashboard `counts` for all of today's requests in the hotel's timezone. Counts and page data use one read-only transaction with a consistent snapshot. Pages beyond the last page are clamped to the last available page, including after marking payment links sent. The app displays the number on the current page as “30 out of N”, with Previous/Next controls and the page number.

Waiting-for-reply, new and error/review-needed cards use the same live clock pill as payment-link-needed cards. `offerSentAt` is the earliest successful delivery time for the latest offer; older offer versions and queued/failed deliveries do not start the reply timer. Payment-link waiting continues to use `acceptedAt`. New and error/review-needed cards count from `receivedAt`, showing how long the request has been waiting for action since it arrived. All timers update every minute and when the app returns to the foreground.

Run the PostgreSQL integration tests against a disposable migrated database:

```sh
DASHBOARD_TEST_DATABASE_URL=postgresql://localhost/hotel_dashboard_test npm test --workspace @hotel/server -- dashboard.integration.test.ts
```

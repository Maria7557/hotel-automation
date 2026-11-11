# Ospio deployment: ospio.online

The Ospio deployment is isolated from the existing `paddock.ae` site:

- Expo web files: `/var/www/hotel-automation`
- Source checkout: `/opt/hotel-automation/current`
- Runtime environment: `/etc/hotel-automation/server.env`
- Persistent uploaded photos: `/var/lib/hotel-automation/uploads`
- API listener: `127.0.0.1:4200`
- PostgreSQL: local-only database `hotel_automation`
- systemd unit: `hotel-automation.service`
- nginx hosts: `ospio.online`, `www.ospio.online`
- active nginx configuration: `/etc/nginx/conf.d/ospio.online.conf`

`hotel.chatsocials.app` is the previous hostname. The checked-in nginx file is a
starting template, not a replacement for the live HTTPS configuration.

The nginx host serves the Expo export and proxies `/health`, `/v1/*`,
`/proposal/*`, `/media/*`, and `/embed.js` to the API. The existing website and its API
are not modified.

Required production values are kept only in `/etc/hotel-automation/server.env`
and must never be committed. Delivery must be configured explicitly for the installation. Do not copy
example environment files over the live environment.

Contacts require the `0011` migration, the rebuilt app/API, and the separate
`hotel-automation-clients.service` unit. See
[contact worker setup and verification](../apps/server/docs/clients.md). The API
continues handling requests if the contact worker is stopped.

## Safe release checklist

1. Build from a clean, committed checkout and verify the exact pushed commit's CI.
2. Run `npm ci`, `npm run check`, `npm exec --workspace @hotel/server -- drizzle-kit check`,
   `npm run build --workspace @hotel/server`, and
   `EXPO_PUBLIC_API_URL=https://ospio.online npm run export --workspace @hotel/mobile`.
   Integration tests require separate disposable PostgreSQL databases configured via
   `CONTACTS_TEST_DATABASE_URL`, `DASHBOARD_TEST_DATABASE_URL`, and `OFFERS_TEST_DATABASE_URL`
   (plus any additional test database variable introduced by the release). Never use
   the production database for these tests.
3. Verify the live source has no unaccounted-for changes. Prepare a new release
   directory before stopping either service.
4. Back up the database, current source, web directory, and runtime configuration.
   Verify the database backup is readable before applying migrations. Review each
   pending migration and retain a rollback plan appropriate to its data changes.
5. Preserve `/var/lib/hotel-automation/uploads`, `/etc/hotel-automation/server.env`,
   and live nginx/systemd configuration. The live web directory also has separately
   maintained `privacy.html`, `terms.html`, and `terms-it.html`; do not delete them
   when publishing the Expo export.
6. Stop both hotel services for the application cutover, keep the previous release,
   switch the API and web assets together, and restart the two hotel services.
   Deploy API changes before a frontend that requires new API parameters.
7. Verify `/health`, both hotel services, the public app bundle, the retained legal
   pages, and recent service errors. Do not modify unrelated sites or services.

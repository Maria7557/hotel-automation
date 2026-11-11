# Test deployment: hotel.chatsocials.app

The test deployment is isolated from the existing `paddock.ae` site:

- Expo web files: `/var/www/hotel-automation`
- Source checkout: `/opt/hotel-automation/current`
- Runtime environment: `/etc/hotel-automation/server.env`
- Persistent uploaded photos: `/var/lib/hotel-automation/uploads`
- API listener: `127.0.0.1:4200`
- PostgreSQL: local-only database `hotel_automation`
- systemd unit: `hotel-automation.service`
- nginx host: `hotel.chatsocials.app`

The nginx host serves the Expo export and proxies `/health`, `/v1/*`,
`/proposal/*`, `/media/*`, and `/embed.js` to the API. The existing website and its API
are not modified.

Required production values are kept only in `/etc/hotel-automation/server.env`
and must never be committed. Email and WhatsApp delivery stay disabled until
real Google OAuth and WAHA credentials are configured.

Contacts require the `0011` migration, the rebuilt app/API, and the separate
`hotel-automation-clients.service` unit. See
[contact worker setup and verification](../apps/server/docs/clients.md). The API
continues handling requests if the contact worker is stopped.

## Web startup and script delivery

The host template enables gzip for the JavaScript bundle and returns 404 for
missing bundles. Apply this location block to the existing Ospio HTTPS host when
releasing; this checked-in HTTP template does not replace its live TLS
configuration. Validate the edited configuration with `nginx -t` before reload.
Preserve the separately maintained `privacy.html`, `terms.html`, and `terms-it.html`
in the web directory.

The exported HTML now displays a loading screen before the application JavaScript
runs. A failed bundle download or a 20-second startup delay displays an English or
Italian error with a retry button. Check a fresh browser load, a failed script
download, and recovery after retry before deploying. Verify the public bundle
response has `Content-Encoding: gzip` when requested with `Accept-Encoding: gzip`;
a successful API health check alone does not verify that the browser can download
and start the application.

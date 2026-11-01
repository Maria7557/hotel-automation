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

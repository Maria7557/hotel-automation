# Ospio deployment: ospio.online

Optional Signal Monitoring requires the updated collector, environment-specific
write-only keys and an Expo rebuild. Follow [the monitoring setup](../docs/monitoring.md)
before enabling it in production.

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

## Web startup and script delivery

Password recovery requires migration `0016_password_reset_tokens`, the rebuilt API/web app, `APP_BASE_URL=https://hotel.chatsocials.app` (or the deployment's actual public web origin), and the platform `NOTIFICATION_SMTP_*` / `NOTIFICATION_FROM_EMAIL` values in `server.env`. Verify a reset email, the link's web form, a fresh login and rejection of the old password after deployment. Guest mail OAuth and WAHA settings do not provide the platform recovery sender.

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

Session restoration and the hotel lookup each have a 10-second deadline, followed
by an English/Italian error and a session retry action. Other API requests have a
30-second deadline; image uploads, message tests, and SMTP setup allow 90 seconds.
Contacts retain their separate 4-second deadline. Deadlines also cover response
bodies. Requests are not automatically replayed: a timed-out write tells staff to
refresh before trying again because the server may still complete the action.
Web text renders with fallback fonts while custom fonts load or if they fail.

## Manual deployment from GitHub

The **Deploy Ospio Hotel** workflow only runs from `main`. Leave the production
and staging checkboxes off to verify and build without accessing the server.
**Stage on server** validates the bundle and uploads only to the isolated
receiver, without replacing API or web files.
A collaborator with GitHub Write access can dispatch the workflow from **Actions**.
The repository owner configures `ospio-hotel-production` to accept only the exact
`main` branch before adding the two environment secrets (no repository-wide secrets).
Protect main against direct pushes and require review of deployment changes before
provisioning access. Do not share credentials between operators or with the
Monitoring repository.

Production requires a separately provisioned key and pinned host key. The live cutover entrypoint is not installed by this workflow. The separately
provisioned staging receiver accepts only `ospio-hotel-stage` and a status check. It must accept the release bundle
on stdin only for `ospio-hotel-deploy <40-hex commit> <64-hex SHA-256>`, verify
the checksum and embedded commit, and reject other commands and unsafe archives.
Use a dedicated account with a forced command and no forwarding or interactive
shell. Never use the personal or root SSH key. The trusted release helper must
implement the safe release checklist above, lock concurrent cutovers, run app
code unprivileged, and stop on unsafe migrations or live drift. Test it against a
non-production target before putting a deploy key in GitHub. Match the current
Expo web settings using the non-secret `OSPIO_WEB_*` repository variables.
Optional Signal instrumentation is not configured by this workflow; if the
current release uses it, resolve this difference before enabling deploys.
Never copy confidential settings into `EXPO_PUBLIC_*`. After testing both
the build configuration and server receiver, set the environment variable
`OSPIO_HOTEL_DEPLOY_READY` to `true` to enable the production job.

Local release checks:

- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s deploy -p test_ospio_release.py`
- `python3 deploy/ospio_release.py BUNDLE DESTINATION COMMIT SHA256` checks both
  archives and creates a verified staging tree without running application code.
- The paired-directory switch and rollback are exercised in isolation. Do not
  install or enable a live runner until PostgreSQL backup/migrations, both Hotel
  services, and the web/API cutover have been exercised together outside production.

### Live release operator setup

The staging job uploads the inner archive. The production job instead sends the
original ZIP issued by GitHub Actions along with the commit, artifact and run IDs.
The server rechecks current `main`, the repository, successful build, exact
workflow and SHA-256 against GitHub before unpacking. No GitHub token is sent to
the server. A copied SSH key alone cannot substitute a different release or ZIP.

Install the pinned server scripts outside the app tree (root-owned):
`/usr/local/libexec/ospio-hotel/{ospio_live.py,ospio_release.py}` and
`/usr/local/libexec/ospio-hotel-receive` (the forced-command wrapper).
Retain the legacy staging implementation as
`/usr/local/libexec/ospio-hotel-stage`. The dedicated account can only run the
root-owned live helper with **no arguments** through sudo, never a shell.
Verify the original artifact on the target with the root-only `verify` mode
before enabling. Keep both the host marker `/etc/ospio-hotel-deploy.enabled`
and environment flag `OSPIO_HOTEL_DEPLOY_READY` off until reviewed.

The live runner installs locked runtime dependencies without lifecycle scripts
as `hotelapp`, verifies backup readability, restricts database upgrades to
explicitly reviewed additive migrations, and retains the prior app and web trees.
If health checks fail, it restores the previous code and web assets. It does not
automatically restore the database, which could overwrite new writes. New
migrations require a separately reviewed migration allowlist change.

# WAHA service for Hotel Automation

This Compose file runs the open-source WAHA Core image as the platform WhatsApp gateway.
It binds only to `127.0.0.1:3000`; neither the REST API nor the native WAHA Dashboard
must be exposed through the public nginx host.

## Before starting

1. Provision a host with enough memory for the expected number of WhatsApp sessions.
   Do not place a production WAHA fleet on the current 2 GB test VPS without measuring it first.
2. Copy `.env.example` to `.env` and replace all three credentials with independent,
   randomly generated values.
3. Back up `sessions/`. The `/app/.sessions` mount preserves paired phones after a
   container restart and prevents hotels from having to scan a QR code again.
4. Set these values in the Hotel API environment:

   ```text
   WAHA_BASE_URL=http://127.0.0.1:3000
   WAHA_API_KEY=<the same API key from deploy/waha/.env>
   PLATFORM_ADMIN_EMAILS=<comma-separated internal support accounts>
   ```

5. Start only after review:

   ```sh
   docker compose up -d
   ```

## Access model

- Hotel users see only `Connect WhatsApp`, a QR code, and their own connection status.
- Platform support users use `/v1/platform-admin/whatsapp/*` through the Hotel API.
- The API key and WAHA base URL are never returned to the mobile/web client.
- The native WAHA Dashboard is an emergency operations tool. Reach it through an SSH
  tunnel or private VPN; do not add a public nginx route for `/dashboard`.
- The support screen exposes operational metadata only. It does not expose chats or
  message bodies.

WAHA uses WhatsApp Web rather than the official Meta Cloud API. A linked number can be
rate-limited or blocked by WhatsApp. Support must treat `WORKING` separately from delivery
errors and message-capping incidents; restarting a healthy session is not a fix for capping.

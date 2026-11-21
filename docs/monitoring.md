# Ospio Monitoring

Ospio uses the generic Monitoring ingestion contract (`Monitoring/docs/INTEGRATION.md`).
The vendored SDK is 0.3.0; copy `sdk/index.ts` and `sdk/privacy.ts` together when
updating it. Our integration adds hotel workflows, safe source locations, frozen
async scopes, session rotation and missing-registration diagnostics. The collector
contains no Ospio route or action registry.

## Account and environment setup

In Monitoring **Projects & SDK**, use one Ospio project with separate development
and production write-only keys. Web/native, public pages, API and workers must use
keys from the same project/environment to resolve shared context and views. Use
separate public and server keys; never embed a server key or dashboard password.

In **Integration settings & field coverage** for each environment:

- Select structured privacy. A collector-wide strict restriction still wins.
- Standard fields are sent directly, so no field mappings are needed. Add mappings
  only for a real, approved alternative producer format.
- Set client/server/worker service and deployed release defaults when useful.
  Events supply their own `ospio-web`, `ospio-ios`, `ospio-android`,
  `ospio-public-web`, `ospio-api`, `ospio-delivery-worker` or
  `ospio-client-worker` service; those explicit values take precedence.
- Require service, serviceVersion, placement, sessionId, contextId and sequence.
  Check userId/userName, companyId/companyName, viewId/screen/pageUrl and the HTTP
  fields where applicable. Coverage warnings expose absent facts; defaults must
  never manufacture a user, hotel, screen, hardware model or country.
- Keep sampling at 100% for full debugging. Development can retain debug events;
  production can use info. Filtering/sampling is reported through SDK diagnostics.

Copy the optional Monitoring values from the apps' `.env.example` files. Locally,
use `http://127.0.0.1:3001/api/ingest`, development keys and
`EXPO_PUBLIC_SIGNAL_ENVIRONMENT=development`. A phone needs reachable LAN/API and
collector addresses. Restart Expo after changing environment variables.
Add the actual app and public-page origins to the collector's `ALLOWED_ORIGINS`
(locally `http://localhost:8081`, `http://127.0.0.1:8081` and the corresponding
port-4000 origins). Verify OPTIONS returns an `Access-Control-Allow-Origin` matching
the browser origin; a working server-to-server upload alone does not prove browser
delivery.

`NODE_ENV` selects the API/worker environment (`test` uses development). Expo needs
an explicit environment. Missing/invalid configuration disables telemetry without
blocking startup. Production requires HTTPS and never falls back to development
keys. Public app keys are intentionally visible and grant upload access only.

Set `EXPO_PUBLIC_SIGNAL_RELEASE` to the web/native release or commit and
`SIGNAL_RELEASE` to the public-page release. Set `SIGNAL_API_RELEASE` and
`SIGNAL_WORKER_RELEASE` to the respective deployed commits; they fall back to
`SIGNAL_RELEASE`. Native app version and configured native build are separate.
Rebuild/export the client with only the intended environment's public key.

## Identity, sessions and correlation

Client startup remains `unknown` until authentication is resolved. Login and
session restoration supply the authenticated internal user ID and display name.
Loading/updating a hotel supplies its ID and name. The selected UI language is
reported separately from hotel locale. Logout/expiry clears both identities and
names and rotates the session. Account changes also rotate; late results from an
old session cannot overwrite the new account's Monitoring context.

The backend uses verified authentication and a bounded membership lookup for hotel
context. It sends `identityOverride`, including explicit empty identities when
unknown, so a client context reference cannot assign a user/hotel to an anonymous
API event. Each request and provider scope stays in request-local storage; the
shared API monitor never changes its global identity per user. Tenant lookup
failure leaves the hotel unavailable and does not change authentication results.

Navigation creates a fresh view and registers a symbolic route such as
`/app/Requests` or `/public/Offer`. Client screen and API route remain separate.
Snapshots are immutable. Async actions and requests capture their original
identity, view and context; a deliberate authentication/hotel transition rebinds
only subsequent work. One action/trace joins a workflow; every HTTP attempt has
its own request ID. Correlation references are diagnostic claims, not authorization.

Each runtime supplies an emitter ID, SDK version and emitter-local sequence.
Client session numbers count local session rotations; they are not a lifetime
account visit count. API requests without a client session have `sessionKind=request`;
API startup and worker jobs use `process`. These scopes do not invent user session
numbers or client navigation. Delivery jobs persist opaque session/action/trace
references and continue the action/trace in a worker process scope, linking the
originating user session separately. Worker tenant context comes from the job.

## Workflows and errors

Named service events cover account registration/login/reset/logout, hotel and
inventory changes, enquiry submission, manual reservation creation, offer sending
and acceptance, manual delivery recording and payment-link recording. These
observe service outcomes, not an HTTP status. Recording a payment link does not
claim a payment was received. Expired acceptance is `offer.accept.rejected`, even
when the HTML handler redirects to an expired page. Demo redirects do not claim
real acceptance. Manual review and unavailable tariffs emit an automation deferral.

Delivery events distinguish start, provider acceptance, retry, connection deferral,
unknown provider outcome and failure, with attempt, duration and a stable failure
code. Contact sync distinguishes completion from retry. Provider HTTP events use
constant operation names/templates for OAuth, mail, WhatsApp and push; SMTP sends
are instrumented as non-HTTP operations. Provider headers, bodies and dynamic
session/recipient paths are never copied to telemetry.

Caught UI errors, global JavaScript errors, unhandled promise rejections and the
React error boundary report a safe error class, stable code, failed step and code
placement. Messages are constant. Stacks retain only approved application source
paths and line/column locations, excluding exception text, function names, home
paths, queries and arbitrary remote paths. Keep release-matched source maps private
for symbolication. OS crashes/ANRs and native symbols still need a native reporter.

## Privacy and delivery

Readable staff display names and hotel names are intentional debugging identity.
Guest names/contacts, field values, private bodies, credentials, cookies, payment
details and documents are excluded. Public URLs use route templates; offer/reset
secrets and record IDs never enter names or URL paths. Browser metadata comes from
browser APIs; native hardware/OS metadata comes from Expo. Unsupported metadata
remains unavailable. Hotel country never substitutes for the user's country.

Queues are bounded to 500 events, five retries and one hour. Retries retain event
UUIDs and occurrence timestamps; the collector supplies receipt/expiry. Diagnostics
report upload rejection, queue loss, filtering, strict-privacy withholding and
missing registrations. Application requests, original errors and logout never wait
for collector uploads. Browser hide/native background uploads are best effort.
Session storage holds opaque IDs/counters only; identities and event queues stay
in memory. No application behavior depends on Monitoring being reachable.

## Verification

```bash
npm run check
npm run build --workspace @hotel/server
npm run export --workspace @hotel/mobile
npm run monitoring:smoke -- /absolute/path/to/Monitoring
```

The smoke uses the real collector with a disposable SQLite database and generated
keys. Run it with the Node version matching the collector's installed SQLite
binary. It verifies registered context/views, two screens, real authenticated
accounts and hotels, concurrent users/workflows, immutable company changes, SDK
and emitter fields, privacy, pagination, environment isolation, logout and collector
outage. It never loads application credentials or modifies the collector's live
database/settings. Unit tests additionally cover stale async responses, source
location privacy, rejected business outcomes and deferred/retried worker jobs.

Before production rollout, deploy the updated collector, configure the actual
project/environment settings and keys, and inspect a synthetic login, two screens,
a harmless reservation workflow, hotel/account change and logout. Repeat with the
collector stopped. Browser/device validation and native symbolication remain
separate from automated server checks. Deploy `/signal.js` with the existing nginx
proxy and its narrow CSP allowance. Revisit account service defaults after each
release; never use one default hotel or user for all events.

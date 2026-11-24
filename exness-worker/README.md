# Trading Assistant G — Exness read-only authentication worker

This Worker performs only two signed GET requests:

1. `GET /v1/trading/access-point?account_id=...` against `EXN_DISCOVERY_BASE_URL`.
2. `GET /v1/configuration/accounts/{account_id}/account` against the discovered account Access Point.

There are no order, position-mutation, transfer, or other write operations in this Worker.

## Important Gateway note

The requested initial value is `https://api.exness.com`. Current Exness developer documentation describes this static hostname as a review/prototype example, not a production fallback Gateway. The Worker keeps it configurable so the discovery result can be tested as requested, but an unsuccessful discovery response must not be treated as a successful connection. Replace `EXN_DISCOVERY_BASE_URL` with the exact HTTPS Gateway origin from the Key Management DNS widget if Exness rejects this host.

## Configure on Cloudflare (keep credentials private)

Create a Cloudflare Worker from this directory and configure:

- Variable `EXN_DISCOVERY_BASE_URL`: `https://api.exness.com` (initial requested value; confirm against the DNS widget).
- Variable `EXN_ACCOUNT_ID`: your Exness account ID.
- Secret `EXN_API_KEY`: public API key identifier from Key Management.
- Secret `EXN_PRIVATE_KEY`: Exness Ed25519 private signing key (128 hex characters or unencrypted PKCS#8 PEM).
- Secret `TA_SETUP_TOKEN`: generate a long random token used only to authorize the one-time test.

Never put any of these secrets in GitHub, GitHub Pages, browser JavaScript, chat, or screenshots. Set secrets with the Cloudflare dashboard or `npx wrangler secret put NAME`.

## Test

1. Deploy the Worker.
2. Open `https://YOUR-WORKER.workers.dev/health`. It should report `credentialsConfigured: true` after all four required secret/config values exist.
3. Send a POST request to `/auth-test` with header `x-setup-token: YOUR_TA_SETUP_TOKEN` and an empty body. Do this in a trusted client; do not put the token into the public dashboard.
4. The milestone passes only if the response says `milestone: passed`, `discovery: success`, and `readOnlyAccountRequest: HTTP 200`.

The endpoint returns only a minimal success report and account ID suffix; it does not return balances or account details. It does not persist or cache credentials. The Access Point is rediscovered on each test to keep this milestone simple; add a protected cache only after the first verified pass.

## Local development

Install Wrangler and run `npx wrangler dev`. Configure local secrets in a private `.dev.vars` file that is excluded from version control. Never commit `.dev.vars`.

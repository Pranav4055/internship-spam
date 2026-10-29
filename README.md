# InternShield

InternShield is a student project for reviewing internship offer emails. It provides an explainable, rule-based first-pass review of pasted email text and optional raw headers, with security and privacy controls for deployment. Reports describe indicators, not proof of fraud or legitimacy.

## Requirements

- Node.js 20.19+ or 22.12+ (the Vite version in this project requires a recent Node release)
- npm
- A MongoDB Atlas cluster for database-backed health status and rule seeding

## Local setup

1. Install dependencies from the repository root:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` in the repository root. Set `MONGODB_URI` to an Atlas URI for a database user with `read` access. Keep `.env` private; it is ignored by Git.

3. Start the frontend and API together:

   ```sh
   npm run dev
   ```

   Open the Vite URL printed by the command (normally `http://localhost:5173`). Vite proxies `/api` requests to Express on port 3000. The browser never receives the MongoDB URI.

4. Seed and enable the versioned starter detection rules:

   ```sh
   npm run seed
   ```

   Set `MONGODB_SEED_URI` to a separate Atlas user with `readWrite` access before running this command. Do not use this URI as the runtime `MONGODB_URI`.

   The Phase 3 seed upgrades the earlier disabled Phase 1 defaults once. Later runs preserve enabled/disabled choices and parameter edits for the current rule version.

The backend loads `.env` from the repository root using a path relative to its config module, including when `npm run seed` executes in the `server/` workspace. Seed failures print a fixed diagnostic category and safe next step, never the URI or raw driver error. For `DNS_RESOLVER_REFUSED`, check that the current network, VPN, and firewall allow DNS SRV queries to the configured resolver; this is separate from Atlas IP access-list configuration.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | Runtime mode |
| `PORT` | No | `3000` | Express listening port |
| `MONGODB_URI` | For the application | Empty | Private Atlas connection string for a database user with `read` access to the InternShield database |
| `MONGODB_SEED_URI` | For seeding only | Empty | Private Atlas connection string for a separate user with `readWrite` access to the InternShield database |
| `MONGODB_DB_NAME` | No | `internshield` | Database name |
| `TRUST_PROXY_HOPS` | No | `0` | Number of trusted reverse-proxy hops; set to the exact topology used by the host |

Copy `.env.example` to `.env` and configure two Atlas database users. The runtime user needs only the built-in `read` role on this database; application code only queries rules. The seed user needs `readWrite` on this database and is used only by `npm run seed`. The app does not use the seeding URI. Configure the Atlas network access list for the development machine or deployment host. Avoid broad network access when possible. If a password contains URI-reserved characters, percent-encode them in its connection string. Never commit `.env`, paste its contents into issue reports, or add either URI to frontend variables (such as `VITE_*`).

## API

- `GET /api/health` returns API and MongoDB connection status. It returns HTTP 200 when connected and HTTP 503 when disconnected or connecting. It does not include connection details or driver errors.
- `POST /api/analyze` accepts `{ "emailText": "...", "headersText": "...", "links": [{ "text": "...", "href": "..." }] }`; headers and rich-clipboard `links` are optional. Email text is limited to 48 KiB, headers to 12 KiB, and link metadata to 40 entries and 12 KiB total. Clipboard HTML itself is never sent to the backend.
- The JSON parser has a fixed 64 KiB body limit. The analysis endpoint permits 10 requests per client IP per minute per Node process and returns HTTP 429 with `Retry-After` when exceeded. This in-memory limit is not shared across multiple processes or hosts. Behind a reverse proxy, set `TRUST_PROXY_HOPS` to the exact trusted hop count; an incorrect value can make client IP handling unreliable or unsafe. Check whether the deployment platform also provides request throttling.
- A successful analysis returns `status: "complete"` and a report with `riskCategory`, `summary`, `classificationExplanation`, `findings`, `unknowns`, and `nextSteps`. Findings include rule key, category, severity, explanation, evidence, and a recommended action.
- If Atlas is disconnected, the rules collection is empty, or no supported rules are enabled, the endpoint returns HTTP 503. It never substitutes an empty rule set and presents that as a successful scan.
- Unknown `/api/*` paths return a safe JSON 404 response.

## Analysis behavior and limits

- Content rules look for combined request/context signals: payment plus an internship fee, a request plus credentials or sensitive information, explicit urgency phrases, guaranteed-outcome claims, compensation claims, and multiple missing offer details. A keyword alone does not trigger a payment or credential finding. Clear negations such as “never share your password” are excluded.
- Header checks compare From, Reply-To, and Return-Path domains. Authentication result lines, Received lines, and all other pasted headers are treated as untrusted text. A pasted SPF/DKIM/DMARC pass is never treated as verified.
- URL checks normalize and parse embedded values locally. They flag static characteristics such as unusual schemes, IP hosts, embedded credentials, punycode, shorteners, or a company domain embedded under another host. URLs are never opened, fetched, or checked against a live reputation service. Credentials, paths, and query values are not included in URL evidence.
- When a rich clipboard paste exposes `text/html`, the browser extracts only anchor text and `href` values and submits those separately from the plain-text email. The backend compares URL-like visible text with its destination host and can report a mismatch. If the browser supplies only plain text, hidden destinations are unavailable and the report says so; no destination is inferred. Third-party form hosts can be legitimate, so a mismatch is not a fraud claim.
- Company extraction is limited to explicit company/employer/organization labels and explicitly labeled official-site domains. Sender and company details are compared for consistency only. No paid service, live registry lookup, or external company verification is used.
- Classification is qualitative and deterministic: High requires a strong finding plus another strong/moderate finding in a different signal category; Medium means at least one strong or moderate finding; Low means at least eight word tokens of two or more letters or digits and no strong/moderate findings; Insufficient information means fewer than eight such tokens and no strong/moderate findings. Weak findings do not raise the category. No numeric probability is calculated, and Low is not a claim of legitimacy.

## Security and privacy

- Email text, optional headers, and extracted link text/destinations are parsed and analyzed in process memory to generate the response. Only link text and destinations (never the full clipboard HTML) are sent for analysis. Finding excerpts are sanitized before they are returned. React renders report values as text. The analysis code parses URLs locally and does not fetch them, open pages, or follow redirects.
- The app has no account, scan-history, report-write, or submission-storage code. Runtime database queries read detection rules only. Submissions and generated reports are not written by the app to MongoDB or application logs. The frontend keeps its form and temporary result in page memory; it does not use local or session storage.
- These statements describe this repository's application behavior. The hosting provider, reverse proxy, CDN, process manager, crash reporting, and network infrastructure have not been audited here. Their access logs, request-body capture, backups, or diagnostic dumps may have separate retention settings. Review and configure those services before handling sensitive email content; no claim is made about their logging or retention.
- Requests are protected with Helmet's default security headers, strict JSON parsing, a 64 KiB body limit, per-field byte limits, exact field validation, and a per-process rate limit. Errors returned to clients are generic and do not include exception text or submitted content. The app does not emit request bodies in its logs.
- The runtime Atlas credential should have only database `read` permission. The separate seed credential needs `readWrite` only while seeding. Store both in the backend environment, not frontend configuration.

## Checks

Run the server and frontend test suites, then build the production frontend:

```sh
npm test
npm run build
```

Or run tests and build with `npm run check`. Tests cover content, headers, authentication claims, URL and company signals, risk thresholds, rule availability, request validation and size limits, safe API errors, the submission form, and report rendering. Engine tests use injected rule sets and run without Atlas. A live scan and seed run require a configured `.env`, an Atlas database, and network access permitted by Atlas.

## Production deployment

Deploy the repository to a Node.js host that supports a long-running Express process and outbound TLS connections to MongoDB Atlas.

1. Configure `MONGODB_URI` using a database user with only `read` on the application database, `MONGODB_DB_NAME`, `NODE_ENV=production`, and the host-provided `PORT` as backend environment variables. Configure Atlas access for the deployment host's outbound address.
2. Install dependencies with `npm ci` and build the frontend with `npm run build`.
3. Start the application with `npm start`. Express serves `client/dist` and the `/api` routes from the same origin.
4. Configure HTTPS at the host or its managed proxy. If the app is behind a proxy, set `TRUST_PROXY_HOPS` to match the exact proxy chain and verify that the Express client IP is correct. Configure platform rate limiting and review provider logging/retention separately.
5. For initial setup or rule updates, provide `MONGODB_SEED_URI` in a secure backend environment with a user that has `readWrite` on the application database, then run `npm run seed`. Remove the seed credential from the production service environment when seeding is complete. The seed operation is repeatable and preserves existing values.

If Atlas is unavailable, the HTTP server still starts and health reports a degraded database status. The connection failure log uses a fixed diagnostic category and does not include credentials or raw driver details. Analysis returns HTTP 503 until supported detection rules can be loaded from MongoDB; it does not fall back to an empty rule set. Application code does not log or persist submitted text.

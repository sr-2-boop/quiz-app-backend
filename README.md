# Quiz Platform Backend

This repository contains the Express + MongoDB backend and question paper. Deploy it separately from the frontend
Vercel project. [`.railway/railway.ts`](./.railway/railway.ts) defines the Railway service, build/start commands,
health check, and non-secret production settings. The server includes Socket.IO and the scheduled test/attempt
sweeper.

## Deploy on Railway

Push this repository to GitHub, create an empty Railway project, install the current
[Railway CLI](https://docs.railway.com/cli) (5.42.1 or newer), and use Node.js 22 or newer. From this
repository's root, install dependencies and run:

```bash
npm ci
railway login
railway link
railway config plan
railway config apply
```

Review the plan before applying it. The IaC file links Railway to `sr-2-boop/quiz-app-backend`; it creates a
`backend` service if needed. Add the secrets below in the Railway dashboard's Variables tab before expecting a
healthy deployment. Then generate a public domain for the service. Railway supplies the listening `PORT`.

Set these required variables in the Railway service's Variables tab. Railway may start a deployment as soon as
the service is created, so it can remain unhealthy until these values are added:

- `MONGODB_URI`: MongoDB Atlas connection string. Configure Atlas network access to allow Railway.
- `JWT_SECRET`: unique random secret of at least 32 characters.
- `GOOGLE_CLIENT_ID`: Google OAuth Web client ID.
- `ADMIN_EMAILS`: comma-separated Google account emails permitted to administer the app.
- `CLIENT_ORIGIN`: exact frontend Vercel origin, without a trailing slash.

The IaC file sets `NODE_ENV=production`, `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=none`, `TRUST_PROXY=1`, and
`CODE_EXECUTION_ENABLED=false`. Set `CLIENT_ORIGIN` to the exact Vercel frontend origin (scheme + hostname,
without a path or trailing slash). CORS and Socket.IO both use this allow-list; the HTTP API and the Socket.IO
handshake both rely on the same `httpOnly` JWT cookie.

The frontend's `vercel.json` rewrites `/api/*` to this service, so the login cookie is first-party on the Vercel
domain (browsers block third-party cookies from `*.up.railway.app`). Set `TRUST_PROXY=2` so rate limits see client
IPs behind both proxies. On Vercel, set `VITE_API_URL` to the Railway public origin only, without `/api` or
`/socket.io`; the frontend uses it for the Socket.IO connection, which authenticates with a short-lived token from
`GET /api/auth/socket-token`. Redeploy Vercel after changing the variable. The frontend's
deployment README has connection checks and browser troubleshooting.

`COOKIE_SAME_SITE=none` is appropriate for separate Vercel/Railway default hostnames, but browser
third-party-cookie blocking may still prevent authentication. For more reliable cookie behavior, use custom
frontend/API domains under the same site (for example, `quiz.example.com` and `api.example.com`), set
`COOKIE_SAME_SITE=lax`, and update `CLIENT_ORIGIN` to the exact frontend domain.

Add the frontend's Vercel domain to the Google OAuth client's **Authorized JavaScript origins**. Browser
third-party-cookie restrictions may block authentication across unrelated `*.vercel.app` and Railway domains,
even with `SameSite=None`. For more reliable cookies, use custom frontend/API domains under the same site (for
example, `quiz.example.com` and `api.example.com`) and set `COOKIE_SAME_SITE=lax`. Keep `CLIENT_ORIGIN` equal
to the exact frontend origin.

## Use a Cloudflare Tunnel for local hosting

For testing without deploying the API to Railway, run the backend on your computer and expose it through
Cloudflare Tunnel. MongoDB must be reachable from that computer. Configure `.env` with `PORT=5000`, your
`MONGODB_URI`, `JWT_SECRET`, Google variables, the exact Vercel `CLIENT_ORIGIN`, `COOKIE_SECURE=true`, and
`COOKIE_SAME_SITE=none`.

In one terminal:

```bash
npm ci
npm start
```

In another terminal:

```bash
cloudflared tunnel --url http://localhost:5000
```

Set Vercel's `VITE_API_URL` to the HTTPS `trycloudflare.com` URL printed by `cloudflared`, then redeploy the
frontend. A quick-tunnel URL can change after restarting the tunnel. Your computer, backend, and tunnel must stay
online or the API and scheduled test jobs stop. Cross-site browser cookie restrictions may also prevent login
between Vercel and a `trycloudflare.com` hostname.

## Local development

```bash
npm ci
npm run dev
npm test
```

Copy `.env.example` to `.env` and configure MongoDB, JWT, and Google OAuth values. Set Railway secrets in its
dashboard; never commit `.env`.

## Question import

The [`question-papers/`](./question-papers/) folder contains the supplied C++ constructors/destructors/
encapsulation paper in the admin bulk-import JSON format. Upload the JSON in a test's **Bulk import** panel,
review the preview, and confirm the import.

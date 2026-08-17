# New Client Setup (White-Label Clone Checklist)

This repo can be redeployed as a fully independent, separately-branded bot for a
different business owner, while you (the hosting provider) keep support access
and can track their sales for a revenue-share fee. No source code changes are
needed per client — everything below is environment variables.

## 1. Create the client's own Telegram bot

- Client (or you, on their behalf) messages **@BotFather** → `/newbot` → picks a
  name and `@username` → BotFather returns a **new `BOT_TOKEN`**.
- This token is unique to their bot — never reuse a token across clients.

## 2. Deploy a new Render web service

- **New** Render web service (not a fork of the existing one) pointed at the
  **same GitHub repo** — Render lets you deploy the same repo to multiple
  independent services.
- Build command `npm install`, start command `npm start` (same as
  [render.yaml](render.yaml)).

## 3. Set the client's environment variables

Copy [.env.example](.env.example) as a starting reference. At minimum, set:

| Variable | Value |
|---|---|
| `BOT_TOKEN` | the client's new token from step 1 |
| `BRAND_NAME` | the client's business name, e.g. `Acme.Kh` |
| `BRAND_NAME_UPPER` | e.g. `ACME.KH SMM` |
| `SUPPORT_LINK` | client's own support Telegram handle |
| `CHANNEL_LINK` | client's own public channel |
| `GROUP_CHAT_ID` | client's own admin notification group/channel ID |
| `ADMIN_IDS` | client's own Telegram numeric ID(s) |
| `HOST_SUPER_ADMIN_ID` | **your** Telegram numeric ID — keeps you as admin on their bot for support & sales visibility (see below) |
| `BAKONG_ACCOUNT_ID` / `BAKONG_TOKEN` | client's own Bakong merchant account & NBC Open API token |
| `SUPABASE_URL` / `SUPABASE_KEY` | client's own Supabase project (step 4) — each client gets an isolated database |

`HOST_SUPER_ADMIN_ID` is disclosed and documented (unlike the old hardcoded
admin-backdoor bug fixed earlier in this project's history) — the client can see
it in their own Render environment settings and ask you to remove it at any
time if the hosting arrangement ends.

## 4. Create a new Supabase project for the client

- New Supabase project → run [database.sql](database.sql) against it to create
  the `users`/`orders`/`deposits` tables.
- Isolated per client — their data never mixes with another client's or with
  your own deployment's.

## 5. Verify

- Message the client's bot with `/start` — confirm it greets with **their**
  `BRAND_NAME`, not yours.
- Confirm `/admin` is reachable by the client's own `ADMIN_IDS` **and** by your
  `HOST_SUPER_ADMIN_ID`.
- Confirm a test deposit/order flow works end-to-end on their instance.

## 6. Collecting your revenue-share fee

No automated payment-splitting exists (deliberately — routing client payments
through a shared account would mean holding client funds, which is real
financial/regulatory complexity not justified for hosting a client's bot).
Instead:

- Because you hold `HOST_SUPER_ADMIN_ID` access on the client's bot, open their
  **Admin Menu → Analytics & Reports → 📈 Top-up reports** at any time to see
  their real revenue for today/this week/this month/all-time (pulled live from
  their Supabase `deposits` table).
- Invoice/collect the agreed percentage from the client directly (bank
  transfer, etc.) — outside the bot.

## Not covered by this checklist

- The WebApp portal (`website/`, root `index.html`/`app.js`/`style.css`) is
  still hardcoded to Blessing.Kh's branding and pricing. A client's bot works
  fully without it — the "Open Website Portal" buttons just wouldn't point to
  a live client-branded page unless that WebApp is separately re-themed and
  deployed for them.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Blessing.Kh" — a Telegram bot (Telegraf-based) for an SMM (social media marketing) reselling service in Cambodia, bilingual Khmer/English. Users buy TikTok/Telegram/Facebook engagement packages (likes, views, followers) using an in-app wallet funded via Bakong KHQR / ACLEDA / ABA PayWay. A companion static WebApp (opened inside Telegram) provides a richer ordering UI. There is no build step, no test suite, and no framework beyond Telegraf + a raw Node `http` server — it is one continuously-growing script.

## Commands

```bash
npm install       # install dependencies
npm start          # node index.js — runs the bot + HTTP server (same as `npm run dev`)
```

There is no lint, build, or test command configured in `package.json`. There are no automated tests in this repo — verify changes by running the bot locally against a real (or test) Telegram bot token and watching console output / interacting via Telegram.

Required env vars live in [.env.example](.env.example); copy to `.env`. Key ones: `BOT_TOKEN`, `SUPPORT_LINK`, `CHANNEL_LINK`, `GROUP_CHAT_ID` (admin notification channel), `SUPABASE_URL`/`SUPABASE_KEY` (optional — falls back to in-memory storage if absent), `BAKONG_TOKEN`/`BAKONG_ACCOUNT_ID`, `ACLEDA_API_TOKEN`/`ACLEDA_MERCHANT_ID`/`ACLEDA_API_URL`, `PAYWAY_LINK`, `WING_CLIENT_ID`/`WING_CLIENT_SECRET`/`WING_API_BASE` (Mode 5 — no daily rate limit, unlike Bakong's), `ADMIN_IDS`, `WEB_APP_URL`, `HOW_TO_ORDER_VIDEO_ID`, `BROADCAST_CHANNEL_ID`/`CHANNEL_CHAT_ID`, `PORT`. Several of these have hardcoded fallback values inline in [index.js](index.js) — treat those as defaults for local dev only, not values to rely on in production.

Deployed to Render via [render.yaml](render.yaml) (`npm install` / `npm start`, health-checked over the plain HTTP server).

## Architecture

### Single-file bot: index.js

Almost all bot logic lives in one ~3900-line file, [index.js](index.js), organized top-to-bottom in numbered comment sections (search for `// ====` banners like `1. KEYBOARDS LAYOUT`, `2. BILINGUAL MESSAGES DICTIONARY`, `3. BOT COMMANDS & HANDLERS`, `4. ELEGANT ADMIN CONTROL PANEL SYSTEM`, `5. DEPOSIT CONFIRMATION & ADMIN APPROVAL CALLBACKS`). When adding a feature, find the matching section rather than appending at the end.

Rough top-to-bottom layout:
1. **Setup & optional integrations** — Telegraf init, `@supabase/supabase-js` and `bakong-khqr` are both `require`'d inside `try/catch` so the bot still boots if those packages/services are unavailable (falls back to local memory / manual KHQR string building).
2. **Payment helpers** — `checkBakongTransaction`, `fetchBakongApiKhqrString` (Bakong Open API), `checkAcledaTransaction` (ACLEDA xPay), `crc16` + `generateDynamicKhqr` (manual EMVCo KHQR payload builder used when the SDK/API path fails).
3. **Automated payment engine** — `pendingAutoDeposits` / `userLastPendingDeposit` in-memory maps + `startAutoPaymentEngine()` (a `setInterval` polling Bakong/ACLEDA every 7s) auto-credit a user's wallet without any button click, then DM the user and post to the admin channel. The raw `http.createServer` at the bottom also accepts ABA PayWay webhook POSTs (`/payway`, `/callback`, `/webhook` in the URL) that do the same auto-credit flow.
4. **State & data layer** — see below.
5. **Keyboards & bilingual messages** — `getMainKeyboard(lang)`, `getPlatformsKeyboard`, `getTikTokServicesKeyboard`, etc. build Telegraf `Markup` reply keyboards per language; message strings are picked by `lang` (`'km'`/`'en'`) inline (no i18n library — every string is duplicated per language at the call site).
6. **Bot command/handler registration** — `bot.start`, many `bot.hears([...])` (button-label matching, both Khmer and English label variants passed in the same array) and `bot.action(...)` (inline-keyboard callback_data) handlers, plus one large catch-all `bot.on('text', ...)` that interprets free-text input based on `userState[userId].step`.
7. **Admin control panel** — a parallel set of `bot.hears`/`bot.action` handlers gated by `isAdmin(userId)`, reachable via `/admin` or the "🔐 Admin Menu" button: manage users/balances, edit package prices, edit how-to-order media/links, toggle payment modes (ACLEDA/Bakong/PayWay), broadcast messages, approve/reject deposits and orders.
8. **Bot launch + HTTP server** — `launchBot()` (with auto-retry on failure), then a plain `http.createServer` that (a) handles payment webhooks, (b) serves the static WebApp files (`index.html`/`style.css`/`app.js`, preferring `website/` subfolder over repo root — see below), and (c) responds to Render health checks. A `setInterval` self-pings the server every 5 minutes to prevent the free Render instance from sleeping.

### State management (all in-memory, no session middleware)

Plain module-level objects keyed by Telegram `userId`, defined near the top of `index.js`:
- `userState` — the multi-step conversation state machine. A handler sets `userState[userId] = { step: 'AWAITING_X', ...extra }`, and the catch-all `bot.on('text', ...)` switches on `state.step` to interpret the next free-text message (deposit amount, admin credit/deduct amount, order target link, price edits, etc.), then deletes the state when the flow completes/cancels. When adding a new multi-step input flow, follow this same set-step → read-in-`bot.on('text')` → delete-step pattern.
- `userBalances`, `userLang`, `userOrdersCount` — simple caches, backed by Supabase when configured (see `dbGetUser`, `dbUpdateBalance`, `dbUpdateLanguage`, `dbCreateOrder`) and otherwise purely in-memory (reset on restart).
- `pendingAutoDeposits`, `userLastPendingDeposit` — in-flight deposit tracking for the auto-payment engine, described above.

### Persistence: Supabase (optional) with in-memory fallback

`supabase` client is created only if `SUPABASE_URL`/`SUPABASE_KEY` are set and valid; otherwise all `db*` helper functions in `index.js` (`dbGetUser`, `dbUpdateBalance`, `dbUpdateLanguage`, `dbCreateOrder`) no-op past the DB call and the module-level state objects above are the source of truth for the process lifetime. The Postgres schema (users/orders/deposits tables) is in [database.sql](database.sql) — run it against a Supabase project before enabling `SUPABASE_URL`/`SUPABASE_KEY`.

### Dynamic config stored as JSON files

Some admin-editable settings persist to small JSON files next to `index.js` rather than the database, loaded/saved via matching `load*`/`save*` function pairs:
- [packages_config.json](packages_config.json) — dynamic package pricing (`loadDynamicPackages`/`saveDynamicPackages`, `updateDynamicPackagePrice`).
- [howto_config.json](howto_config.json) — "how to order" video/link config (`loadHowtoConfig`/`saveHowtoConfig`).
- [media_config.json](media_config.json) — cached Telegram file IDs for media (`loadMediaConfig`/`saveMediaConfig`).

These files are working state, not templates — edits made through the admin bot menu write directly to them.

### Two near-duplicate WebApp copies

The Telegram WebApp UI exists in **two copies** with the same three files: [index.html](index.html)/[style.css](style.css)/[app.js](app.js) at the repo root, and an identical set under [website/](website/) (see [website/README.md](website/README.md)). The HTTP server in `index.js` serves whichever copy exists under `website/` first, falling back to the repo root copy. When editing the WebApp UI, check which copy is actually being served (or update both) to avoid changes silently not taking effect.

### Admin identification

`isAdmin(userId)` checks the numeric Telegram user ID against `ADMIN_IDS` (comma-separated env var) — update that env var, not code, to change who has admin access.

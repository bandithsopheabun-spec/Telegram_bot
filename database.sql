-- Supabase / PostgreSQL Schema for LazR SMM Telegram Bot

-- 1. Users Table
CREATE TABLE IF NOT EXISTS public.users (
    telegram_id BIGINT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    language_code VARCHAR(10) DEFAULT 'km',
    balance NUMERIC(10,2) DEFAULT 0.00 NOT NULL,
    total_spent NUMERIC(10,2) DEFAULT 0.00 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Orders Table
CREATE TABLE IF NOT EXISTS public.orders (
    id SERIAL PRIMARY KEY,
    order_id TEXT UNIQUE NOT NULL,
    telegram_id BIGINT REFERENCES public.users(telegram_id),
    package_name TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    target_link TEXT NOT NULL,
    status TEXT DEFAULT 'Processing',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Deposits Table
CREATE TABLE IF NOT EXISTS public.deposits (
    id SERIAL PRIMARY KEY,
    deposit_id TEXT UNIQUE NOT NULL,
    telegram_id BIGINT REFERENCES public.users(telegram_id),
    amount NUMERIC(10,2) NOT NULL,
    bonus NUMERIC(10,2) DEFAULT 0.00,
    status TEXT DEFAULT 'Pending',
    md5_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Migration for existing databases created before md5_hash was added:
-- lets the auto-payment engine recover in-flight ("Pending") deposits after
-- a server restart, instead of forgetting them (see rehydratePendingDeposits
-- in index.js) — without this column a real customer payment made while the
-- server happened to restart would never get auto-credited.
ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS md5_hash TEXT;

-- 4. Bot Settings Table — small generic key/value store for admin-editable
-- settings that need to survive a redeploy, where Render's filesystem is
-- ephemeral (rebuilt fresh from git on every deploy — anything written to
-- local disk at runtime, like the Mode 1 QR photo, is lost). Currently used
-- to persist the base64-encoded Mode 1 QR photo (key: 'mode1_qr_photo'),
-- rehydrated back to disk on boot by rehydrateMode1QrPhoto() in index.js.
CREATE TABLE IF NOT EXISTS public.bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Problem Tickets Table — logs every "❓ Other Reason" explanation Admin
-- sends a customer about their order (e.g. "violates TikTok's Terms of
-- Service"), so Admin/Users & Balances can show a per-customer resolution
-- history. A row starts 'Open' and moves to 'Resolved (Done)' or
-- 'Resolved (Cancel/Refund)' once Admin presses the matching button on the
-- original order card (see postProblemTicket/resolveProblemTicket in
-- index.js). Independent of the Blessing.Kh_Problem_Solve Telegram ticket
-- message itself, which is deleted on resolution rather than kept.
CREATE TABLE IF NOT EXISTS public.problem_tickets (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id TEXT NOT NULL,
    telegram_id BIGINT NOT NULL,
    package_name TEXT,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'Open',
    admin_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    -- Which PRESET_ORDER_REASONS key created this ticket ('tiktok',
    -- 'private', 'wronglink', 'underage', 'deleted', or 'custom' for a
    -- free-typed reason) — lets startProblemTicketTimeoutSweep in index.js
    -- target only 'underage' tickets for its 48h auto Cancel/Refund
    -- without matching on the (language-dependent) reason text.
    preset_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_problem_tickets_telegram_id ON public.problem_tickets(telegram_id);
CREATE INDEX IF NOT EXISTS idx_problem_tickets_order_id ON public.problem_tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_problem_tickets_preset_key ON public.problem_tickets(preset_key);

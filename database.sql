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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

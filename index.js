require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const path = require('path');
const fs = require('fs');
const http = require('http');

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
    console.error('❌ BOT_TOKEN is not set in .env — the bot cannot start without it.');
    process.exit(1);
}
const bot = new Telegraf(botToken);

// Brand Name Configuration — lets this codebase be redeployed ("cloned") for a
// different business by only changing env vars, no source edits needed.
const BRAND_NAME = process.env.BRAND_NAME || 'Blessing.Kh';
const BRAND_NAME_UPPER = process.env.BRAND_NAME_UPPER || 'BLESSING.KH SMM';

// Support Link & Channel Link Configuration
const SUPPORT_LINK = (process.env.SUPPORT_LINK && !process.env.SUPPORT_LINK.includes('LazR') && !process.env.SUPPORT_LINK.includes('retanakpich')) ? process.env.SUPPORT_LINK : '@Blessing_Kh_Supports';
const CHANNEL_LINK = process.env.CHANNEL_LINK || 'https://t.me/Blessing_Kh_Public/3';
const TARGET_ADMIN_CHAT_ID = process.env.GROUP_CHAT_ID ? parseInt(process.env.GROUP_CHAT_ID) : -1003953732694;

// Supabase Client Setup (Optional & Safe)
let createClient = null;
try {
    createClient = require('@supabase/supabase-js').createClient;
} catch (e) {
    console.log('Notice: @supabase/supabase-js module not found locally, running with fallback');
}

let BakongKHQR = null;
let KHQRIndividualInfo = null;
let khqrDataConst = null;
try {
    const khqrLib = require('bakong-khqr');
    BakongKHQR = khqrLib.BakongKHQR;
    KHQRIndividualInfo = khqrLib.IndividualInfo;
    khqrDataConst = khqrLib.khqrData;
} catch (e) {
    console.log('Notice: bakong-khqr module loading safely...');
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let supabase = null;

if (createClient && supabaseUrl && supabaseKey && supabaseUrl.startsWith('http')) {
    try {
        supabase = createClient(supabaseUrl, supabaseKey);
        console.log('🗄️ Supabase Database connected successfully!');
    } catch (e) {
        console.error('⚠️ Supabase connection error:', e.message);
    }
} else {
    console.log('💡 Running with local memory storage (Set SUPABASE_URL & SUPABASE_KEY to enable Postgres DB persistence)');
}

// Bakong Open API Helper Function
async function checkBakongTransaction(md5Hash) {
    const token = process.env.BAKONG_TOKEN;
    if (!token || !md5Hash) return false;

    try {
        const response = await fetch('https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ md5: md5Hash.toLowerCase() })
        });
        const result = await response.json();
        console.log('📌 Bakong Check MD5 Result:', JSON.stringify(result));
        if (result && (result.responseCode === 0 || result.responseCode === '0' || result.code === 0) && result.data) {
            return true;
        }
        return false;
    } catch (err) {
        console.error('⚠️ Bakong Open API Check error:', err.message);
        return false;
    }
}

async function fetchBakongApiKhqrString(merchantId, amount, depositId) {
    const token = process.env.BAKONG_TOKEN;
    if (!token) return null;

    try {
        const res = await fetch('https://api-bakong.nbc.gov.kh/v1/generate_khqr', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                bakongAccountId: (merchantId || 'bun_bandithsophea@bkrt').trim(),
                accountName: BRAND_NAME,
                amount: amount,
                transactionAmount: amount,
                currency: 'USD',
                merchantCity: 'Phnom Penh',
                billNumber: depositId,
                storeLabel: BRAND_NAME_UPPER,
                terminalLabel: BRAND_NAME_UPPER
            })
        });
        const data = await res.json();
        console.log('📌 Bakong Open API Generate Response:', JSON.stringify(data));

        if (data) {
            if (typeof data.data === 'string' && data.data.startsWith('000201')) return data.data;
            if (data.data && typeof data.data.qr === 'string') return data.data.qr;
            if (data.data && typeof data.data.khqr === 'string') return data.data.khqr;
            if (data.data && typeof data.data.md5 === 'string' && data.data.qrData) return data.data.qrData;
            if (typeof data.qr === 'string') return data.qr;
            if (typeof data.khqr === 'string') return data.khqr;
        }
    } catch (e) {
        console.error('⚠️ Bakong API Generate KHQR error:', e.message);
    }
    return null;
}

// ACLEDA Bank Toanchet Pay / xPay API Auto-Verification Helper Function
let isAcledaPaymentOn = true;
let acledaApiToken = process.env.ACLEDA_API_TOKEN || '';
let acledaMerchantId = process.env.ACLEDA_MERCHANT_ID || 'lasa_leng@aclb';
let bakongAccountId = process.env.BAKONG_ACCOUNT_ID || 'bun_bandithsophea@bkrt';

async function checkAcledaTransaction(depositId, amount) {
    const token = process.env.ACLEDA_API_TOKEN || acledaApiToken;
    const merchantId = process.env.ACLEDA_MERCHANT_ID || acledaMerchantId;
    if (!token) return false;

    try {
        const apiUrl = process.env.ACLEDA_API_URL || 'https://api.acledabank.com.kh/v1/transaction/verify';
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                merchant_id: merchantId,
                bill_number: depositId,
                amount: amount
            })
        });
        const result = await response.json();
        return result.responseCode === '00' || result.status === 'SUCCESS' || result.code === 200;
    } catch (err) {
        console.error('⚠️ ACLEDA API Check error:', err.message);
        return false;
    }
}

// Dynamic EMVCo KHQR Generator Helper with CRC16 Checksum for Bakong & ACLEDA
function crc16(str) {
    let crc = 0xFFFF;
    for (let c = 0; c < str.length; c++) {
        crc ^= str.charCodeAt(c) << 8;
        for (let i = 0; i < 8; i++) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

function generateDynamicKhqr(merchantId, merchantName, amount, depositId) {
    const cleanMerchant = (merchantId || 'bun_bandithsophea@bkrt').trim();
    const cleanName = (merchantName || 'BANDITHSOPHEA BUN').trim().slice(0, 25);
    const amtNum = parseFloat(amount);
    const amtStr = amtNum.toFixed(2);
    const cleanDep = depositId.replace(/[^a-zA-Z0-9]/g, '');

    // 1. Try the official NBC BakongKHQR SDK (correct class-based API — generateIndividual()
    //    on an instance, taking an IndividualInfo object, not a static .generate.individual()
    //    call with positional args; that method never existed on this package).
    if (BakongKHQR && KHQRIndividualInfo && khqrDataConst) {
        try {
            const individualInfo = new KHQRIndividualInfo(cleanMerchant, cleanName, 'Phnom Penh', {
                currency: khqrDataConst.currency.usd,
                amount: amtNum,
                mobileNumber: '0979862190',
                storeLabel: BRAND_NAME,
                terminalLabel: BRAND_NAME,
                billNumber: cleanDep,
                // Dynamic (amount-bearing) KHQR requires an expiration timestamp (ms epoch) —
                // matches the 30-minute pending-deposit window used elsewhere in this file.
                expirationTimestamp: Date.now() + 30 * 60 * 1000
            });
            const response = new BakongKHQR().generateIndividual(individualInfo);
            if (response && response.status && response.status.code === 0 && response.data && response.data.qr) {
                console.log('📌 Official BakongKHQR SDK Generated QR successfully!');
                return response.data.qr;
            }
            console.error('⚠️ BakongKHQR SDK returned an error status:', JSON.stringify(response && response.status));
        } catch (err) {
            console.error('⚠️ Official BakongKHQR SDK generate error:', err.message);
        }
    }

    // 2. Manual EMVCo/KHQR builder fallback — Tag 29 sub-field 00 holds the raw Bakong
    // Account ID directly (per the official SDK's GlobalUniqueIdentifier), NOT a domain
    // string. (A previous version wrongly nested a "km.gov.nbc.bakong" domain string here,
    // producing an unscannable QR.)
    const sub00 = '00' + String(cleanMerchant.length).padStart(2, '0') + cleanMerchant;
    const tag29 = '29' + String(sub00.length).padStart(2, '0') + sub00;

    const tag00 = '000201';
    const tag01 = '010212'; // Dynamic QR (12)
    const tag52 = '52045999'; // Merchant Category Code
    const tag53 = '5303840'; // Currency Code: USD (840)
    const tag54Str = '54' + String(amtStr.length).padStart(2, '0') + amtStr;
    const tag58 = '5802KH'; // Country Code: KH
    const tag59Str = '59' + String(cleanName.length).padStart(2, '0') + cleanName;
    const tag60 = '6010Phnom Penh';

    const sub62_01 = '01' + String(cleanDep.length).padStart(2, '0') + cleanDep;
    const tag62 = '62' + String(sub62_01.length).padStart(2, '0') + sub62_01;

    const rawPayload = tag00 + tag01 + tag29 + tag52 + tag53 + tag54Str + tag58 + tag59Str + tag60 + tag62 + '6304';
    const checksum = crc16(rawPayload);

    return rawPayload + checksum;
}

// ==========================================
// WEB LOGIN (Telegram Login Widget) + SESSIONS
// For the standalone web ordering site (website/) — verifies the data the
// official Telegram Login Widget returns, per Telegram's documented algorithm:
// https://core.telegram.org/widgets/login#checking-authorization
// ==========================================
function verifyTelegramLoginData(data) {
    const { hash, ...rest } = data || {};
    if (!hash) return false;

    const checkString = Object.keys(rest)
        .filter(k => rest[k] !== undefined && rest[k] !== null)
        .sort()
        .map(k => `${k}=${rest[k]}`)
        .join('\n');

    const secretKey = require('crypto').createHash('sha256').update(botToken).digest();
    const computedHash = require('crypto').createHmac('sha256', secretKey).update(checkString).digest('hex');

    if (computedHash !== hash) return false;

    // Reject stale login data (replay protection) — older than 24 hours
    const authDate = parseInt(rest.auth_date, 10);
    if (!authDate || (Date.now() / 1000 - authDate) > 86400) return false;

    return true;
}

// Verifies the `initData` string Telegram's WebApp SDK provides when the site
// is opened from inside Telegram itself (via a button.webApp(...) button) —
// a different, silent auth path from the Login Widget above, which Telegram
// does not support rendering inside its own in-app browser (shows "Bot
// domain invalid" there). Algorithm: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyTelegramWebAppInitData(initDataStr) {
    if (!initDataStr) return null;
    try {
        const params = new URLSearchParams(initDataStr);
        const hash = params.get('hash');
        if (!hash) return null;
        params.delete('hash');

        const checkString = Array.from(params.keys())
            .sort()
            .map(k => `${k}=${params.get(k)}`)
            .join('\n');

        const secretKey = require('crypto').createHmac('sha256', 'WebAppData').update(botToken).digest();
        const computedHash = require('crypto').createHmac('sha256', secretKey).update(checkString).digest('hex');

        if (computedHash !== hash) return null;

        const authDate = parseInt(params.get('auth_date'), 10);
        if (!authDate || (Date.now() / 1000 - authDate) > 86400) return null;

        const userJson = params.get('user');
        if (!userJson) return null;
        const user = JSON.parse(userJson);
        return user && user.id ? user : null;
    } catch (e) {
        return null;
    }
}

// sessionToken -> { telegramId, expiresAt }
const webSessions = new Map();
const WEB_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function createWebSession(telegramId) {
    const token = require('crypto').randomBytes(32).toString('hex');
    webSessions.set(token, { telegramId, expiresAt: Date.now() + WEB_SESSION_TTL_MS });
    return token;
}

function parseCookies(req) {
    const header = req.headers.cookie;
    const out = {};
    if (!header) return out;
    header.split(';').forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx === -1) return;
        out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    });
    return out;
}

function getSessionUserId(req) {
    const cookies = parseCookies(req);
    const token = cookies['blessing_session'];
    if (!token) return null;
    const session = webSessions.get(token);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
        webSessions.delete(token);
        return null;
    }
    return session.telegramId;
}

// 100% FULLY AUTOMATED BACKGROUND PAYMENT ENGINE (NO CUSTOMER BUTTON CLICK NEEDED)
const pendingAutoDeposits = {};
const userLastPendingDeposit = {};

function registerPendingAutoDeposit(depositId, userId, amount, bonusAmount, md5Hash, mode = 'BAKONG') {
    const item = {
        depositId,
        userId,
        amount,
        bonusAmount,
        totalCredit: amount + bonusAmount,
        md5Hash,
        mode, // which channel this deposit expects to be settled through —
              // lets the background poller skip Bakong/ACLEDA checks for
              // entries that will only ever be settled by a webhook (PAYWAY)
        createdAt: Date.now()
    };
    pendingAutoDeposits[depositId] = item;
    userLastPendingDeposit[userId] = item;

    // Persist md5_hash so a server restart (redeploy) doesn't silently forget
    // an in-flight deposit that the customer has already paid — previously
    // pendingAutoDeposits only lived in memory, so any restart between QR
    // generation and payment meant the auto-payment engine could never match
    // the transaction again even though the money had arrived.
    if (supabase) {
        supabase.from('deposits')
            .update({ md5_hash: md5Hash })
            .eq('deposit_id', depositId)
            .then(() => {})
            .catch(() => {});
    }
}

// Re-populate pendingAutoDeposits from Supabase on boot — recovers in-flight
// deposits that were still "Pending" when the process last restarted (see
// registerPendingAutoDeposit above). Requires the deposits.md5_hash column;
// silently no-ops if that column doesn't exist yet (older DB not migrated).
async function rehydratePendingDeposits() {
    if (!supabase) return;
    try {
        const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { data, error } = await supabase
            .from('deposits')
            .select('deposit_id, telegram_id, amount, bonus, md5_hash, created_at')
            .eq('status', 'Pending')
            .not('md5_hash', 'is', null)
            .gte('created_at', cutoff);

        if (error || !data) return;

        for (const dep of data) {
            if (pendingAutoDeposits[dep.deposit_id]) continue;
            pendingAutoDeposits[dep.deposit_id] = {
                depositId: dep.deposit_id,
                userId: dep.telegram_id,
                amount: parseFloat(dep.amount),
                bonusAmount: parseFloat(dep.bonus || 0),
                totalCredit: parseFloat(dep.amount) + parseFloat(dep.bonus || 0),
                md5Hash: dep.md5_hash,
                createdAt: new Date(dep.created_at).getTime()
            };
        }
        if (data.length > 0) {
            console.log(`✅ Rehydrated ${data.length} pending deposit(s) from Supabase after restart`);
        }
    } catch (e) {
        console.error('⚠️ rehydratePendingDeposits error:', e.message);
    }
}

// NBC's Bakong Open API allows only 100 requests/day per token (discovered
// the hard way: a customer's real, successful payment sat un-credited all
// day because the 7s-interval polling had already burned through the daily
// quota from testing — NBC returned errorCode 17 "Daily request limit of 100
// exceeded" and every subsequent check silently failed the same way). This
// budget guard stops calling once we're close to the limit instead of
// wasting the remaining quota on calls NBC will just reject anyway, and logs
// clearly so this is diagnosable without a manual API probe next time.
let bakongApiCallsToday = 0;
let bakongApiBudgetDate = new Date().toDateString();
const BAKONG_DAILY_CALL_BUDGET = 90; // stay under NBC's 100/day, leave headroom for manual "I've paid" checks

function canCallBakongApi() {
    const today = new Date().toDateString();
    if (today !== bakongApiBudgetDate) {
        bakongApiBudgetDate = today;
        bakongApiCallsToday = 0;
    }
    return bakongApiCallsToday < BAKONG_DAILY_CALL_BUDGET;
}

let autoPayInterval = null;
function startAutoPaymentEngine() {
    if (autoPayInterval) return;
    autoPayInterval = setInterval(async () => {
        const depKeys = Object.keys(pendingAutoDeposits);
        if (depKeys.length === 0) return;

        if (!canCallBakongApi()) {
            console.log('⚠️ Bakong API daily call budget reached — skipping this auto-payment cycle (deposits stay Pending until admin approves or tomorrow).');
            return;
        }

        const now = Date.now();
        for (const depId of depKeys) {
            const item = pendingAutoDeposits[depId];

            // Expire pending auto check after 30 minutes
            if (now - item.createdAt > 30 * 60 * 1000) {
                delete pendingAutoDeposits[depId];
                continue;
            }

            // PayWay deposits settle exclusively via the ABA webhook (POST
            // /payway) — their md5Hash isn't a real KHQR hash and will never
            // match a Bakong transaction, so checking it here would only
            // waste the daily Bakong quota for nothing. Leave the entry in
            // place (the webhook handler still needs to find it) but skip
            // the check.
            if (item.mode === 'PAYWAY') continue;

            // Check Bakong & ACLEDA Open APIs in background
            bakongApiCallsToday++;
            const isBakongVerified = await checkBakongTransaction(item.md5Hash);
            const isAcledaVerified = isAcledaPaymentOn ? await checkAcledaTransaction(depId, item.amount) : false;

            if (isBakongVerified || isAcledaVerified) {
                delete pendingAutoDeposits[depId];
                const userId = item.userId;
                const currentBal = getBalance(userId);
                const newBal = currentBal + item.totalCredit;
                await dbUpdateBalance(userId, newBal);

                if (supabase) {
                    try {
                        await supabase.from('deposits').update({ status: 'Approved (Auto-Paid)' }).eq('deposit_id', depId);
                    } catch (e) {}
                }

                // AUTOMATICALLY NOTIFY CUSTOMER INSTANTLY!
                const uLang = getLang(userId);
                const autoSuccessMsg = uLang === 'en' ?
                    `🎉 <b>Auto-Payment Successful!</b>\n` +
                    `----------------------------------------\n` +
                    `💳 <b>Deposit Amount:</b> $${item.amount.toFixed(2)} USD\n` +
                    `🎁 <b>Bonus Added:</b> +$${item.bonusAmount.toFixed(2)} USD\n` +
                    `💰 <b>New Balance:</b> <b>$${newBal.toFixed(2)} USD</b>\n\n` +
                    `⚡ <i>Your wallet has been automatically credited! You can place orders now.</i>` :
                    `🎉 <b>ទូទាត់ប្រាក់ជោគជ័យស្វ័យប្រវត្តិ (Auto-Payment Successful)!</b>\n` +
                    `----------------------------------------\n` +
                    `💳 <b>ចំនួនប្រាក់ទូទាត់ ៖</b> $${item.amount.toFixed(2)} USD\n` +
                    `🎁 <b>Bonus ទទួលបាន ៖</b> +$${item.bonusAmount.toFixed(2)} USD\n` +
                    `💰 <b>តុល្យភាពបច្ចុប្បន្ន ៖</b> <b>$${newBal.toFixed(2)} USD</b>\n\n` +
                    `⚡ <i>ប្រព័ន្ធបានបញ្ចូលលុយចូលកាបូបលុយរបស់អ្នកស្វ័យប្រវត្តិ ១០០% រួចរាល់ហើយ!</i>`;

                try {
                    await bot.telegram.sendMessage(userId, autoSuccessMsg, { parse_mode: 'HTML' });
                } catch (e) {}

                // NOTIFY ADMIN CHANNEL (-1003953732694)
                const channelMsg = 
                    `⚡ <b>AUTO-PAYMENT APPROVED (100% Automated)!</b>\n` +
                    `----------------------------------------\n` +
                    `🆔 <b>Deposit ID:</b> <code>#${depId}</code>\n` +
                    `📲 <b>User ID:</b> <code>${userId}</code>\n` +
                    `💵 <b>Amount:</b> $${item.amount.toFixed(2)} USD\n` +
                    `🎁 <b>Bonus:</b> +$${item.bonusAmount.toFixed(2)} USD\n` +
                    `💰 <b>Total Credited:</b> $${item.totalCredit.toFixed(2)} USD\n` +
                    `🟢 <b>Status:</b> Auto-Approved ⚡`;

                try {
                    await bot.telegram.sendMessage(TARGET_ADMIN_CHAT_ID, channelMsg, { parse_mode: 'HTML' });
                } catch (e) {}
            }
        }
    }, 60000); // 60s, not 7s — see BAKONG_DAILY_CALL_BUDGET comment above
}

rehydratePendingDeposits().then(startAutoPaymentEngine).catch(startAutoPaymentEngine);

// User State & Preferences Storage (In-memory cache + DB fallback)
const userState = {};
const userBalances = {};
const userLang = {}; // 'km' or 'en'
const userOrdersCount = {};

function getLang(userId) {
    return userLang[userId] || 'km'; // Default to Khmer
}

function getBalance(userId) {
    return userBalances[userId] || 0.0;
}

function setBalance(userId, amount) {
    userBalances[userId] = amount;
}

function getOrdersCount(userId) {
    return userOrdersCount[userId] || 0;
}

// Database Persistence Helpers
async function dbGetUser(userId, firstName, username) {
    if (!userLang[userId]) userLang[userId] = 'km';
    if (userBalances[userId] === undefined) userBalances[userId] = 0.0;

    if (!supabase) return { balance: userBalances[userId], lang: userLang[userId] };

    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_id', userId)
            .maybeSingle();

        if (data) {
            userBalances[userId] = parseFloat(data.balance || 0);
            if (data.language_code) userLang[userId] = data.language_code;
            return data;
        }

        // Create new user if not exists
        const { data: newUser } = await supabase
            .from('users')
            .insert([{
                telegram_id: userId,
                first_name: firstName || 'User',
                username: username || '',
                balance: 0.00,
                language_code: 'km'
            }])
            .select()
            .maybeSingle();

        return newUser || { balance: 0, lang: 'km' };
    } catch (err) {
        console.error('⚠️ dbGetUser error:', err.message);
        return { balance: userBalances[userId], lang: userLang[userId] };
    }
}

async function dbUpdateBalance(userId, newBalance) {
    userBalances[userId] = newBalance;
    if (!supabase) return;
    try {
        await supabase
            .from('users')
            .update({ balance: newBalance })
            .eq('telegram_id', userId);
    } catch (err) {
        console.error('⚠️ dbUpdateBalance error:', err.message);
    }
}

async function dbUpdateLanguage(userId, lang) {
    userLang[userId] = lang;
    if (!supabase) return;
    try {
        await supabase
            .from('users')
            .update({ language_code: lang })
            .eq('telegram_id', userId);
    } catch (err) {
        console.error('⚠️ dbUpdateLanguage error:', err.message);
    }
}

const userOrdersCache = {}; // Local memory order history cache

async function dbCreateOrder(userId, orderId, packageName, price, targetLink) {
    userOrdersCount[userId] = (userOrdersCount[userId] || 0) + 1;
    const newOrder = {
        order_id: orderId,
        telegram_id: userId,
        package_name: packageName,
        price: price,
        target_link: targetLink,
        status: 'Processing',
        created_at: new Date().toISOString()
    };

    userOrdersCache[userId] = userOrdersCache[userId] || [];
    userOrdersCache[userId].unshift(newOrder);

    if (!supabase) return;
    try {
        await supabase
            .from('orders')
            .insert([newOrder]);
    } catch (err) {
        console.error('⚠️ dbCreateOrder error:', err.message);
    }
}

// Shared order-finalization logic — used by both the Telegram AWAITING_LINK
// text handler and the web API's POST /api/orders, so the money-moving logic
// (balance check, deduction, order record, admin notification) lives in one
// place instead of being duplicated per channel.
async function finalizeOrder(userId, packageTitle, price, targetLink, customerFirstName) {
    const currentBalance = getBalance(userId);
    if (currentBalance < price) {
        return { success: false, error: 'insufficient_balance', currentBalance };
    }

    const newBalance = currentBalance - price;
    await dbUpdateBalance(userId, newBalance);

    const orderId = `#ORD-${Math.floor(100000 + Math.random() * 900000)}`;
    await dbCreateOrder(userId, orderId, packageTitle, price, targetLink);

    const cleanOrderId = orderId.replace('#', '');
    const groupOrderMsg =
        `🛒 <b>មានការបញ្ជាទិញថ្មី (New Order Placed)!</b>\n` +
        (isReseller(userId) ? `🏅 <b>Reseller Order (-${resellerDiscountPercent}% wholesale)</b>\n` : '') +
        `----------------------------------------\n` +
        `🆔 <b>Order ID:</b> <code>${orderId}</code>\n` +
        `📲 <b>User ID:</b> <code>${userId}</code>\n` +
        `👤 <b>Customer:</b> ${customerFirstName || 'Customer'}\n` +
        `📦 <b>Package:</b> ${packageTitle}\n` +
        `💵 <b>Price:</b> $${price.toFixed(2)} USD\n` +
        `🔗 <b>Link:</b> ${targetLink}\n` +
        `🟢 <b>Status:</b> <b>Processing ⚡</b>`;

    const doneOrderKb = Markup.inlineKeyboard([
        [Markup.button.callback('✅ ចុចបញ្ចប់ការទិញ (Done)', `done_order_${cleanOrderId}_${userId}`)],
        [Markup.button.callback('❌ បោះបង់ & វេរលុយសង (Cancel/Refund)', `cancel_order_${cleanOrderId}_${userId}`)]
    ]);

    try {
        await bot.telegram.sendMessage(TARGET_ADMIN_CHAT_ID, groupOrderMsg, {
            parse_mode: 'HTML',
            ...doneOrderKb
        });
        console.log('✅ Sent new order notification to Admin Private Channel!');
    } catch (e) {
        console.error('⚠️ Could not send order notification to admin channel:', e.message);
    }

    // Customer confirmation — always sent as a Telegram DM regardless of
    // whether the order came from the bot chat or the website, so the
    // experience (and a permanent record in their Telegram chat) is
    // identical on both channels.
    const lang = getLang(userId);
    const successMsg = lang === 'km' ?
        `✅ <b>បញ្ជាទិញជោគជ័យ! (Order Successful)</b>\n\n` +
        `🆔 <b>Order ID:</b> <code>${orderId}</code>\n` +
        `📦 <b>Package:</b> ${packageTitle}\n` +
        `🔗 <b>Link:</b> ${targetLink}\n` +
        `💸 <b>កាត់ប្រាក់៖</b> $${price.toFixed(2)} USD\n` +
        `💰 <b>តុល្យភាពនៅសល់៖</b> $${newBalance.toFixed(2)} USD\n\n` +
        `⚡ ប្រព័ន្ធកំពុងដំណើការបន្ថែមជូនអ្នក...` :
        `✅ <b>Order Successful!</b>\n\n` +
        `🆔 <b>Order ID:</b> <code>${orderId}</code>\n` +
        `📦 <b>Package:</b> ${packageTitle}\n` +
        `🔗 <b>Link:</b> ${targetLink}\n` +
        `💸 <b>Deducted:</b> $${price.toFixed(2)} USD\n` +
        `💰 <b>Remaining Balance:</b> $${newBalance.toFixed(2)} USD\n\n` +
        `⚡ Processing your order now...`;

    try {
        await bot.telegram.sendMessage(userId, successMsg, { parse_mode: 'HTML', ...getMainKeyboard(lang) });
    } catch (e) {
        console.error('⚠️ Could not DM order confirmation to customer:', e.message);
    }

    return { success: true, orderId, newBalance };
}

// ==========================================
// 1. KEYBOARDS LAYOUT (DYNAMIC BY LANGUAGE)
// ==========================================

// Language Selection Keyboard ( 🇰🇭 Khmer (kh) | 🇺🇸 English (en) )
const languageKeyboard = Markup.keyboard([
    ['🇰🇭 Khmer (kh)', '🇺🇸 English (en)']
]).resize();

// Main Keyboard in Khmer (km)
const mainKeyboardKM = Markup.keyboard([
    ['🛒 ទិញសេវាកម្ម TikTok', '👛 កាបូបលុយ/បញ្ចូលលុយ'],
    ['👤 គណនី & តុល្យភាព', '🎥 វីដេអូណែនាំទិញ'],
    ['📅 ប្រវត្តិទិញ', '🔍 ពិនិត្យ Order ID'],
    ['🔝 កំពូលអ្នកទិញ', '💬 ជំនួយ Support'],
    ['🌐 ផ្លាស់ប្តូរភាសា']
]).resize();

// Main Keyboard in English (en)
const mainKeyboardEN = Markup.keyboard([
    ['🛒 TikTok Services', '👛 Add Funds/Wallet'],
    ['👤 Profile & Balance', '🎥 Video Tutorial'],
    ['📅 Order History', '🔍 Check Order ID'],
    ['🔝 Top Buyers', '💬 Support & Admin'],
    ['🌐 Change Language']
]).resize();

function getMainKeyboard(lang) {
    return lang === 'en' ? mainKeyboardEN : mainKeyboardKM;
}

// Back to Main Menu Keyboard
function getBackOnlyKeyboard(lang) {
    return Markup.keyboard([
        [lang === 'en' ? '↩ Back to Main Menu' : '↩ ត្រឡប់ទៅមេនុយធំ']
    ]).resize();
}

// Platforms Keyboard
function getPlatformsKeyboard(lang) {
    const backText = lang === 'en' ? '↩ Back to Main Menu' : '↩ ត្រឡប់ទៅមេនុយដើម';
    return Markup.keyboard([
        ['🎵 TikTok (ខ្មែរសុទ្ធ 💰)'],
        ['✈️ Telegram'],
        [backText]
    ]).resize();
}

// TikTok Services Keyboard
function getTikTokServicesKeyboard(lang) {
    const backSocial = lang === 'en' ? '↩ Back to Social Media' : '↩ ត្រឡប់ទៅបណ្តាញសង្គម';
    const backMain = lang === 'en' ? '↩ Back to Main Menu' : '↩ ត្រឡប់ទៅមេនុយដើម';
    return Markup.keyboard([
        ['❤️ Like & Views Khmer'],
        ['👀 Video Views Khmer'],
        ['👥 Followers Khmer'],
        [backSocial, backMain]
    ]).resize();
}

// Global Dynamic Package Prices Store (Editable by Admin live 24/7)
let dynamicPackagePrices = {
    likes: [
        { name: '❤️ 549 - 1.2K Likes + 👀 700 - 2.5K Views', price: 1.99 },
        { name: '❤️ 900 - 2.5K Likes + 👀 1.5K - 4.5K Views', price: 3.00 },
        { name: '❤️ 3K - 6.8K Likes + 👀 4.5K - 15.5K Views', price: 8.00 },
        { name: '❤️ 6.6K - 14.8K Likes + 👀 9.5K - 38.5K Views', price: 16.00 },
        { name: '❤️ 15K - 34K Likes + 👀 22.5K - 77K Views', price: 35.00 },
        { name: '❤️ 35.7K - 80K Likes + 👀 50.5K - 180K Views', price: 80.00 },
        { name: '❤️ 73.5K - 168K Likes + 👀 110K - 360K Views', price: 150.00 },
        { name: '❤️ 297K - 668K Likes + 👀 450K - 1.2M Views', price: 500.00 }
    ],
    views: [
        { name: '👀 2.4K - 8.2K Views + Likes Random', price: 1.99 },
        { name: '👀 4.2K - 14.4K Views + Likes Random', price: 3.00 },
        { name: '👀 13.2K - 45.3K Views + Likes Random', price: 8.00 },
        { name: '👀 28.9K - 98.9K Views + Likes Random', price: 16.00 },
        { name: '👀 66.3K - 226.8K Views + Likes Random', price: 35.00 },
        { name: '👀 156.7K - 526.1K Views + Likes Random', price: 80.00 },
        { name: '👀 325.5K - 1.11M Views + Likes Random', price: 150.00 },
        { name: '👀 1.3M - 4.5M Views + Likes Random', price: 500.00 }
    ],
    followers: [
        { name: '👥 18 - 90 Khmer Followers + Likes & Views', price: 1.99 },
        { name: '👥 32 - 160 Khmer Followers + Likes & Views', price: 3.00 },
        { name: '👥 100 - 500 Khmer Followers + Likes & Views', price: 8.00 },
        { name: '👥 210 - 659 Khmer Followers + Likes & Views', price: 16.00 },
        { name: '👥 501 - 992 Khmer Followers + Likes & Views', price: 35.00 },
        { name: '👥 1183 - 1624 Khmer Followers + Likes & Views', price: 80.00 },
        { name: '👥 2456 - 2897 Khmer Followers + Likes & Views', price: 150.00 },
        { name: '👥 9822 - 10263 Khmer Followers + Likes & Views', price: 500.00 }
    ]
};

const PACKAGES_FILE = path.join(__dirname, 'packages_config.json');

function loadDynamicPackages() {
    try {
        if (fs.existsSync(PACKAGES_FILE)) {
            const data = fs.readFileSync(PACKAGES_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (parsed && parsed.likes && parsed.views && parsed.followers) {
                dynamicPackagePrices = parsed;
                console.log('✅ Loaded dynamic package prices from packages_config.json!');
            }
        }
    } catch (e) {
        console.error('⚠️ Could not load packages_config.json:', e.message);
    }
}

function saveDynamicPackages() {
    try {
        fs.writeFileSync(PACKAGES_FILE, JSON.stringify(dynamicPackagePrices, null, 2), 'utf8');
        console.log('✅ Saved dynamic package prices to packages_config.json!');
    } catch (e) {
        console.error('⚠️ Could not save packages_config.json:', e.message);
    }
}

const HOWTO_FILE = path.join(__dirname, 'howto_config.json');

let howtoVideoLinks = [
    'https://t.me/Blessing_Kh_Public/3',
    'https://t.me/Blessing_Kh_Public/3',
    'https://t.me/Blessing_Kh_Public/3'
];

function loadHowtoConfig() {
    try {
        if (fs.existsSync(HOWTO_FILE)) {
            const data = fs.readFileSync(HOWTO_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (parsed && Array.isArray(parsed) && parsed.length > 0) {
                howtoVideoLinks = parsed;
                console.log('✅ Loaded howtoVideoLinks from howto_config.json!');
            }
        }
    } catch (e) {
        console.error('⚠️ Could not load howto_config.json:', e.message);
    }
}

function saveHowtoConfig() {
    try {
        fs.writeFileSync(HOWTO_FILE, JSON.stringify(howtoVideoLinks, null, 2), 'utf8');
        console.log('✅ Saved howtoVideoLinks to howto_config.json!');
    } catch (e) {
        console.error('⚠️ Could not save howto_config.json:', e.message);
    }
}

const MEDIA_FILE = path.join(__dirname, 'media_config.json');

function loadMediaConfig() {
    try {
        if (fs.existsSync(MEDIA_FILE)) {
            const data = fs.readFileSync(MEDIA_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (parsed && parsed.videoId) {
                customHowToOrderVideoId = parsed.videoId;
                console.log('✅ Loaded customHowToOrderVideoId from media_config.json:', customHowToOrderVideoId);
            }
        }
    } catch (e) {
        console.error('⚠️ Could not load media_config.json:', e.message);
    }
}

function saveMediaConfig(fileId) {
    try {
        fs.writeFileSync(MEDIA_FILE, JSON.stringify({ videoId: fileId }, null, 2), 'utf8');
        console.log('✅ Saved customHowToOrderVideoId to media_config.json:', fileId);
    } catch (e) {
        console.error('⚠️ Could not save media_config.json:', e.message);
    }
}

// Extra admins added at runtime via the bot's "Manage Admins" menu (persisted
// separately from ADMIN_IDS/DEFAULT_ADMIN_IDS so the base/env admin list is
// never touched by in-bot actions).
const ADMINS_FILE = path.join(__dirname, 'admins_config.json');
let extraAdminIds = [];

function loadAdminsConfig() {
    try {
        if (fs.existsSync(ADMINS_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
            if (Array.isArray(parsed)) {
                extraAdminIds = parsed.map(id => parseInt(id)).filter(id => !isNaN(id));
                console.log('✅ Loaded extraAdminIds from admins_config.json!');
            }
        }
    } catch (e) {
        console.error('⚠️ Could not load admins_config.json:', e.message);
    }
}

function saveAdminsConfig() {
    try {
        fs.writeFileSync(ADMINS_FILE, JSON.stringify(extraAdminIds, null, 2), 'utf8');
        console.log('✅ Saved extraAdminIds to admins_config.json!');
    } catch (e) {
        console.error('⚠️ Could not save admins_config.json:', e.message);
    }
}

// Resellers added at runtime via the "Manage Resellers" menu — buy at a
// discounted wholesale price (resellerDiscountPercent) and resell independently
// through their own channels; this bot doesn't manage their downstream customers.
const RESELLERS_FILE = path.join(__dirname, 'resellers_config.json');
let resellerIdsList = [];

function loadResellersConfig() {
    try {
        if (fs.existsSync(RESELLERS_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(RESELLERS_FILE, 'utf8'));
            if (Array.isArray(parsed)) {
                resellerIdsList = parsed.map(id => parseInt(id)).filter(id => !isNaN(id));
                console.log('✅ Loaded resellerIds from resellers_config.json!');
            }
        }
    } catch (e) {
        console.error('⚠️ Could not load resellers_config.json:', e.message);
    }
}

function saveResellersConfig() {
    try {
        fs.writeFileSync(RESELLERS_FILE, JSON.stringify(resellerIdsList, null, 2), 'utf8');
        console.log('✅ Saved resellerIds to resellers_config.json!');
    } catch (e) {
        console.error('⚠️ Could not save resellers_config.json:', e.message);
    }
}

// Load dynamic package prices, howto links, start video media, extra admins, and resellers from disk on boot
loadDynamicPackages();
loadHowtoConfig();
loadMediaConfig();
loadAdminsConfig();
loadResellersConfig();

const resellerIds = new Set(resellerIdsList);
let resellerDiscountPercent = 20; // Default wholesale discount for resellers

function isReseller(userId) {
    if (!userId) return false;
    return resellerIds.has(parseInt(userId));
}

function getEffectivePrice(retailPrice, userId) {
    return isReseller(userId) ? retailPrice * (1 - resellerDiscountPercent / 100) : retailPrice;
}

function updateDynamicPackagePrice(targetName, newPrice) {
    const targetClean = targetName.toLowerCase().replace(/[^a-z0-9]/g, '');
    let updated = false;
    for (const cat of ['likes', 'views', 'followers']) {
        for (const p of dynamicPackagePrices[cat]) {
            const pClean = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (pClean.includes(targetClean) || targetClean.includes(pClean) || p.name.includes(targetName)) {
                p.price = newPrice;
                updated = true;
                break;
            }
        }
    }
    if (updated) {
        saveDynamicPackages();
    }
    return updated;
}

// Package Keyboards
function getLikeViewsPackages(lang, userId) {
    const backTT = lang === 'en' ? '↩ Back to TikTok Services' : '↩ ត្រឡប់ទៅសេវាកម្ម TikTok';
    const backMain = lang === 'en' ? '↩ Back to Main Menu' : '↩ ត្រឡប់ទៅមេនុយដើម';
    const rows = dynamicPackagePrices.likes.map(p => [`${p.name} = $${getEffectivePrice(p.price, userId).toFixed(2)}`]);
    rows.push([backTT, backMain]);
    return Markup.keyboard(rows).resize();
}

function getVideoViewsPackages(lang, userId) {
    const backTT = lang === 'en' ? '↩ Back to TikTok Services' : '↩ ត្រឡប់ទៅសេវាកម្ម TikTok';
    const backMain = lang === 'en' ? '↩ Back to Main Menu' : '↩ ត្រឡប់ទៅមេនុយដើម';
    const rows = dynamicPackagePrices.views.map(p => [`${p.name} = $${getEffectivePrice(p.price, userId).toFixed(2)}`]);
    rows.push([backTT, backMain]);
    return Markup.keyboard(rows).resize();
}

function getFollowersPackages(lang, userId) {
    const backTT = lang === 'en' ? '↩ Back to TikTok Services' : '↩ ត្រឡប់ទៅសេវាកម្ម TikTok';
    const backMain = lang === 'en' ? '↩ Back to Main Menu' : '↩ ត្រឡប់ទៅមេនុយដើម';
    const rows = dynamicPackagePrices.followers.map(p => [`${p.name} = $${getEffectivePrice(p.price, userId).toFixed(2)}`]);
    rows.push([backTT, backMain]);
    return Markup.keyboard(rows).resize();
}

// Helper: Calculate Rank Badge
function getUserRank(count) {
    if (count >= 50) return '👑 Master Supreme VIP';
    if (count >= 20) return '💎 Diamond Member';
    if (count >= 5) return '🥇 Gold Member';
    if (count >= 1) return '🥈 Silver Member';
    return '🥉 Bronze Member';
}

// ==========================================
// 2. BILINGUAL MESSAGES DICTIONARY
// ==========================================
const i18n = {
    km: {
        welcome: (name) => 
            `✨ 💎 <b>${BRAND_NAME_UPPER}</b> 💎 ✨\n\n` +
            `👋 <b>សូមស្វាគមន៍មកកាន់ប្រព័ន្ធ SMM VIP!</b> 🇰🇭\n` +
            `👤 <b>អតិថិជន ៖</b> <b>${name}</b>\n` +
            `⚡ <b>ប្រព័ន្ធ ៖</b> 🟢 <b>Online 24/7 ( ស្វ័យប្រវត្តិ 100% )</b>`,
        account: (name, userId, balance, count) => 
            `💎 ━━━━━━━ [ <b>VIP PROFILE CARD</b> ] ━━━━━━━ 💎\n\n` +
            `👤 <b>ឈ្មោះអតិថិជន ៖</b> <b>${name}</b> 🇰🇭\n` +
            `📲 <b>Telegram ID ៖</b> <code>${userId}</code> <i>( ចុចលើលេខដើម្បី Copy ⚡ )</i>\n\n` +
            `👛 <b>តុល្យភាពកាបូបលុយ ៖</b> <b>$${balance.toFixed(2)} USD</b> 💵\n` +
            `📦 <b>ការបញ្ជាទិញសរុប ៖</b> <b>${count} Orders</b> 🛍️\n` +
            `🏅 <b>កម្រិត VIP Rank ៖</b> <b>${getUserRank(count)}</b>\n\n` +
            `📢 <b>Telegram Channel ៖</b> <a href="${CHANNEL_LINK}">${CHANNEL_LINK}</a>\n` +
            `⚡ <i>សេវាកម្មរហ័សទាន់ចិត្ត សុវត្ថិភាពខ្ពស់ និង មានទំនុកចិត្ត ១០០%!</i>`,
        add_funds: (balance) => 
            `💳 <b>កាបូបលុយ & បញ្ចូលលុយ</b> 💳\n\n` +
            `💸 <b>សមតុល្យបច្ចុប្បន្ន ៖</b> <b>$${balance.toFixed(2)} USD</b>\n\n` +
            `🎁 <b>Bonus បន្ថែម ៖</b>\n` +
            (isBonusPromoOn ? `✦ បញ្ចូល <b>$${bonusMinDeposit.toFixed(2)}+</b> ទទួលបាន <b>+${bonusPercentage}% Bonus</b> ភ្លាមៗ! 🎉\n\n` : `✦ <i>ពុំមានប្រូម៉ូសិន Bonus ក្នុងពេលនេះឡើយ។</i>\n\n`) +
            `👇 <b>សូមវាយបញ្ចូលចំនួនទឹកប្រាក់ ( ឧទាហរណ៍ ៖ 5, 10, 20 ឬ 50 ) ៖</b>`,
        my_orders_empty: `📦 <b>Order History</b>\n\nYou haven't placed any orders yet.`,
        check_order_prompt: `🔍 <b>ពិនិត្យលេខកូដបញ្ជាទិញ</b>\n\nសូមផ្ញើលេខកូដបញ្ជាទិញរបស់អ្នកដើម្បីត្រួតពិនិត្យ (ឧទាហរណ៍ ៖ #ORD-123456) ៖`,
        how_to_order_caption: `💡 <b>វីដេអូណែនាំរបៀបបញ្ជាទិញ (How to Order Guide)</b>\n\n` +
            `⏳ សូមទស្សនាវីដេអូខ្លីនេះ ដើម្បីយល់ដឹងពីរបៀបទិញយ៉ាងងាយស្រួល ៖\n\n` +
            `📢 <b>Official Channel ៖</b> <a href="${CHANNEL_LINK}">${CHANNEL_LINK}</a>\n` +
            `📞 <b>Support Admin ៖</b> ${SUPPORT_LINK}`,
        choose_platform: `🛒 <b>ជ្រើសរើសបណ្តាញសង្គម (Choose Platform)</b>\n----------------------------------------\nសូមជ្រើសរើសសេវាកម្មខាងក្រោម ៖`,
        tiktok_services: `🎵 <b>សេវាកម្ម TikTok Khmer ( ខ្មែរសុទ្ធ 100% )</b>\n----------------------------------------\nសូមជ្រើសរើសប្រភេទសេវាកម្មខាងក្រោម ៖`
    },
    en: {
        welcome: (name) => 
            `✨ 💎 <b>${BRAND_NAME_UPPER}</b> 💎 ✨\n\n` +
            `👋 <b>Welcome to SMM VIP System!</b> 🇰🇭\n` +
            `👤 <b>Customer:</b> <b>${name}</b>\n` +
            `⚡ <b>System:</b> 🟢 <b>Online 24/7 ( 100% Automated )</b>`,
        account: (name, userId, balance, count) => 
            `💎 <b>VIP PROFILE CARD</b> 💎\n\n` +
            `👤 <b>Name:</b> <b>${name}</b>\n` +
            `📲 <b>User ID:</b> <code>${userId}</code>\n` +
            `👛 <b>Balance:</b> <b>$${balance.toFixed(2)} USD</b> 💵\n` +
            `📦 <b>Total Orders:</b> <b>${count} Orders</b>\n` +
            `🏅 <b>Account Rank:</b> <b>${getUserRank(count)}</b>\n\n` +
            `📢 <b>Official Channel:</b> ${CHANNEL_LINK}\n` +
            `⚡ <i>Fast execution, maximum security, 100% reliable!</i>`,
        add_funds: (balance) => 
            `💳 <b>WALLET & ADD FUNDS</b> 💳\n\n` +
            `💸 <b>Current Balance:</b> <b>$${balance.toFixed(2)} USD</b>\n\n` +
            `🎁 <b>Active Bonus:</b>\n` +
            (isBonusPromoOn ? `✦ Deposit <b>$${bonusMinDeposit.toFixed(2)}+</b> get an extra <b>+${bonusPercentage}% Bonus</b>! 🎉\n\n` : `✦ <i>No bonus promotion active right now.</i>\n\n`) +
            `👇 <b>Enter deposit amount (e.g. 5, 10, 20 or 50):</b>`,
        my_orders_empty: `📦 <b>Order History</b>\n\nYou haven't placed any orders yet.`,
        check_order_prompt: `🔍 <b>Check Order ID</b>\n\nPlease send your Order ID to check (e.g. #ORD-123456):`,
        how_to_order_caption: `💡 <b>How to Order Video Guide</b>\n\n` +
            `⏳ Please watch this short video guide to understand the ordering process:\n\n` +
            `📢 <b>Official Channel:</b> ${CHANNEL_LINK}\n` +
            `📞 <b>Support Admin:</b> ${SUPPORT_LINK}`,
        choose_platform: `🛒 <b>Choose a Platform</b>\n----------------------------------------\nSelect a platform below:`,
        tiktok_services: `🎵 <b>TikTok Services ( 100% Real Khmer )</b>\n----------------------------------------\nSelect a service type below:`
    }
};

// ==========================================
const hasSeenGuide = {}; // Tracks users who have received the auto video guide once

// Helper Function: Send How to Order Guide (Displays Video Card for Admin's How to link + CTA Buttons)
async function sendHowToOrderGuide(ctx) {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    const mainKb = getMainKeyboard(lang);

    const activeHowtoLink = (howtoVideoLinks && howtoVideoLinks[0]) ? howtoVideoLinks[0] : CHANNEL_LINK;

    const guideText = lang === 'km' ?
        `💡 <b>វីដេអូណែនាំរបៀបបញ្ជាទិញ (How to Order Guide)</b>\n\n` +
        `⏳ សូមទស្សនាវីដេអូខ្លីនេះ ដើម្បីយល់ដឹងពីរបៀបទិញយ៉ាងងាយស្រួល ៖\n\n` +
        `📢 <b>Official Channel ៖</b> <a href="${activeHowtoLink}">${activeHowtoLink}</a>\n` +
        `📞 <b>Support Admin ៖</b> ${SUPPORT_LINK}` :

        `💡 <b>How to Order Video Guide</b>\n\n` +
        `⏳ Please watch this short video guide to understand the ordering process:\n\n` +
        `📢 <b>Official Channel:</b> <a href="${activeHowtoLink}">${activeHowtoLink}</a>\n` +
        `📞 <b>Support Admin:</b> ${SUPPORT_LINK}`;

    const videoButtonKb = Markup.inlineKeyboard([
        [Markup.button.url(lang === 'km' ? '🎬 ទស្សនាវីដេអូណែនាំ & ចូលរួម Channel ↗️' : '🎬 Watch Video & Join Official Channel ↗️', activeHowtoLink)],
        [Markup.button.url(lang === 'km' ? `📢 ចូលរួម ${BRAND_NAME}_Public ( ទទួលប្រូម៉ូសិន 🎁 ) ↗️` : `📢 Join ${BRAND_NAME}_Public Channel 🎁 ↗️`, activeHowtoLink)]
    ]);

    await ctx.replyWithHTML(guideText, { ...videoButtonKb, ...mainKb });
}

// 1-Click Action for How to Order Video Guide
bot.action('how_to_order_action', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    return sendHowToOrderGuide(ctx);
});

// ==========================================
// 3. BOT COMMANDS & HANDLERS
// ==========================================

// START COMMAND (/start) - Always shows Language Selection Keyboard first
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    const firstName = ctx.from.first_name || 'User';

    // Initialize user in Database if available
    await dbGetUser(userId, firstName, ctx.from.username);

    return ctx.replyWithHTML(
        `Welcome, <b>${firstName}</b>! Please select your language / សូមជ្រើសរើសភាសា ៖`,
        languageKeyboard
    );
});

// Helper Function: Send Welcome Screen Card (Connected with Admin Start Media Video)
async function sendWelcomeMessage(ctx) {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    const firstName = ctx.from.first_name || 'User';

    const welcomeText = i18n[lang].welcome(firstName);
    const mainKb = getMainKeyboard(lang);

    const activeChannelLink = (howtoVideoLinks && howtoVideoLinks[0]) ? howtoVideoLinks[0] : CHANNEL_LINK;
    const websiteUrl = process.env.WEB_APP_URL || 'https://telegram-bot-djpl.onrender.com';

    const welcomeButtons = Markup.inlineKeyboard([
        [Markup.button.url(lang === 'km' ? '📢 ចូលរួម Telegram Channel ( ទទួលប្រូម៉ូសិន 🎁 ) ↗️' : '📢 Join Official Telegram Channel 🎁 ↗️', activeChannelLink)],
        [Markup.button.webApp(lang === 'km' ? `🌐 បើក ${BRAND_NAME} Website Portal ⚡` : `🌐 Open ${BRAND_NAME} Website Portal ⚡`, websiteUrl)]
    ]);

    const videoId = customHowToOrderVideoId || process.env.HOW_TO_ORDER_VIDEO_ID;
    if (videoId) {
        try {
            await ctx.replyWithVideo(videoId, {
                caption: welcomeText,
                parse_mode: 'HTML',
                supports_streaming: true,
                width: 720,
                height: 1280,
                ...welcomeButtons
            });
            await ctx.replyWithHTML(lang === 'km' ? '👇 <i>សូមជ្រើសរើសមេនុយខាងក្រោមដើម្បីចាប់ផ្តើម ៖</i>' : '👇 <i>Select from the menu below:</i>', mainKb);
            return;
        } catch (e) {
            console.error('⚠️ Could not send welcome video by File ID:', e.message);
        }
    }

    return ctx.replyWithHTML(welcomeText, { disable_web_page_preview: true, ...welcomeButtons, ...mainKb });
}

// SET KHMER LANGUAGE (🇰🇭 Khmer (kh))
bot.hears(['🇰🇭 Khmer (kh)', 'Khmer (kh)'], async (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    await dbUpdateLanguage(userId, 'km');

    await ctx.reply(`✔ ភាសាត្រូវបានកំណត់ទៅជា ភាសាខ្មែរ។`);
    return sendWelcomeMessage(ctx);
});

// SET ENGLISH LANGUAGE (🇺🇸 English (en))
bot.hears(['🇺🇸 English (en)', 'English (en)'], async (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    await dbUpdateLanguage(userId, 'en');

    await ctx.reply(`✔ Language set to English.`);
    return sendWelcomeMessage(ctx);
});

// LANGUAGE SWITCHER BUTTON
bot.hears(['🌐 ផ្លាស់ប្តូរភាសា', 'ផ្លាស់ប្តូរភាសា', '🌐 Change Language', 'Change Language', '◀ ផ្លាស់ប្តូរភាសា', '◀ ប្តូរភាសា', '◀ Change Language', '/language', '🌐 Language / ភាសា'], (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    const firstName = ctx.from.first_name || 'User';
    ctx.replyWithHTML(`Welcome, <b>${firstName}</b>! Please select your language / សូមជ្រើសរើសភាសា ៖`, languageKeyboard);
});

// BACK TO MAIN MENU
bot.hears(['↩ ត្រឡប់ទៅមេនុយធំ', '↩ ត្រឡប់ទៅមេនុយដើម', '↩ Back to Main Menu', 'Back to Main Menu'], async (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    return sendWelcomeMessage(ctx);
});

// 👤 ACCOUNT / PROFILE & BALANCE
async function sendAccountProfileCard(ctx) {
    const userId = ctx.from.id;
    delete userState[userId];
    const firstName = ctx.from.first_name || 'Customer';

    await dbGetUser(userId, firstName, ctx.from.username);

    const lang = getLang(userId);
    const balance = getBalance(userId);
    const ordersCount = getOrdersCount(userId);
    const websiteUrl = process.env.WEB_APP_URL || 'https://telegram-bot-djpl.onrender.com';

    const cardButtons = Markup.inlineKeyboard([
        [
            Markup.button.callback(lang === 'km' ? '👛 បញ្ចូលលុយ (Add Funds)' : '👛 Add Funds (Deposit)', 'profile_add_funds'),
            Markup.button.callback(lang === 'km' ? '📦 ប្រវត្តិទិញ (Orders)' : '📦 Order History', 'profile_my_orders')
        ],
        [
            Markup.button.webApp(lang === 'km' ? `🌐 បើក ${BRAND_NAME} Website Portal ⚡` : `🌐 Open ${BRAND_NAME} Website Portal ⚡`, websiteUrl)
        ]
    ]);

    const resellerBadge = isReseller(userId)
        ? (lang === 'km'
            ? `\n\n🏅 <b>ស្ថានភាព Reseller ៖</b> សកម្ម (-${resellerDiscountPercent}% តម្លៃដុំ)`
            : `\n\n🏅 <b>Reseller Status:</b> Active (-${resellerDiscountPercent}% wholesale)`)
        : '';

    return ctx.replyWithHTML(i18n[lang].account(firstName, userId, balance, ordersCount) + resellerBadge, {
        disable_web_page_preview: true,
        ...cardButtons,
        ...getMainKeyboard(lang)
    });
}

bot.hears(['👤 Profile & Balance', 'Profile & Balance', '👤 គណនី & តុល្យភាព', 'គណនី & តុល្យភាព', '👤 គណនី', '👤 Account', 'គណនី', 'Account'], async (ctx) => {
    return sendAccountProfileCard(ctx);
});

bot.action('profile_add_funds', (ctx) => {
    try { ctx.answerCbQuery(); } catch (e) {}
    const userId = ctx.from.id;
    userState[userId] = { step: 'AWAITING_DEPOSIT_AMOUNT' };
    const lang = getLang(userId);
    const balance = getBalance(userId);
    return ctx.replyWithHTML(i18n[lang].add_funds(balance), { ...getBackOnlyKeyboard(lang), disable_web_page_preview: true });
});

bot.action('profile_my_orders', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    return sendMyOrdersHistory(ctx);
});

// 👛 ADD FUNDS / WALLET
bot.hears(['👛 Add Funds/Wallet', 'Add Funds/Wallet', '👛 កាបូបលុយ/បញ្ចូលលុយ', 'កាបូបលុយ/បញ្ចូលលុយ', '👛 បញ្ចូលលុយ', '👛 Add Funds', 'បញ្ចូលលុយ', 'Add Funds'], (ctx) => {
    const userId = ctx.from.id;
    userState[userId] = { step: 'AWAITING_DEPOSIT_AMOUNT' };
    const lang = getLang(userId);
    const balance = getBalance(userId);

    ctx.replyWithHTML(i18n[lang].add_funds(balance), { ...getBackOnlyKeyboard(lang), disable_web_page_preview: true });
});

// 🎥 VIDEO TUTORIAL (HOW TO ORDER GUIDE)
bot.hears(['🎥 Video Tutorial', 'Video Tutorial', '🎥 វីដេអូណែនាំទិញ', 'វីដេអូណែនាំទិញ', '🖼️ របៀបបញ្ជាទិញ', '🖼️ How to Order', 'របៀបបញ្ជាទិញ', 'How to Order'], async (ctx) => {
    delete userState[ctx.from.id];
    await sendHowToOrderGuide(ctx);
});

// 💬 SUPPORT & ADMIN
bot.hears(['💬 Support & Admin', 'Support & Admin', '💬 ជំនួយ Support', 'ជំនួយ Support', '📞 Contact', 'Support'], (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    const activeChannelLink = (howtoVideoLinks && howtoVideoLinks[0]) ? howtoVideoLinks[0] : CHANNEL_LINK;

    const supportMsg = lang === 'km' ? 
        `💬 <b>ផ្នែកជំនួយ (SUPPORT ADMIN)</b> 💬\n\n` +
        `លោកអ្នកមានចម្ងល់ ឬ ត្រូវការជំនួយក្នុងការបញ្ជាទិញ? 💡\n\n` +
        `📢 <b>Telegram Channel ផ្លូវការ ៖</b> <a href="${activeChannelLink}">${activeChannelLink}</a>\n` +
        `👤 <b>Admin Support ៖</b> ${SUPPORT_LINK}\n\n` +
        `⚡ <i>ក្រុមការងារយើងខ្ញុំរង់ចាំជួយសម្រួល ២៤ម៉ោង / ៧ថ្ងៃ!</i>` :
        `💬 <b>SUPPORT ADMIN</b> 💬\n\n` +
        `Have questions or need assistance with your order? 💡\n\n` +
        `📢 <b>Official Telegram Channel:</b> <a href="${activeChannelLink}">${activeChannelLink}</a>\n` +
        `👤 <b>Admin Support:</b> ${SUPPORT_LINK}\n\n` +
        `⚡ <i>We are here to assist you 24/7!</i>`;

    const channelInlineKb = Markup.inlineKeyboard([
        [Markup.button.url(lang === 'km' ? '📢 ចូលរួម Telegram Channel ( ទទួលប្រូម៉ូសិន 🎁 ) ↗️' : '📢 Join Official Telegram Channel 🎁 ↗️', activeChannelLink)],
        [Markup.button.url(lang === 'km' ? '💬 ទាក់ទង Admin Support ( ២៤ម៉ោង ⚡ ) ↗️' : '💬 Contact Admin Support 24/7 ⚡ ↗️', 'https://t.me/Blessing_Kh_Supports')]
    ]);

    ctx.replyWithHTML(supportMsg, { disable_web_page_preview: true, ...channelInlineKb, ...getMainKeyboard(lang) });
});

// 🎵 TIKTOK SERVICES (CATEGORIES & PLATFORMS)
bot.hears(['🎵 TikTok (ខ្មែរសុទ្ធ 💰)', '🎵 TikTok', '🛒 TikTok Services', 'TikTok Services', '🛒 Buy TikTok Services', 'Buy TikTok Services', '🛒 ទិញសេវាកម្ម TikTok', 'ទិញសេវាកម្ម TikTok', '🛒 បណ្តាញសង្គម', '🛒 Social Media', 'បណ្តាញសង្គម', 'Social Media', '↩ ត្រឡប់ទៅសេវាកម្ម TikTok', '↩ Back to TikTok Services', '↩ ត្រឡប់ទៅបណ្តាញសង្គម', '↩ Back to Social Media'], (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    const lang = getLang(userId);
    ctx.replyWithHTML(i18n[lang].tiktok_services, getTikTokServicesKeyboard(lang));
});

// Telegram Placeholder
bot.hears(['✈️ Telegram'], (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    const msg = lang === 'km' ? 
        `🚧 សេវាកម្មនេះកំពុងរៀបចំឡើង។ សូមជ្រើសរើស <b>🎵 TikTok (ខ្មែរសុទ្ធ 💰)</b> ជាបណ្តោះអាសន្ន!` : 
        `🚧 Service under construction. Please select <b>🎵 TikTok (ខ្មែរសុទ្ធ 💰)</b> for now!`;
    ctx.replyWithHTML(msg, getPlatformsKeyboard(lang));
});

// TIKTOK SUB-SERVICE CATEGORIES
bot.hears(['❤️ Like & Views Khmer', '🛒 Like & Views Khmer', 'Like & Views Khmer'], (ctx) => {
    delete userState[ctx.from.id];
    const lang = getLang(ctx.from.id);
    const text = `🛒 <b>Like & Views Khmer</b>\n----------------------------------------\nTap a package to order:`;
    ctx.replyWithHTML(text, getLikeViewsPackages(lang, ctx.from.id));
});

bot.hears(['👀 Video Views Khmer', '🛒 Video Views Khmer', 'Video Views Khmer'], (ctx) => {
    delete userState[ctx.from.id];
    const lang = getLang(ctx.from.id);
    const text = `🛒 <b>Video Views Khmer</b>\n----------------------------------------\nTap a package to order:`;
    ctx.replyWithHTML(text, getVideoViewsPackages(lang, ctx.from.id));
});

bot.hears(['👥 Followers Khmer', '🛒 Followers Khmer', 'Followers Khmer'], (ctx) => {
    delete userState[ctx.from.id];
    const lang = getLang(ctx.from.id);
    const text = `🛒 <b>Followers Khmer</b>\n----------------------------------------\nTap a package to order:`;
    ctx.replyWithHTML(text, getFollowersPackages(lang, ctx.from.id));
});

// 📅 MY ORDERS / 📅 ប្រវត្តិទិញ
async function sendMyOrdersHistory(ctx) {
    const userId = ctx.from.id;
    delete userState[userId];
    const lang = getLang(userId);
    const firstName = ctx.from.first_name || 'Customer';
    const websiteUrl = process.env.WEB_APP_URL || 'https://telegram-bot-djpl.onrender.com';

    let ordersList = userOrdersCache[userId] || [];

    if (supabase) {
        try {
            const { data: userOrders } = await supabase
                .from('orders')
                .select('*')
                .eq('telegram_id', userId)
                .order('created_at', { ascending: false })
                .limit(5);

            if (userOrders && userOrders.length > 0) {
                ordersList = userOrders;
                userOrdersCache[userId] = userOrders;
            }
        } catch (e) {}
    }

    if (ordersList && ordersList.length > 0) {
        const headerText = lang === 'km' ?
            `📅 ━━━━━━━ [ <b>ORDER HISTORY CARD</b> ] ━━━━━━━ 📅\n` +
            `👤 <b>អតិថិជន ៖</b> <b>${firstName}</b>\n----------------------------------------\n\n` :
            `📅 ━━━━━━━ [ <b>ORDER HISTORY CARD</b> ] ━━━━━━━ 📅\n` +
            `👤 <b>Customer:</b> <b>${firstName}</b>\n----------------------------------------\n\n`;

        const itemsText = ordersList.map(o => {
            const dateStr = o.created_at ? new Date(o.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Phnom_Penh' }) : '';
            return (
                `🆔 <b>Order ID ៖</b> <code>${o.order_id}</code> <i>( ចុចលើលេខដើម្បី Copy ⚡ )</i>\n` +
                `📦 <b>កញ្ចប់សេវា ៖</b> ${o.package_name}\n` +
                `💵 <b>តម្លៃទិញ ៖</b> <b>$${parseFloat(o.price || 0).toFixed(2)} USD</b> 💸\n` +
                `🟢 <b>ស្ថានភាព ៖</b> <b>${o.status || 'Processing'} ⚡</b>\n` +
                (dateStr ? `🕒 <b>កាលបរិច្ឆេទ ៖</b> <code>${dateStr}</code>\n` : '')
            );
        }).join('\n----------------------------------------\n\n');

        const orderHistoryKb = Markup.inlineKeyboard([
            [
                Markup.button.callback(lang === 'km' ? '🛒 ទិញកញ្ចប់បន្ថែម (Buy More)' : '🛒 Buy More Packages', 'history_buy_more'),
                Markup.button.url(lang === 'km' ? '💬 ជំនួយ Admin (24/7)' : '💬 Order Support 24/7', 'https://t.me/Blessing_Kh_Supports')
            ],
            [
                Markup.button.webApp(lang === 'km' ? `🌐 បើក ${BRAND_NAME} Website Portal ⚡` : `🌐 Open ${BRAND_NAME} Website Portal ⚡`, websiteUrl)
            ]
        ]);

        return ctx.replyWithHTML(headerText + itemsText, { disable_web_page_preview: true, ...orderHistoryKb, ...getMainKeyboard(lang) });
    }

    // EMPTY ORDER HISTORY CARD
    const emptyText = lang === 'km' ?
        `📦 ━━━━━━━ [ <b>ORDER HISTORY</b> ] ━━━━━━━ 📦\n\n` +
        `👋 <b>សួស្តី ${firstName}!</b> លោកអ្នកពុំទាន់មានប្រវត្តិទិញសេវាកម្មនៅឡើយទេ។\n\n` +
        `💡 <i>សូមចុចប៊ូតុង [ 🛒 ទិញសេវាកម្ម TikTok ] ខាងក្រោម ដើម្បីចាប់ផ្តើមទិញកញ្ចប់សេវាកម្មដំបូងរបស់អ្នក! 🚀</i>` :
        `📦 ━━━━━━━ [ <b>ORDER HISTORY</b> ] ━━━━━━━ 📦\n\n` +
        `👋 <b>Hello ${firstName}!</b> You haven't placed any orders yet.\n\n` +
        `💡 <i>Click [ 🛒 TikTok Services ] below to get started! 🚀</i>`;

    const emptyKb = Markup.inlineKeyboard([
        [
            Markup.button.callback(lang === 'km' ? '🛒 ទិញសេវាកម្ម TikTok Khmer 🚀' : '🛒 Buy TikTok Services 🚀', 'history_buy_more'),
            Markup.button.callback(lang === 'km' ? '👛 បញ្ចូលលុយ (Add Funds)' : '👛 Add Funds', 'profile_add_funds')
        ]
    ]);

    return ctx.replyWithHTML(emptyText, { disable_web_page_preview: true, ...emptyKb, ...getMainKeyboard(lang) });
}

bot.hears(['📅 ប្រវត្តិទិញ', '📅 ការបញ្ជាទិញរបស់ខ្ញុំ', '📅 Order History', '📅 My Orders', 'ប្រវត្តិទិញ', 'ការបញ្ជាទិញរបស់ខ្ញុំ', 'Order History', 'My Orders'], async (ctx) => {
    return sendMyOrdersHistory(ctx);
});

bot.action('history_buy_more', (ctx) => {
    try { ctx.answerCbQuery(); } catch (e) {}
    const userId = ctx.from.id;
    delete userState[userId];
    const lang = getLang(userId);
    return ctx.replyWithHTML(i18n[lang].tiktok_services, getTikTokServicesKeyboard(lang));
});

// 🔍 CHECK ORDER ID / 🔍 ពិនិត្យ Order ID
bot.hears(['🔍 ពិនិត្យ Order ID', '🔍 ពិនិត្យលេខកូដបញ្ជាទិញ', '🔍 Check Order ID', 'ពិនិត្យ Order ID', 'ពិនិត្យលេខកូដបញ្ជាទិញ', 'Check Order ID'], (ctx) => {
    const userId = ctx.from.id;
    userState[userId] = { step: 'AWAITING_CHECK_ORDER' };
    const lang = getLang(userId);
    ctx.replyWithHTML(i18n[lang].check_order_prompt, getBackOnlyKeyboard(lang));
});

// 🔝 TOP BUYERS LEADERBOARD
async function sendTopBuyersLeaderboard(ctx) {
    const userId = ctx.from.id;
    delete userState[userId];
    const lang = getLang(userId);
    const websiteUrl = process.env.WEB_APP_URL || 'https://telegram-bot-djpl.onrender.com';

    let topList = [];

    if (supabase) {
        try {
            const { data } = await supabase
                .from('orders')
                .select('telegram_id, price');

            if (data && data.length > 0) {
                const userTotals = {};
                data.forEach(o => {
                    const id = o.telegram_id;
                    const p = parseFloat(o.price || 0);
                    if (id) {
                        userTotals[id] = (userTotals[id] || 0) + p;
                    }
                });

                topList = Object.keys(userTotals)
                    .map(id => ({ telegram_id: id, total: userTotals[id] }))
                    .sort((a, b) => b.total - a.total)
                    .slice(0, 10);
            }
        } catch (e) {}
    }

    const websiteKb = Markup.inlineKeyboard([
        [
            Markup.button.callback(lang === 'km' ? '👛 បញ្ចូលលុយដណ្តើមពាន' : '👛 Deposit Funds', 'profile_add_funds'),
            Markup.button.callback(lang === 'km' ? '👤 គណនីរបស់ខ្ញុំ' : '👤 My VIP Profile', 'top_my_profile')
        ],
        [
            Markup.button.webApp(lang === 'km' ? `🌐 បើក ${BRAND_NAME} Website Portal ⚡` : `🌐 Open ${BRAND_NAME} Website Portal ⚡`, websiteUrl)
        ]
    ]);

    if (!topList || topList.length === 0) {
        // No real purchase data yet — show an honest empty state instead of
        // fabricated buyer IDs/amounts (that would mislead real customers).
        const emptyMsg = lang === 'km' ?
            `🏆 ━━━━━━━ [ <b>TOP 10 BUYERS LEADERBOARD</b> ] ━━━━━━━ 🏆\n\n` +
            `👑 ពុំទាន់មានការបញ្ជាទិញគ្រប់គ្រាន់ដើម្បីបង្ហាញលេខរាំងនៅឡើយទេ។\n` +
            `ក្លាយជាអ្នកទិញដំបូងគេ ដើម្បីឡើងចំណាត់ថ្នាក់លេខ១! 🚀` :
            `🏆 ━━━━━━━ [ <b>TOP 10 BUYERS LEADERBOARD</b> ] ━━━━━━━ 🏆\n\n` +
            `👑 No purchases yet to build a leaderboard.\n` +
            `Be the first buyer to claim the #1 spot! 🚀`;
        return ctx.replyWithHTML(emptyMsg, { disable_web_page_preview: true, ...websiteKb, ...getMainKeyboard(lang) });
    }

    const titleText = lang === 'km' ?
        `🏆 ━━━━━━━ [ <b>TOP 10 BUYERS LEADERBOARD</b> ] ━━━━━━━ 🏆\n\n` +
        `👑 <b>កម្រងកិត្តិយសអតិថិជន VIP ឆ្នើមប្រចាំប្រព័ន្ធ ៖</b>\n----------------------------------------\n\n` :
        `🏆 ━━━━━━━ [ <b>TOP 10 BUYERS LEADERBOARD</b> ] ━━━━━━━ 🏆\n\n` +
        `👑 <b>Top VIP Members Leaderboard:</b>\n----------------------------------------\n\n`;

    const badges = ['🥇', '🥈', '🥉', '✦ 4.', '✦ 5.', '✦ 6.', '✦ 7.', '✦ 8.', '✦ 9.', '✦ 10.'];
    const rankBadges = ['👑', '💎', '🥇', '🥈', '🥉', '', '', '', '', ''];

    const itemsText = topList.map((item, idx) => {
        const strId = String(item.telegram_id);
        const maskedId = strId.length > 5 ? `${strId.substring(0, 4)}xxxx${strId.substring(strId.length - 2)}` : strId;
        const badge = badges[idx] || `✦ ${idx + 1}.`;
        const rank = rankBadges[idx] ? ` ${rankBadges[idx]}` : '';
        return `${badge} <b>ID <code>${maskedId}</code></b> — <b>$${item.total.toFixed(2)} USD</b>${rank}`;
    }).join('\n');

    const footerText = lang === 'km' ?
        `\n\n----------------------------------------\n` +
        `✨ <i>អរគុណដល់អតិថិជន VIP ទាំងអស់ដែលតែងតែមានទំនុកចិត្តលើ ${BRAND_NAME_UPPER}! 💖</i>` :
        `\n\n----------------------------------------\n` +
        `✨ <i>Thank you to all our VIP members for trusting ${BRAND_NAME_UPPER}! 💖</i>`;

    return ctx.replyWithHTML(titleText + itemsText + footerText, { disable_web_page_preview: true, ...websiteKb, ...getMainKeyboard(lang) });
}

bot.hears(['🔝 កំពូលអ្នកទិញ', '🔝 Top Buyers', 'កំពូលអ្នកទិញ', 'Top Buyers'], async (ctx) => {
    return sendTopBuyersLeaderboard(ctx);
});

bot.action('top_my_profile', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    return sendAccountProfileCard(ctx);
});

// PACKAGE SELECTION LISTENERS
bot.hears(/(.*)=\s*\$?([0-9.]+)/, (ctx, next) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();
    const state = userState[userId];

    const hasAdminPrefix = text.toLowerCase().startsWith('l:') || text.toLowerCase().startsWith('edit:');
    const isInAdminState = isAdmin(userId) && (state && state.step && state.step.startsWith('AWAITING_ADMIN_'));

    // IF SENDER HAS L: PREFIX OR IS IN ADMIN EDIT STATE: TREAT AS ADMIN EDIT CONFIRMATION!
    if (isAdmin(userId) && (hasAdminPrefix || isInAdminState)) {
        let cleanText = text;
        if (cleanText.toLowerCase().startsWith('l:')) cleanText = cleanText.substring(2).trim();
        if (cleanText.toLowerCase().startsWith('edit:')) cleanText = cleanText.substring(5).trim();

        const match = cleanText.match(/(.*)=\s*\$?([0-9.]+)/);
        let packageName = match ? match[1].trim().replace(/^[0-9]+\.\s*/, '') : ctx.match[1].trim().replace(/^[0-9]+\.\s*/, '');
        let newPrice = match ? parseFloat(match[2]) : parseFloat(ctx.match[2]);

        if (isNaN(newPrice) || newPrice <= 0) {
            return ctx.replyWithHTML('❌ <b>ចំនួនទឹកប្រាក់មិនត្រឹមត្រូវ!</b>', adminToolsKeyboard);
        }

        userState[userId] = {
            step: 'AWAITING_ADMIN_CONFIRM_PRICE_EDIT',
            targetPkgName: packageName,
            newPrice: newPrice
        };

        const confirmCard = 
            `⚠️ <b>ផ្ទៀងផ្ទាត់ការកែប្រែតម្លៃសេវាកម្ម (Admin Confirmation) ៖</b>\n----------------------------------------\n\n` +
            `📦 <b>កញ្ចប់សេវាកម្ម ៖</b> ${packageName}\n` +
            `💵 <b>តម្លៃថ្មីដែលត្រូវកំណត់ ៖</b> <b>$${newPrice.toFixed(2)} USD</b> 💸\n\n` +
            `👇 <b>តើលោកអ្នកពិតជាចង់បន្តរក្សាទុកការកែប្រែ ឬ បោះបង់?</b>`;

        const confirmKb = Markup.inlineKeyboard([
            [Markup.button.callback('✅ យល់ព្រមកែប្រែ (Confirm Edit)', 'confirm_save_pkg_price')],
            [Markup.button.callback('❌ បោះបង់ (Cancel)', 'cancel_admin_edit')]
        ]);

        return ctx.replyWithHTML(confirmCard, confirmKb);
    }

    const packageName = ctx.match[1].trim();
    const price = parseFloat(ctx.match[2]);
    const lang = getLang(userId);

    userState[userId] = {
        step: 'AWAITING_POLICY_CONFIRM',
        package: packageName,
        price: price
    };

    const policyMsg = lang === 'km' ?
        `⚠️ <b>គោលការណ៍ និង ការប្រុងប្រយ័ត្ន (Policy & Warning)</b>\n` +
        `• ហាមផ្លាស់ប្តូរ Username ក្នុងអំឡុងពេលប្រព័ន្ធកំពុងដំណើការ។\n` +
        `• ហាមប្តូរគណនីទៅជា Private (ឯកជន)។\n` +
        `• មិនមានការប្រគល់លុយវិញ (No Refund) បន្ទាប់ពីការបញ្ជាទិញបានចាប់ផ្តើម។\n` +
        `• ផ្ញើ Link ខុស = មិនមានការប្រគល់លុយវិញ។\n` +
        `• គណនី TikTok ត្រូវតែជារបស់បុគ្គលដែលមានអាយុចាប់ពី ១៨ ឆ្នាំឡើងទៅ។\n` +
        `• ហាមប្រពឹត្ត/បង្ហោះមាតិកាបារី, ថ្នាំជក់, គ្រឿងស្រវឹង, អាវុធ, ឈាម, នយោបាយ ឬ មាតិកា 18+ 🚫\n` +
        `_______________________________________\n\n` +
        `👍 ចុច <b>បន្តការបញ្ជាទិញ</b> ដើម្បីដាក់បញ្ជាទិញនេះ។` :
        `⚠️ <b>Policy & Warning</b>\n` +
        `• Don't change your username while the order is active.\n` +
        `• Don't make your account private.\n` +
        `• No refund after the order starts.\n` +
        `• Wrong link = No refund.\n` +
        `• The TikTok account must belong to someone over 18 years old.\n` +
        `• No tobacco, vape, alcohol, weapons, blood, politics, or 18+ content. 🚫\n` +
        `_______________________________________\n\n` +
        `👍 Tap <b>Continue to Order</b> to place this order.`;

    const confirmKb = Markup.keyboard([
        [lang === 'km' ? 'បន្តការបញ្ជាទិញ' : 'Continue to Order'],
        [lang === 'km' ? '❌ បោះបង់ការបញ្ជាទិញ' : '❌ Cancel Order']
    ]).resize();

    ctx.replyWithHTML(policyMsg, confirmKb);
});

// CONTINUE TO ORDER LISTENER (BILINGUAL)
bot.hears(['Continue to Order', 'Continue', 'បន្តការបញ្ជាទិញ', 'បន្ត'], (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];
    const lang = getLang(userId);

    if (!state || state.step !== 'AWAITING_POLICY_CONFIRM') {
        const noPkgErr = lang === 'km' ? '❌ ពុំមាន Package ត្រូវបានជ្រើសរើសឡើយ។' : '❌ No active package selected.';
        return ctx.replyWithHTML(noPkgErr, getMainKeyboard(lang));
    }

    state.step = 'AWAITING_LINK';

    const promptText = lang === 'km' ?
        `💬 <b>បានជ្រើសរើស Package ជោគជ័យ!</b>\n` +
        `_______________________________________\n` +
        `🛒 <b>${state.package}</b>\n` +
        `💰 តម្លៃ៖ <b>$${state.price.toFixed(2)} USD</b>\n` +
        `_______________________________________\n\n` +
        `🔗 <b>សូមផ្ញើ Link វីដេអូ TikTok របស់អ្នកនៅទីនេះ ៖</b>` :
        `💬 <b>Package selected!</b>\n` +
        `_______________________________________\n` +
        `🛒 <b>${state.package}</b>\n` +
        `💰 Price: <b>$${state.price.toFixed(2)} USD</b>\n` +
        `_______________________________________\n\n` +
        `🔗 <b>Please send the full link to your TikTok video:</b>`;

    const cancelKb = Markup.keyboard([
        [lang === 'km' ? '❌ បោះបង់ការបញ្ជាទិញ' : '❌ Cancel Order']
    ]).resize();

    ctx.replyWithHTML(promptText, cancelKb);
});

// CANCEL ORDER LISTENER (BILINGUAL)
bot.hears(['❌ Cancel Order', 'Cancel Order', '❌ បោះបង់ការបញ្ជាទិញ', 'បោះបង់ការបញ្ជាទិញ', '❌ បោះបង់ការទូទាត់'], (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    const lang = getLang(userId);
    const cancelMsg = lang === 'en' ? '❌ Order Cancelled.' : '❌ បានបោះបង់ការបញ្ជាទិញ។';
    ctx.replyWithHTML(cancelMsg, getMainKeyboard(lang));
});

// TEXT INPUT LISTENERS (DEPOSIT & ORDER PROCESSING)
bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();
    const lang = getLang(userId);
    const state = userState[userId];

    // Maintenance Mode Check for Non-Admins
    if (!isBotOpen && !isAdmin(userId)) {
        return ctx.replyWithHTML(
            `🚧 <b>ប្រព័ន្ធកំពុងអភិវឌ្ឍន៍/ថែទាំ (Bot Under Maintenance)</b>\n\n` +
            `ប្រព័ន្ធកំពុងត្រូវបានធ្វើការរៀបចំថែទាំដោយ Admin មួយរយៈ។\n` +
            `សូមអភ័យទោសចំពោះការរំខាន ហើយសូមវិលត្រឡប់មកវិញក្នុងពេលឆាប់ៗនេះ! 💖\n\n` +
            `📞 <b>Support Admin ៖</b> ${SUPPORT_LINK}`
        );
    }

    // ADMIN STEPS HANDLING
    if (state && state.step.startsWith('AWAITING_ADMIN_')) {
        if (state.step === 'AWAITING_ADMIN_FIND_USER') {
            delete userState[userId];
            const targetId = parseInt(text.replace(/[^0-9]/g, ''));
            const bal = getBalance(targetId);
            const count = getOrdersCount(targetId);

            const card = 
                `👤 <b>BLESSING.KH CUSTOMER PROFILE</b>\n----------------------------------------\n` +
                `🆔 <b>Telegram ID:</b> <code>${targetId}</code>\n` +
                `👛 <b>Balance:</b> <b>$${bal.toFixed(2)} USD</b> 💵\n` +
                `📦 <b>Total Orders:</b> ${count} Orders\n` +
                `🏅 <b>VIP Rank:</b> ${getUserRank(count)}\n` +
                `📅 <b>Last Active:</b> ${new Date().toISOString().split('T')[0]}`;

            return ctx.replyWithHTML(card, adminUsersKeyboard);
        }

        if (state.step === 'AWAITING_ADMIN_CREDIT_ID') {
            const targetId = parseInt(text.replace(/[^0-9]/g, ''));
            userState[userId] = { step: 'AWAITING_ADMIN_CREDIT_AMOUNT', targetId: targetId };
            return ctx.replyWithHTML(`💵 <b>បញ្ចូលចំនួនទឹកប្រាក់ ($) ដែលត្រូវបន្ថែមជូន User ID <code>${targetId}</code> ៖</b>`, Markup.keyboard([['🔐 Admin Menu']]).resize());
        }

        if (state.step === 'AWAITING_ADMIN_CREDIT_AMOUNT') {
            const targetId = state.targetId;
            const amount = parseFloat(text);
            delete userState[userId];

            if (isNaN(amount) || amount <= 0) return ctx.replyWithHTML('❌ ចំនួនទឹកប្រាក់មិនត្រឹមត្រូវ!', adminUsersKeyboard);
            if (amount > 100000) {
                return ctx.replyWithHTML('⚠️ <b>ចំនួនទឹកប្រាក់ធំពេក (លើសពី $100,000 USD)!</b>\nសូមពិនិត្យមើលថា ៖ តើបងច្រឡំបញ្ចូលលេខ User ID ជាចំនួនទឹកប្រាក់ដែរឬទេ? 😃', adminUsersKeyboard);
            }

            const newBal = getBalance(targetId) + amount;
            await dbUpdateBalance(targetId, newBal);

            ctx.replyWithHTML(`✅ <b>បានបន្ថែម +$${amount.toFixed(2)} USD ជូនអតិថិជន <code>${targetId}</code> ដោយជោគជ័យ!</b>\n💰 តុល្យភាពថ្មី ៖ <b>$${newBal.toFixed(2)} USD</b>`, adminUsersKeyboard);

            try {
                await bot.telegram.sendMessage(targetId, 
                    `🎉 <b>អបអរសាទរ! (${BRAND_NAME_UPPER})</b> 🎉\n` +
                    `----------------------------------------\n` +
                    `គណនីរបស់អ្នកទទួលបានការបញ្ចូលលុយចំនួន <b>+$${amount.toFixed(2)} USD</b> ពី Admin!\n\n` +
                    `💰 <b>តុល្យភាពលុយថ្មី ៖</b> <b>$${newBal.toFixed(2)} USD</b> 💵`, 
                    { parse_mode: 'HTML' }
                );
            } catch (e) {}
            return;
        }

        if (state.step === 'AWAITING_ADMIN_DEDUCT_ID') {
            const targetId = parseInt(text.replace(/[^0-9]/g, ''));
            userState[userId] = { step: 'AWAITING_ADMIN_DEDUCT_AMOUNT', targetId: targetId };
            return ctx.replyWithHTML(`💵 <b>បញ្ចូលចំនួនទឹកប្រាក់ ($) ដែលត្រូវកាត់ចេញពី User ID <code>${targetId}</code> ៖</b>`, Markup.keyboard([['🔐 Admin Menu']]).resize());
        }

        if (state.step === 'AWAITING_ADMIN_DEDUCT_AMOUNT') {
            const targetId = state.targetId;
            const amount = parseFloat(text);
            delete userState[userId];

            if (isNaN(amount) || amount <= 0) return ctx.replyWithHTML('❌ ចំនួនទឹកប្រាក់មិនត្រឹមត្រូវ!', adminUsersKeyboard);
            if (amount > 100000) {
                return ctx.replyWithHTML('⚠️ <b>ចំនួនទឹកប្រាក់ធំពេក (លើសពី $100,000 USD)!</b>\nសូមពិនិត្យមើលថា ៖ តើបងច្រឡំបញ្ចូលលេខ User ID ជាចំនួនទឹកប្រាក់ដែរឬទេ? 😃', adminUsersKeyboard);
            }

            const newBal = Math.max(0, getBalance(targetId) - amount);
            await dbUpdateBalance(targetId, newBal);

            ctx.replyWithHTML(`✅ <b>បានកាត់ប្រាក់ -$${amount.toFixed(2)} USD ពីអតិថិជន <code>${targetId}</code> ដោយជោគជ័យ!</b>\n💰 តុល្យភាពនៅសល់ ៖ <b>$${newBal.toFixed(2)} USD</b>`, adminUsersKeyboard);

            try {
                await bot.telegram.sendMessage(targetId, 
                    `⚠️ <b>ជូនដំណឹងកាត់ប្រាក់ (${BRAND_NAME_UPPER})</b>\n` +
                    `----------------------------------------\n` +
                    `គណនីរបស់អ្នកត្រូវបានកាត់ប្រាក់ចំនួន <b>-$${amount.toFixed(2)} USD</b> ពី Admin។\n\n` +
                    `💰 <b>តុល្យភាពលុយនៅសល់ ៖</b> <b>$${newBal.toFixed(2)} USD</b> 💵`, 
                    { parse_mode: 'HTML' }
                );
            } catch (e) {}
            return;
        }

        if (state.step === 'AWAITING_ADMIN_ADD_ID') {
            delete userState[userId];
            const targetId = parseInt(text.replace(/[^0-9]/g, ''));

            if (!targetId || isNaN(targetId)) {
                return ctx.replyWithHTML('❌ <b>Telegram ID មិនត្រឹមត្រូវ!</b> សូមផ្ញើតែជាលេខ (ឧទាហរណ៍ ៖ 521984577)។', adminManageAdminsKeyboard);
            }
            if (registeredAdminIds.has(targetId)) {
                return ctx.replyWithHTML(`⚠️ <b>User ID <code>${targetId}</code> ជា Admin រួចហើយ!</b>`, adminManageAdminsKeyboard);
            }

            registeredAdminIds.add(targetId);
            extraAdminIds.push(targetId);
            saveAdminsConfig();

            ctx.replyWithHTML(`✅ <b>បានបន្ថែម <code>${targetId}</code> ជា Admin ដោយជោគជ័យ!</b>`, adminManageAdminsKeyboard);

            try {
                await bot.telegram.sendMessage(targetId,
                    `🎉 <b>អ្នកត្រូវបានតែងតាំងជា Admin សម្រាប់ ${BRAND_NAME_UPPER} Bot!</b>\n\n` +
                    `វាយ /admin ដើម្បីបើក Admin Panel។`,
                    { parse_mode: 'HTML' }
                );
            } catch (e) {}
            return;
        }

        if (state.step === 'AWAITING_ADMIN_REMOVE_ID') {
            delete userState[userId];
            const targetId = parseInt(text.replace(/[^0-9]/g, ''));

            if (!targetId || isNaN(targetId)) {
                return ctx.replyWithHTML('❌ <b>Telegram ID មិនត្រឹមត្រូវ!</b>', adminManageAdminsKeyboard);
            }
            if (!extraAdminIds.includes(targetId)) {
                return ctx.replyWithHTML(
                    `❌ <b>មិនអាចដកចេញបានទេ!</b>\n` +
                    `<code>${targetId}</code> មិនមែនជា Admin ដែលបានបន្ថែមតាម Bot ទេ (ប្រហែលជា Base Admin ដែលកំណត់ក្នុង <code>ADMIN_IDS</code> — ត្រូវកែ env vars ដើម្បីដកចេញ)។`,
                    adminManageAdminsKeyboard
                );
            }

            registeredAdminIds.delete(targetId);
            extraAdminIds = extraAdminIds.filter(id => id !== targetId);
            saveAdminsConfig();

            ctx.replyWithHTML(`✅ <b>បានដកចេញ <code>${targetId}</code> ពី Admin ដោយជោគជ័យ!</b>`, adminManageAdminsKeyboard);
            return;
        }

        if (state.step === 'AWAITING_ADMIN_ADD_RESELLER_ID') {
            delete userState[userId];
            const targetId = parseInt(text.replace(/[^0-9]/g, ''));

            if (!targetId || isNaN(targetId)) {
                return ctx.replyWithHTML('❌ <b>Telegram ID មិនត្រឹមត្រូវ!</b> សូមផ្ញើតែជាលេខ។', adminManageResellersKeyboard);
            }
            if (resellerIds.has(targetId)) {
                return ctx.replyWithHTML(`⚠️ <b>User ID <code>${targetId}</code> ជា Reseller រួចហើយ!</b>`, adminManageResellersKeyboard);
            }

            resellerIds.add(targetId);
            resellerIdsList.push(targetId);
            saveResellersConfig();

            ctx.replyWithHTML(`✅ <b>បានបន្ថែម <code>${targetId}</code> ជា Reseller ដោយជោគជ័យ!</b> (-${resellerDiscountPercent}% wholesale)`, adminManageResellersKeyboard);

            try {
                await bot.telegram.sendMessage(targetId,
                    `🎉 <b>អ្នកត្រូវបានតែងតាំងជា Reseller សម្រាប់ ${BRAND_NAME_UPPER}!</b>\n\n` +
                    `👛 ចាប់ពីពេលនេះ អ្នកនឹងទទួលបានតម្លៃដុំ -${resellerDiscountPercent}% រាល់ការបញ្ជាទិញសេវាកម្ម!`,
                    { parse_mode: 'HTML' }
                );
            } catch (e) {}
            return;
        }

        if (state.step === 'AWAITING_ADMIN_REMOVE_RESELLER_ID') {
            delete userState[userId];
            const targetId = parseInt(text.replace(/[^0-9]/g, ''));

            if (!targetId || isNaN(targetId)) {
                return ctx.replyWithHTML('❌ <b>Telegram ID មិនត្រឹមត្រូវ!</b>', adminManageResellersKeyboard);
            }
            if (!resellerIds.has(targetId)) {
                return ctx.replyWithHTML(`❌ <b><code>${targetId}</code> មិនមែនជា Reseller ទេ!</b>`, adminManageResellersKeyboard);
            }

            resellerIds.delete(targetId);
            resellerIdsList = resellerIdsList.filter(id => id !== targetId);
            saveResellersConfig();

            ctx.replyWithHTML(`✅ <b>បានដកចេញ <code>${targetId}</code> ពី Reseller ដោយជោគជ័យ!</b>`, adminManageResellersKeyboard);
            return;
        }

        if (state.step === 'AWAITING_ADMIN_SET_RESELLER_DISCOUNT') {
            delete userState[userId];
            const val = parseFloat(text.replace(/[^0-9.]/g, ''));
            if (isNaN(val) || val < 0 || val > 100) {
                return ctx.replyWithHTML('❌ <b>ចំនួនភាគរយមិនត្រឹមត្រូវ! (0-100)</b>', getAdminPromoKeyboard());
            }
            resellerDiscountPercent = val;
            return ctx.replyWithHTML(`✅ <b>បានកែប្រែ Reseller Discount ទៅជា -${resellerDiscountPercent}% ដោយជោគជ័យ!</b>`, getAdminPromoKeyboard());
        }

        if (state.step === 'AWAITING_ADMIN_PAYWAY_LINK') {
            delete userState[userId];
            let cleanLink = text.trim();
            if (!cleanLink.startsWith('http://') && !cleanLink.startsWith('https://')) {
                if (cleanLink.includes('.')) {
                    cleanLink = 'https://' + cleanLink;
                } else {
                    cleanLink = 'https://link.payway.com.kh/' + cleanLink;
                }
            }
            paywayMerchantLink = cleanLink;
            return ctx.replyWithHTML(
                `✅ <b>បានផ្លាស់ប្តូរ ABA PayWay Link ថ្មីដោយជោគជ័យ ៖</b>\n\n` +
                `🔗 <b>Link ថ្មី ៖</b> <code>${paywayMerchantLink}</code>`,
                getAdminSettingsKeyboard()
            );
        }

        if (state.step === 'AWAITING_ADMIN_SET_ACLEDA_TOKEN') {
            delete userState[userId];
            acledaApiToken = text;
            return ctx.replyWithHTML(`✅ <b>បានកែប្រែ ACLEDA Bank API Token ដោយជោគជ័យ!</b>\n\n<code>${acledaApiToken}</code>`, getAdminSettingsKeyboard());
        }

        if (state.step === 'AWAITING_ADMIN_BAKONG_ID') {
            delete userState[userId];
            bakongAccountId = text.trim();
            return ctx.replyWithHTML(
                `✅ <b>បានកែប្រែ Bakong Merchant Account ID ដោយជោគជ័យ!</b>\n\n` +
                `🇰🇭 <b>Bakong Account ID ថ្មី ៖</b> <code>${bakongAccountId}</code>`,
                getAdminSettingsKeyboard()
            );
        }

        if (state.step === 'AWAITING_ADMIN_SET_BONUS_PERCENT') {
            delete userState[userId];
            const val = parseFloat(text.replace(/[^0-9.]/g, ''));
            if (isNaN(val) || val < 0) {
                return ctx.replyWithHTML('❌ <b>ចំនួនភាគរយមិនត្រឹមត្រូវ!</b>', getAdminPromoKeyboard());
            }
            bonusPercentage = val;
            return ctx.replyWithHTML(`✅ <b>បានកែប្រែភាគរយ Bonus ទៅជា +${bonusPercentage}% ដោយជោគជ័យ!</b>`, getAdminPromoKeyboard());
        }

        if (state.step === 'AWAITING_ADMIN_SET_BONUS_MIN') {
            delete userState[userId];
            const val = parseFloat(text.replace(/[^0-9.]/g, ''));
            if (isNaN(val) || val < 0) {
                return ctx.replyWithHTML('❌ <b>ចំនួនទឹកប្រាក់មិនត្រឹមត្រូវ!</b>', getAdminPromoKeyboard());
            }
            bonusMinDeposit = val;
            return ctx.replyWithHTML(`✅ <b>បានកែប្រែប្រាក់ Deposit ទាបបំផុតសម្រាប់ទទួលបាន Bonus ទៅជា $${bonusMinDeposit.toFixed(2)} USD ដោយជោគជ័យ!</b>`, getAdminPromoKeyboard());
        }

        if (state.step === 'AWAITING_ADMIN_BROADCAST') {
            delete userState[userId];
            const broadcastText = text;

            let targetUsers = Object.keys(userBalances).map(id => parseInt(id));
            if (supabase) {
                try {
                    const { data } = await supabase.from('users').select('telegram_id');
                    if (data && data.length > 0) targetUsers = data.map(u => u.telegram_id);
                } catch (e) {}
            }

            let successCount = 0, failCount = 0;
            await ctx.replyWithHTML(`⏳ Broadcast sending to <b>${targetUsers.length}</b> users...`);

            for (const tId of targetUsers) {
                try {
                    await bot.telegram.sendMessage(tId, broadcastText, { parse_mode: 'HTML' });
                    successCount++;
                } catch (e) {
                    failCount++;
                }
            }

            return ctx.replyWithHTML(`✅ <b>Broadcast Complete!</b>\n\n🟢 Success: <b>${successCount}</b>\n🔴 Failed: <b>${failCount}</b>`, adminToolsKeyboard);
        }

        if (state.step === 'AWAITING_ADMIN_EDIT_PRICE_INPUT') {
            const catId = state.catId || 'likes';
            let targetPkgName = '';
            let newPrice = 0;

            const parts = text.split('=');
            if (parts.length >= 2) {
                targetPkgName = parts[0].trim().replace(/^[0-9]+\.\s*/, '');
                newPrice = parseFloat(parts[1].replace(/[^0-9.]/g, ''));
            } else {
                newPrice = parseFloat(text.replace(/[^0-9.]/g, ''));
                targetPkgName = '❤️ 549 - 1.2K Likes + 👀 700 - 2.5K Views';
            }

            if (isNaN(newPrice) || newPrice <= 0) {
                return ctx.replyWithHTML('❌ <b>ចំនួនទឹកប្រាក់មិនត្រឹមត្រូវ!</b>\nសូមផ្ញើសារតាមទម្រង់ ៖ <code>[ឈ្មោះ Package] = $[តម្លៃ]</code>', adminToolsKeyboard);
            }

            userState[userId] = {
                step: 'AWAITING_ADMIN_CONFIRM_PRICE_EDIT',
                catId: catId,
                targetPkgName: targetPkgName,
                newPrice: newPrice
            };

            const confirmCard = 
                `⚠️ <b>ផ្ទៀងផ្ទាត់ការកែប្រែតម្លៃសេវាកម្ម (Admin Confirmation) ៖</b>\n----------------------------------------\n\n` +
                `📦 <b>កញ្ចប់សេវាកម្ម ៖</b> ${targetPkgName}\n` +
                `💵 <b>តម្លៃថ្មីដែលត្រូវកំណត់ ៖</b> <b>$${newPrice.toFixed(2)} USD</b> 💸\n\n` +
                `👇 <b>តើលោកអ្នកពិតជាចង់បន្តរក្សាទុកការកែប្រែ ឬ បោះបង់?</b>`;

            const confirmKb = Markup.inlineKeyboard([
                [Markup.button.callback('✅ យល់ព្រមកែប្រែ (Confirm Edit)', 'confirm_save_pkg_price')],
                [Markup.button.callback('❌ បោះបង់ (Cancel)', 'cancel_admin_edit')]
            ]);

            return ctx.replyWithHTML(confirmCard, confirmKb);
        }
    }

    // FLOW: PAYWAY DIRECT PAID AMOUNT INPUT VERIFICATION
    if (state && state.step === 'AWAITING_PAYWAY_PAID_AMOUNT') {
        delete userState[userId];
        const amount = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(amount) || amount <= 0) {
            return ctx.replyWithHTML('❌ <b>ចំនួនទឹកប្រាក់មិនត្រឹមត្រូវ!</b>\nសូមចុច [ Add Funds/Wallet ] ម្ដងទៀត។', getMainKeyboard(lang));
        }

        let bonusPercent = (isBonusPromoOn && amount >= bonusMinDeposit) ? bonusPercentage : 0;
        let bonusAmount = (amount * bonusPercent) / 100;
        let totalCredit = amount + bonusAmount;
        const depId = `DEP${Math.floor(100000 + Math.random() * 900000)}`;

        const currentBal = getBalance(userId);
        const newBal = currentBal + totalCredit;
        await dbUpdateBalance(userId, newBal);

        if (supabase) {
            try {
                await supabase.from('deposits').insert([{
                    deposit_id: depId,
                    telegram_id: userId,
                    amount: amount,
                    bonus: bonusAmount,
                    status: 'Approved (PayWay Verified)'
                }]);
            } catch (e) {}
        }

        const successMsg = lang === 'en' ?
            `🎉 <b>ABA PayWay Payment Successful!</b>\n` +
            `----------------------------------------\n` +
            `💳 <b>Deposit Amount:</b> $${amount.toFixed(2)} USD\n` +
            `🎁 <b>Bonus:</b> +$${bonusAmount.toFixed(2)} USD\n` +
            `💰 <b>New Wallet Balance:</b> <b>$${newBal.toFixed(2)} USD</b>\n\n` +
            `⚡ Thank you for your payment!` :
            `🎉 <b>ABA PayWay ទូទាត់ប្រាក់ជោគជ័យ!</b>\n` +
            `----------------------------------------\n` +
            `💳 <b>ទឹកប្រាក់បញ្ចូល៖</b> $${amount.toFixed(2)} USD\n` +
            `🎁 <b>ថែម Bonus៖</b> +$${bonusAmount.toFixed(2)} USD\n` +
            `💰 <b>តុល្យភាពកាបូបលុយថ្មី៖</b> <b>$${newBal.toFixed(2)} USD</b>\n\n` +
            `⚡ អរគុណសម្រាប់ការទូទាត់ប្រាក់!`;

        await ctx.replyWithHTML(successMsg, getMainKeyboard(lang));

        // Post to Purchase Order Group (-1003953732694)
        const adminMsg = 
            `⚡ <b>AUTO-DEPOSIT APPROVED ( ABA PayWay )</b>\n` +
            `----------------------------------------\n` +
            `🆔 <b>Deposit ID:</b> <code>#${depId}</code>\n` +
            `📲 <b>User ID:</b> <code>${userId}</code>\n` +
            `👤 <b>Customer:</b> ${ctx.from.first_name || 'Customer'}\n` +
            `💳 <b>Amount:</b> $${amount.toFixed(2)} USD\n` +
            `🎁 <b>Bonus:</b> +$${bonusAmount.toFixed(2)} USD\n` +
            `🟢 <b>Status:</b> Auto-Credited ⚡`;

        try {
            await bot.telegram.sendMessage(TARGET_ADMIN_CHAT_ID, adminMsg, { parse_mode: 'HTML' });
        } catch (e) {}
        return;
    }

    if (text.startsWith('/') || text.includes('Back') || text.includes('ត្រឡប់') || text.includes('Account') || text.includes('គណនី') || text.includes('Funds') || text.includes('បញ្ចូល') || text.includes('Social') || text.includes('បណ្តាញ') || text.includes('Language') || text.includes('ភាសា') || text.includes('Continue') || text.includes('Cancel')) {
        return next();
    }

    // FLOW C: ORDER ID LOOKUP (e.g. #ORD-419873, ORD-419873, or AWAITING_CHECK_ORDER)
    const isCheckOrderState = state && state.step === 'AWAITING_CHECK_ORDER';
    const isOrderCodeFormat = text.toUpperCase().includes('ORD') || (/^\d+$/.test(text) && text.length >= 6);

    if (isCheckOrderState || isOrderCodeFormat) {
        if (!text.includes('/') && !text.toLowerCase().includes('http')) {
            delete userState[userId];
            let rawNum = text.replace(/[^0-9]/g, '');
            let searchPattern = text.trim();

            let foundOrder = null;

            // Search local memory cache
            if (userOrdersCache[userId] && userOrdersCache[userId].length > 0) {
                foundOrder = userOrdersCache[userId].find(o => 
                    o.order_id === searchPattern || 
                    o.order_id === `#${searchPattern}` || 
                    (rawNum && o.order_id.includes(rawNum))
                );
            }

            // Search Supabase DB
            if (!foundOrder && supabase) {
                try {
                    const { data } = await supabase
                        .from('orders')
                        .select('*')
                        .or(`order_id.ilike.%${rawNum || searchPattern}%,order_id.ilike.%${searchPattern.replace('#', '')}%`)
                        .maybeSingle();
                    foundOrder = data;
                } catch (e) {}
            }

            if (foundOrder) {
                const dateStr = foundOrder.created_at ? new Date(foundOrder.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Phnom_Penh' }) : '';
                const websiteUrl = process.env.WEB_APP_URL || 'https://telegram-bot-djpl.onrender.com';

                const orderCard = lang === 'km' ? 
                    `🔍 ━━━━━━━ [ <b>ORDER STATUS DETAILS</b> ] ━━━━━━━ 🔍\n----------------------------------------\n\n` +
                    `🆔 <b>Order ID ៖</b> <code>${foundOrder.order_id}</code> <i>( ចុចលើលេខដើម្បី Copy ⚡ )</i>\n` +
                    `📦 <b>កញ្ចប់សេវា ៖</b> ${foundOrder.package_name}\n` +
                    `💵 <b>តម្លៃទិញ ៖</b> <b>$${parseFloat(foundOrder.price || 0).toFixed(2)} USD</b> 💸\n` +
                    `🔗 <b>Link គោលដៅ ៖</b> ${foundOrder.target_link ? `<a href="${foundOrder.target_link}">${foundOrder.target_link}</a>` : 'N/A'}\n` +
                    `🟢 <b>ស្ថានភាពប្រព័ន្ធ ៖</b> <b>${foundOrder.status || 'Processing'} ⚡</b>\n` +
                    (dateStr ? `🕒 <b>កាលបរិច្ឆេទ ៖</b> <code>${dateStr}</code>\n\n` : '\n') +
                    `⚡ <i>សេវាកម្មដំណើរការស្វ័យប្រវត្តិ ២៤ម៉ោង!</i>` :

                    `🔍 ━━━━━━━ [ <b>ORDER STATUS DETAILS</b> ] ━━━━━━━ 🔍\n----------------------------------------\n\n` +
                    `🆔 <b>Order ID:</b> <code>${foundOrder.order_id}</code>\n` +
                    `📦 <b>Package:</b> ${foundOrder.package_name}\n` +
                    `💵 <b>Price:</b> <b>$${parseFloat(foundOrder.price || 0).toFixed(2)} USD</b> 💸\n` +
                    `🔗 <b>Target Link:</b> ${foundOrder.target_link ? `<a href="${foundOrder.target_link}">${foundOrder.target_link}</a>` : 'N/A'}\n` +
                    `🟢 <b>Status:</b> <b>${foundOrder.status || 'Processing'} ⚡</b>\n` +
                    (dateStr ? `🕒 <b>Date:</b> <code>${dateStr}</code>\n\n` : '\n') +
                    `⚡ <i>24/7 Automated processing!</i>`;

                const orderKb = Markup.inlineKeyboard([
                    [
                        Markup.button.callback(lang === 'km' ? '🛒 ទិញកញ្ចប់បន្ថែម (Buy Packages)' : '🛒 Buy Packages', 'history_buy_more'),
                        Markup.button.url(lang === 'km' ? '💬 ជំនួយ Admin (24/7)' : '💬 Order Support 24/7', 'https://t.me/Blessing_Kh_Supports')
                    ],
                    [
                        Markup.button.webApp(lang === 'km' ? `🌐 បើក ${BRAND_NAME} Website Portal ⚡` : `🌐 Open ${BRAND_NAME} Website Portal ⚡`, websiteUrl)
                    ]
                ]);

                return ctx.replyWithHTML(orderCard, { disable_web_page_preview: true, ...orderKb, ...getMainKeyboard(lang) });
            } else {
                const notFoundMsg = lang === 'km' ?
                    `❌ ━━━━━━━ [ <b>ORDER NOT FOUND</b> ] ━━━━━━━ ❌\n\n` +
                    `🔍 <b>រកមិនឃើញទិន្នន័យការបញ្ជាទិញលេខ <code>${text}</code> ឡើយ!</b>\n\n` +
                    `💡 <i>សូមពិនិត្យមើលលេខកូដបញ្ជាទិញឡើងវិញ ឬ ចុចប៊ូតុង [ 📅 ប្រវត្តិទិញ ] ខាងក្រោម ៖</i>` :

                    `❌ ━━━━━━━ [ <b>ORDER NOT FOUND</b> ] ━━━━━━━ ❌\n\n` +
                    `🔍 <b>Order ID <code>${text}</code> not found!</b>\n\n` +
                    `💡 <i>Please check your Order ID or view your order history below:</i>`;

                const notFoundKb = Markup.inlineKeyboard([
                    [
                        Markup.button.callback(lang === 'km' ? '📅 មើលប្រវត្តិទិញ (My Orders)' : '📅 View Order History', 'profile_my_orders'),
                        Markup.button.url(lang === 'km' ? '💬 ជំនួយ Admin (24/7)' : '💬 Admin Support', 'https://t.me/Blessing_Kh_Supports')
                    ]
                ]);

                return ctx.replyWithHTML(notFoundMsg, { disable_web_page_preview: true, ...notFoundKb, ...getMainKeyboard(lang) });
            }
        }
    }

    // CATCH URL LINKS SENT AT WRONG TIME / STEP & AUTO-GUIDE CUSTOMERS / ADMINS
    const isUrlInput = text.toLowerCase().includes('http') || text.toLowerCase().includes('tiktok.com') || text.toLowerCase().includes('vt.tiktok') || text.toLowerCase().includes('t.me/');
    
    if (isUrlInput) {
        const currentStep = state ? state.step : null;
        const isOrderStep = currentStep === 'AWAITING_LINK' || currentStep === 'AWAITING_POLICY_CONFIRM';
        const isAdminConfigStep = currentStep === 'AWAITING_ADMIN_HOWTO_LINK' || currentStep === 'AWAITING_ADMIN_PAYWAY_LINK' || currentStep === 'AWAITING_ADMIN_BROADCAST';

        if (!isOrderStep && !isAdminConfigStep) {
            const hasAdminPrefix = text.toLowerCase().startsWith('l:') || text.toLowerCase().startsWith('edit:');
            
            // Admin sending a link WITH L: prefix -> 1-Click Admin Confirmation prompt
            if (isAdmin(userId) && hasAdminPrefix) {
                let cleanUrl = text.trim();
                if (cleanUrl.toLowerCase().startsWith('l:')) cleanUrl = cleanUrl.substring(2).trim();
                if (cleanUrl.toLowerCase().startsWith('edit:')) cleanUrl = cleanUrl.substring(5).trim();
                if (!cleanUrl.startsWith('http') && cleanUrl.toLowerCase().includes('t.me')) cleanUrl = `https://${cleanUrl}`;

                userState[userId] = {
                    step: 'AWAITING_ADMIN_CONFIRM_HOWTO_LINK',
                    pendingLink: cleanUrl
                };

                const confirmLinkCard = 
                    `⚠️ <b>ផ្ទៀងផ្ទាត់ការកែប្រែ Link វីដេអូណែនាំ (Admin Link Confirmation) ៖</b>\n----------------------------------------\n\n` +
                    `🔗 <b>Link Telegram ថ្មី ៖</b> <code>${cleanUrl}</code>\n\n` +
                    `👇 <b>តើលោកអ្នកពិតជាចង់កំណត់ Link នេះជា How-to Video Link ថ្មី ឬ បោះបង់?</b>`;

                const adminLinkKb = Markup.inlineKeyboard([
                    [Markup.button.callback('✅ យល់ព្រមកំណត់ (Confirm Link)', 'confirm_save_howto_link')],
                    [Markup.button.callback('❌ បោះបង់ (Cancel)', 'cancel_admin_edit')]
                ]);

                return ctx.replyWithHTML(confirmLinkCard, { disable_web_page_preview: true, ...adminLinkKb });
            }

            // Customer or Admin sending TikTok link at wrong time -> Send 4-Step Guidance Notice
            const guideMsg = lang === 'km' ?
                `⚠️ <b>សូមធ្វើតាម ៤ ជំហាននៃការបញ្ជាទិញខាងក្រោម ៖</b>\n` +
                `----------------------------------------\n` +
                `1️⃣ ចុចប៊ូតុង <b>[ 🛒 ជ្រើសរើសសេវាកម្ម ]</b> នៅខាងក្រោម\n` +
                `2️⃣ ជ្រើសរើសប្រភេទសេវាកម្ម និង កញ្ចប់ Package\n` +
                `3️⃣ ចុចប៊ូតុង <b>[ 👍 បន្តការបញ្ជាទិញ ]</b>\n` +
                `4️⃣ រួចផ្ញើ Link វីដេអូ TikTok របស់អ្នក! 🔗\n\n` +
                `👇 <i>សូមជ្រើសរើសមេនុយខាងក្រោមដើម្បីចាប់ផ្តើម ៖</i>` :
                `⚠️ <b>Please follow the 4 steps below to order:</b>\n` +
                `----------------------------------------\n` +
                `1️⃣ Click <b>[ 🛒 TikTok Services ]</b> below\n` +
                `2️⃣ Select service category and Package\n` +
                `3️⃣ Click <b>[ 👍 Continue to Order ]</b>\n` +
                `4️⃣ Then send your TikTok Video Link! 🔗\n\n` +
                `👇 <i>Please select from the menu below:</i>`;
            return ctx.replyWithHTML(guideMsg, getMainKeyboard(lang));
        }

        if (currentStep === 'AWAITING_POLICY_CONFIRM') {
            state.step = 'AWAITING_LINK'; // Auto-advance so order processes smoothly
        }
    }

    if (!state) return next();

    // FLOW A: DEPOSIT AMOUNT INPUT
    if (state.step === 'AWAITING_DEPOSIT_AMOUNT') {
        const amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) {
            const err = lang === 'km' ? `❌ <b>ចំនួនទឹកប្រាក់មិនត្រឹមត្រូវ!</b>\nសូមបញ្ចូលចំនួនលេខ (ឧទាហរណ៍៖ 1 ឬ 5.50):` : `❌ <b>Invalid amount!</b>\nPlease enter a valid number (e.g. 1 or 5.50):`;
            return ctx.replyWithHTML(err);
        }

        let bonusPercent = (isBonusPromoOn && amount >= bonusMinDeposit) ? bonusPercentage : 0;
        let bonusAmount = (amount * bonusPercent) / 100;
        let totalReceived = amount + bonusAmount;
        const depositId = `DEP${Math.floor(100000 + Math.random() * 900000)}`;

        delete userState[userId];

        // Record Deposit in Supabase DB
        if (supabase) {
            try {
                await supabase.from('deposits').insert([{
                    deposit_id: depositId,
                    telegram_id: userId,
                    amount: amount,
                    bonus: bonusAmount,
                    status: 'Pending'
                }]);
            } catch (e) {}
        }

        await ctx.replyWithHTML(`🙏🏻 កំពុងបង្កើត QR សម្រាប់ <b>$${amount.toFixed(2)} USD</b>...`);

        if (depositMode === 'BAKONG') {
            const bakongMsg = 
                `💮 <b>Bakong KHQR Auto-Payment ( National Bank of Cambodia )</b>\n` +
                `----------------------------------------\n\n` +
                `ស្កែនជាមួយ App ធនាគារណាមួយ (ABA, ACLEDA, Bakong, Wing, Canadia...) ៖\n` +
                `🏦 <b>Merchant ID:</b> <code>${bakongAccountId || 'lasa_leng@aclb'}</code>\n\n` +
                `💳 <b>Deposit Amount: $${amount.toFixed(2)} USD</b>\n` +
                `🎁 <b>Bonus (${bonusPercent}%): +$${bonusAmount.toFixed(2)} USD</b>\n` +
                `🆔 <b>Deposit ID:</b> <code>#${depositId}</code>\n\n` +
                `⚡ <b>Bakong Open API Auto Verification 24/7 ៖</b>\n` +
                `<i>ប្រព័ន្ធ Bakong Open API នឹងផ្ទៀងផ្ទាត់ និង ទម្លាក់លុយចូលកាបូបលុយរបស់អ្នកស្វ័យប្រវត្តិ ១០០% ភ្លាមៗ ( មិនបាច់ចុចអ្វីឡើយ! ) ✨</i>`;

            const cancelKb = Markup.inlineKeyboard([
                [Markup.button.callback('❌ បោះបង់ការទូទាត់ (Cancel Deposit)', `cancel_dep_${depositId}`)]
            ]);

            let dynamicQrData = await fetchBakongApiKhqrString(bakongAccountId || 'lasa_leng@aclb', amount, depositId);
            if (!dynamicQrData) {
                dynamicQrData = generateDynamicKhqr(bakongAccountId || 'lasa_leng@aclb', BRAND_NAME, amount, depositId);
            }
            const md5Hash = require('crypto').createHash('md5').update(dynamicQrData).digest('hex');

            // Register for 100% Fully Automated Background Payment Engine
            registerPendingAutoDeposit(depositId, userId, amount, bonusAmount, md5Hash);
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(dynamicQrData)}`;

            try {
                await ctx.replyWithPhoto(
                    { url: qrImageUrl },
                    { caption: bakongMsg, parse_mode: 'HTML', ...cancelKb }
                );
            } catch (qrErr) {
                await ctx.replyWithHTML(bakongMsg, cancelKb);
            }
            return;
        }

        if (depositMode === 'PAYWAY') {
            const isKm = lang === 'km';
            const md5Hash = require('crypto').createHash('md5').update(depositId).digest('hex');
            registerPendingAutoDeposit(depositId, userId, amount, bonusAmount, md5Hash, 'PAYWAY');

            const paywayMsg = isKm ?
                `🏦 <b>ទូទាត់តាម ABA PayWay (Link ទូទាត់ប្រាក់)</b>\n----------------------------------------\n\n` +
                `💳 <b>ចំនួនប្រាក់ Deposit ៖ $${amount.toFixed(2)} USD</b>\n` +
                (bonusAmount > 0 ? `🎁 <b>Bonus ថែមជូន (${bonusPercent}%): +$${bonusAmount.toFixed(2)} USD</b>\n` : '') +
                `🆔 <b>លេខ Deposit ID:</b> <code>#${depositId}</code>\n\n` +
                `📲 <b>សូមចុចប៊ូតុង [ 🏦 ទូទាត់តាម ABA PayWay ] ខាងក្រោមដើម្បីទូទាត់ប្រាក់ ៖</b>\n` +
                `• គាំទ្រទូទាត់តាម ៖ <b>ABA Mobile App, Visa Card, Mastercard, KHQR</b>` :

                `🏦 <b>Payment via ABA PayWay Link</b>\n----------------------------------------\n\n` +
                `💳 <b>Deposit Amount: $${amount.toFixed(2)} USD</b>\n` +
                (bonusAmount > 0 ? `🎁 <b>Bonus (${bonusPercent}%): +$${bonusAmount.toFixed(2)} USD</b>\n` : '') +
                `🆔 <b>Deposit ID:</b> <code>#${depositId}</code>\n\n` +
                `📲 <b>Click the button [ 🏦 Pay via ABA PayWay ] below to make payment:</b>\n` +
                `• Supports: <b>ABA Mobile App, Visa Card, Mastercard, KHQR</b>`;

            const initialKb = Markup.inlineKeyboard([
                [Markup.button.callback(isKm ? '🏦 ទូទាត់តាម ABA PayWay (Auto) ⚡' : '🏦 Pay via ABA PayWay (Auto) ⚡', `open_payway_${depositId}_${amount}_${bonusAmount}`)]
            ]);

            return ctx.replyWithHTML(paywayMsg, initialKb);
        }

        if (depositMode === 'AUTO') {
            const acledaAutoMsg = 
                `🏦 <b>ACLEDA Bank Auto-Payment ( ACLEDA API Verified ⚡ )</b>\n` +
                `----------------------------------------\n\n` +
                `ស្កែន QR ខាងក្រោមជាមួយ App ធនាគារ អេស៊ីលីដា ឬ App ធនាគារផ្សេងៗ (KHQR) ៖\n` +
                `🏦 <b>Merchant ID:</b> <code>${acledaMerchantId || 'lasa_leng@aclb'}</code>\n\n` +
                `💳 <b>Deposit Amount: $${amount.toFixed(2)} USD</b>\n` +
                `🎁 <b>Bonus (${bonusPercent}%): +$${bonusAmount.toFixed(2)} USD</b>\n` +
                `🆔 <b>Deposit ID:</b> <code>#${depositId}</code>\n\n` +
                `⚡ <b>ACLEDA Auto-Verification API 24/7 ៖</b>\n` +
                `<i>ប្រព័ន្ធ ACLEDA API (Token: <code>${acledaApiToken ? acledaApiToken.slice(0, 8) + '...' : 'Active'}</code>) នឹងផ្ទៀងផ្ទាត់ និង ទម្លាក់លុយចូលកាបូបលុយរបស់អ្នកស្វ័យប្រវត្តិ ១០០% ភ្លាមៗ ( មិនបាច់ផ្ញើចុងសន្លឹកឡើយ! ) ✨</i>`;

            const cancelKb = Markup.inlineKeyboard([
                [Markup.button.callback('❌ បោះបង់ការទូទាត់ (Cancel Deposit)', `cancel_dep_${depositId}`)]
            ]);

            const dynamicQrData = generateDynamicKhqr(acledaMerchantId || 'lasa_leng@aclb', BRAND_NAME_UPPER, amount, depositId);
            const md5Hash = require('crypto').createHash('md5').update(dynamicQrData).digest('hex');

            // Register for 100% Fully Automated Background Payment Engine
            registerPendingAutoDeposit(depositId, userId, amount, bonusAmount, md5Hash);
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(dynamicQrData)}`;

            try {
                await ctx.replyWithPhoto(
                    { url: qrImageUrl },
                    { caption: acledaAutoMsg, parse_mode: 'HTML', ...cancelKb }
                );
            } catch (qrErr) {
                await ctx.replyWithHTML(acledaAutoMsg, cancelKb);
            }
            return;
        }

        // DEFAULT: MANUAL / ORIGINAL ADMIN APPROVAL MODE (Mode 1)
        const isKm = lang === 'km';

        const payInfo = isKm ?
            `💮 <b>QR ទូទាត់ប្រាក់ (ABA Pay, ACLEDA & KHQR)</b>\n----------------------------------------\n\n` +
            `ស្កែនជាមួយ App ធនាគារណាមួយ (ABA, ACLEDA, Bakong...) ៖\n` +
            `🏦 <b>ឈ្មោះគណនី (Account Name):</b> <b>${BRAND_NAME}</b>\n\n` +
            `💳 <b>ចំនួនប្រាក់ Deposit ៖ $${amount.toFixed(2)} USD</b>\n` +
            (bonusAmount > 0 ? `🎁 <b>Bonus ថែមជូន (${bonusPercent}%): +$${bonusAmount.toFixed(2)} USD</b>\n` : '') +
            `🆔 <b>លេខ Deposit ID:</b> <code>#${depositId}</code>\n\n` +
            `⚠️ <i>បន្ទាប់ពីវេរប្រាក់រួច សូមចុចប៊ូតុង <b>[ 💳 ខ្ញុំបានទូទាត់រួចរាល់ ]</b> ខាងក្រោម ៖</i>` :

            `💮 <b>Payment QR (ABA Pay, ACLEDA & KHQR)</b>\n----------------------------------------\n\n` +
            `Scan with any Banking App (ABA, ACLEDA, Bakong...) ៖\n` +
            `🏦 <b>Account Name:</b> <b>${BRAND_NAME}</b>\n\n` +
            `💳 <b>Deposit Amount: $${amount.toFixed(2)} USD</b>\n` +
            (bonusAmount > 0 ? `🎁 <b>Bonus (${bonusPercent}%): +$${bonusAmount.toFixed(2)} USD</b>\n` : '') +
            `🆔 <b>Deposit ID:</b> <code>#${depositId}</code>\n\n` +
            `⚠️ <i>After transferring, please click the <b>[ 💳 I Have Paid ]</b> button below ៖</i>`;

        const confirmPayKb = Markup.inlineKeyboard([
            [Markup.button.callback(isKm ? '💳 ខ្ញុំបានទូទាត់រួចរាល់' : '💳 I Have Paid (Confirm Payment)', `confirm_dep_${depositId}_${amount}_${bonusAmount}`)],
            [Markup.button.callback(isKm ? '❌ បោះបង់ការទូទាត់' : '❌ Cancel Payment', `cancel_dep_${depositId}`)]
        ]);

        const dynamicQrData = generateDynamicKhqr(acledaMerchantId || 'lasa_leng@aclb', BRAND_NAME, amount, depositId);
        const md5Hash = require('crypto').createHash('md5').update(dynamicQrData).digest('hex');

        // Mode 1 (Manual Admin Approval) does NOT register with the
        // background auto-payment engine — approve_dep/reject_dep already
        // work entirely off the callback_data embedded in the admin's
        // message and don't need pendingAutoDeposits at all, so registering
        // here would only burn Bakong's scarce daily quota polling a deposit
        // that a human, not the API, is going to settle.
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(dynamicQrData)}`;

        // Check for local ABA QR image file if provided
        const possibleQrFiles = ['manual_qr.jpg', 'manual_qr.png', 'aba_qr.jpg', 'aba_qr.png', 'khqr.jpg', 'khqr.png'];
        const localQr = possibleQrFiles.find(f => fs.existsSync(path.join(__dirname, f)));

        try {
            if (mode1CustomQrFileId) {
                await ctx.replyWithPhoto(
                    mode1CustomQrFileId,
                    { caption: payInfo, parse_mode: 'HTML', ...confirmPayKb }
                );
            } else if (localQr) {
                await ctx.replyWithPhoto(
                    { source: path.join(__dirname, localQr) },
                    { caption: payInfo, parse_mode: 'HTML', ...confirmPayKb }
                );
            } else {
                await ctx.replyWithPhoto(
                    { url: qrImageUrl },
                    { caption: payInfo, parse_mode: 'HTML', ...confirmPayKb }
                );
            }
        } catch (qrErr) {
            console.error('⚠️ Could not send QR photo, fallback to text:', qrErr.message);
            await ctx.replyWithHTML(payInfo, confirmPayKb);
        }

        const warningNote = isKm ?
            `⏰ <b>សូមកត់សម្គាល់បន្តិចបង!</b>\n` +
            `លុយដែលបង Deposit ចូលហើយ មិនទាន់អាចដកវិញបានទេណា 💖\n` +
            `គឺសម្រាប់ប្រើទិញសេវាក្នុង Bot តែប៉ុណ្ណោះ ⭐️` :
            
            `⏰ <b>Important Note!</b>\n` +
            `Deposited funds are non-refundable 💖\n` +
            `They are used exclusively for services inside the bot ⭐️`;

        return ctx.replyWithHTML(warningNote, getMainKeyboard(lang));
    }

    // FLOW B: ORDER LINK INPUT
    if (state.step === 'AWAITING_LINK') {
        if (!text.toLowerCase().includes('http') && !text.toLowerCase().includes('tiktok.com')) {
            const err = lang === 'km' ? `❌ <b>Link មិនត្រឹមត្រូវ!</b>\nសូមផ្ញើ Link TikTok ដែលត្រឹមត្រូវ (ឧទាហរណ៍៖ https://vt.tiktok.com/...):` : `❌ <b>Invalid Link!</b>\nPlease send a valid TikTok Link (e.g. https://vt.tiktok.com/...):`;
            return ctx.replyWithHTML(err);
        }

        const packageTitle = state.package;
        const price = state.price;

        delete userState[userId];

        const result = await finalizeOrder(userId, packageTitle, price, text, ctx.from.first_name);

        if (!result.success) {
            const err = lang === 'km' ?
                `❌ <b>តុល្យភាពលុយមិនគ្រប់គ្រាន់!</b>\n\n` +
                `📦 Package: <code>${packageTitle}</code>\n` +
                `💵 តម្លៃ៖ <b>$${price.toFixed(2)} USD</b>\n` +
                `👛 តុល្យភាពបច្ចុប្បន្ន៖ <b>$${result.currentBalance.toFixed(2)} USD</b>\n\n` +
                `សូមចុច <b>👛 បញ្ចូលលុយ</b> ដើម្បីបញ្ចូលលុយជាមុនសិន!` :
                `❌ <b>Insufficient Balance!</b>\n\n` +
                `📦 Package: <code>${packageTitle}</code>\n` +
                `💵 Price: <b>$${price.toFixed(2)} USD</b>\n` +
                `👛 Current Balance: <b>$${result.currentBalance.toFixed(2)} USD</b>\n\n` +
                `Please click <b>👛 Add Funds</b> to deposit first!`;
            return ctx.replyWithHTML(err, getMainKeyboard(lang));
        }

        // finalizeOrder() already DMs the customer their order confirmation
        // (same message/keyboard whether ordering from the bot chat or the
        // website) — nothing further to send here.
        return;
    }

    // ADMIN STEPS IN TEXT INPUT
    if (state.step === 'AWAITING_ADMIN_SET_BONUS_PERCENT') {
        const rate = parseFloat(text);
        if (isNaN(rate) || rate < 0) {
            return ctx.replyWithHTML('❌ <b>សូមវាយបញ្ចូលចំនួនភាគរយជាលេខត្រឹមត្រូវ (ឧទាហរណ៍ ៖ 5, 10, 15) ៖</b>');
        }
        bonusPercentage = rate;
        delete userState[userId];
        return ctx.replyWithHTML(`✅ <b>កែប្រែភាគរយ Bonus ទៅជា +${bonusPercentage}% ដោយជោគជ័យ!</b>`, getAdminPromoKeyboard());
    }

    if (state.step === 'AWAITING_ADMIN_SET_BONUS_MIN') {
        const minDep = parseFloat(text);
        if (isNaN(minDep) || minDep < 0) {
            return ctx.replyWithHTML('❌ <b>សូមវាយបញ្ចូលចំនួនប្រាក់ជាលេខត្រឹមត្រូវ (ឧទាហរណ៍ ៖ 5, 10) ៖</b>');
        }
        bonusMinDeposit = minDep;
        delete userState[userId];
        return ctx.replyWithHTML(`✅ <b>កែប្រែប្រាក់ទាបបំផុតដើម្បីទទួលបាន Bonus ទៅជា $${bonusMinDeposit.toFixed(2)} USD ដោយជោគជ័យ!</b>`, getAdminPromoKeyboard());
    }

    if (state.step === 'AWAITING_ADMIN_SET_ACLEDA_TOKEN') {
        const newToken = text.trim();
        acledaApiToken = newToken;
        isAcledaPaymentOn = true;
        delete userState[userId];
        const masked = `${newToken.slice(0, 8)}...${newToken.slice(-6)}`;
        return ctx.replyWithHTML(`✅ <b>បានរក្សាទុក ACLEDA API Token (<code>${masked}</code>) និង បើកដំណើការ ACLEDA Auto-Pay ដោយជោគជ័យ!</b>`, getAdminSettingsKeyboard());
    }

    if (state.step === 'AWAITING_ADMIN_HOWTO_LINK') {
        delete userState[userId];
        const cleanUrl = text.trim();
        howtoVideoLinks = [cleanUrl, cleanUrl, cleanUrl];
        return ctx.replyWithHTML(`✅ <b>បានកែប្រែ How-to Video Link ថ្មីជោគជ័យ ៖</b>\n<code>${howtoVideoLinks[0]}</code>`, adminToolsKeyboard);
    }

    if (state.step === 'AWAITING_ADMIN_BROADCAST') {
        delete userState[userId];
        const msgId = ctx.message.message_id;
        const fromChatId = ctx.chat.id;

        const usersList = await getAllBroadcastUsers();

        const previewPrompt = 
            `👁️ <b>មើលគំរូសារប្រកាសជាមុន (Broadcast Message Preview) ៖</b>\n` +
            `----------------------------------------\n` +
            `📊 <b>ចំនួនអតិថិជនរង់ចាំទទួលសារ ៖</b> <b>${usersList.length} Users</b>\n\n` +
            `👉 <i>សូមពិនិត្យគំរូសារខាងក្រោម ៖ ប្រសិនបើត្រឹមត្រូវ សូមចុចប៊ូតុង <b>[ 🚀 ផ្ញើទៅកាន់អតិថិជនទាំងអស់ ]</b> ខាងក្រោម ៖</i>`;

        const bcastKb = Markup.inlineKeyboard([
            [Markup.button.callback('🚀 ផ្ញើទៅកាន់អតិថិជនទាំងអស់ (Send Broadcast)', `send_bcast_${msgId}`)],
            [Markup.button.callback('❌ បោះបង់ (Cancel)', 'cancel_bcast')]
        ]);

        await ctx.replyWithHTML(previewPrompt, adminToolsKeyboard);
        
        try {
            await ctx.telegram.copyMessage(fromChatId, fromChatId, msgId, { reply_markup: bcastKb.reply_markup });
        } catch (e) {
            await ctx.replyWithHTML('⚠️ Could not generate message preview, but message ID is captured.', bcastKb);
        }
        return;
    }
    // Unhandled Link Catch (Strict Separation between Admin Links & Customer Order Links)
    const isLink = text.toLowerCase().includes('http://') || text.toLowerCase().includes('https://') || text.toLowerCase().includes('tiktok.com') || text.toLowerCase().includes('t.me/');
    if (isLink) {
        if (isAdmin(userId)) {
            // Admin sent a link outside active step -> Offer 1-Click Save as How-to Link
            const cleanUrl = text.trim();
            userState[userId] = { pendingLink: cleanUrl };
            const adminLinkKb = Markup.inlineKeyboard([
                [Markup.button.callback('✅ កំណត់ជា How-to Video Link ថ្មី', 'confirm_howto_link_direct')],
                [Markup.button.callback('❌ អត់ទេ (បោះបង់)', 'cancel_admin_link')]
            ]);

            return ctx.replyWithHTML(
                `✍️ <b>លោកអ្នកបានផ្ញើ Link Telegram ៖</b>\n<code>${cleanUrl}</code>\n\n` +
                `តើបងជា Admin ចង់កំណត់ Link នេះជា <b>How-to Video Link ថ្មី</b> ដែរឬទេ?`,
                { disable_web_page_preview: true, ...adminLinkKb }
            );
        } else {
            // Customer sent a link outside order flow -> Gentle Order Guide Notice
            return ctx.replyWithHTML(
                `⚠️ <b>លោកអ្នកមិនទាន់បានជ្រើសរើស Package សេវាកម្មនៅឡើយទេ!</b>\n----------------------------------------\n\n` +
                `👉 <i>សូមចុចមេនុយ <b>[ 🎵 សេវាកម្ម TikTok Khmer ]</b> ខាងក្រោម រួចជ្រើសរើសកញ្ចប់សេវាជាមុនសិន មុននឹងផ្ញើ Link បញ្ជាទិញ។</i>`,
                getMainKeyboard(lang)
            );
        }
    }

    return next();
});

// Admin 1-Click How-to Link Save Action Handlers
bot.action('confirm_howto_link_direct', async (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    const pendingUrl = userState[userId]?.pendingLink;
    delete userState[userId];

    if (pendingUrl) {
        howtoVideoLinks = [pendingUrl, pendingUrl, pendingUrl];
        try {
            await ctx.answerCbQuery('✅ បានប្តូរ How-to Link ថ្មី!');
        } catch (e) {}
        return ctx.replyWithHTML(
            `✅ <b>បានកែប្រែ និង រក្សាទុក How-to Video Link ថ្មីជោគជ័យ ៖</b>\n<code>${howtoVideoLinks[0]}</code>`,
            adminToolsKeyboard
        );
    }
});

bot.action('cancel_admin_link', async (ctx) => {
    delete userState[ctx.from.id];
    try {
        await ctx.answerCbQuery('❌ បានបោះបង់');
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (e) {}
});

// Helper function to gather all unique Telegram user IDs across DB and memory
async function getAllBroadcastUsers() {
    let idsSet = new Set(Array.from(registeredAdminIds).map(id => String(id)));

    Object.keys(userBalances).forEach(id => idsSet.add(String(id)));
    Object.keys(userState).forEach(id => idsSet.add(String(id)));

    if (supabase) {
        try {
            const { data: uData } = await supabase.from('users').select('telegram_id');
            if (uData && uData.length > 0) {
                uData.forEach(u => { if (u.telegram_id) idsSet.add(String(u.telegram_id)); });
            }
        } catch (e) {}

        try {
            const { data: dData } = await supabase.from('deposits').select('telegram_id');
            if (dData && dData.length > 0) {
                dData.forEach(d => { if (d.telegram_id) idsSet.add(String(d.telegram_id)); });
            }
        } catch (e) {}

        try {
            const { data: oData } = await supabase.from('orders').select('telegram_id');
            if (oData && oData.length > 0) {
                oData.forEach(o => { if (o.telegram_id) idsSet.add(String(o.telegram_id)); });
            }
        } catch (e) {}
    }

    return Array.from(idsSet);
}

// CATCH PHOTO FOR BROADCAST WITH CAPTION OR MODE 1 QR PHOTO UPDATE
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];

    if (isAdmin(userId) && state && state.step === 'AWAITING_ADMIN_MODE1_QR_PHOTO') {
        delete userState[userId];
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        mode1CustomQrFileId = photo.file_id;

        // Save photo directly to manual_qr.jpg, manual_qr.png, aba_qr.jpg, khqr.jpg
        try {
            const fileLink = await bot.telegram.getFileLink(photo.file_id);
            const res = await fetch(fileLink.href);
            const buffer = Buffer.from(await res.arrayBuffer());
            fs.writeFileSync(path.join(__dirname, 'manual_qr.jpg'), buffer);
            fs.writeFileSync(path.join(__dirname, 'manual_qr.png'), buffer);
            fs.writeFileSync(path.join(__dirname, 'aba_qr.jpg'), buffer);
            fs.writeFileSync(path.join(__dirname, 'khqr.jpg'), buffer);
            console.log('✅ Mode 1 QR photo updated live on disk & memory!');
        } catch (e) {
            console.error('⚠️ Could not write QR photo to disk:', e.message);
        }

        return ctx.replyWithHTML(
            `✅ <b>បានផ្លាស់ប្តូររូបថត QR សម្រាប់ Mode 1 រួចរាល់ 100%!</b>\n----------------------------------------\n\n` +
            `🖼️ <b>រូបថត QR ថ្មីត្រូវ បានរក្សាទុក និង បើកដំណើការភ្លាមៗ! 🚀</b>\n` +
            `អតិថិជនដែលប្រើប្រាស់ Mode 1 នឹងទទួលបានរូបថត QR ថ្មីនេះដើម្បីស្កែនទូទាត់ប្រាក់។`,
            getAdminSettingsKeyboard()
        );
    }

    if (isAdmin(userId) && state && state.step === 'AWAITING_ADMIN_BROADCAST') {
        delete userState[userId];
        const msgId = ctx.message.message_id;
        const fromChatId = ctx.chat.id;

        const usersList = await getAllBroadcastUsers();

        const previewPrompt = 
            `👁️ <b>មើលគំរូសារប្រកាសជាមុន (Broadcast Message Preview) ៖</b>\n` +
            `----------------------------------------\n` +
            `📊 <b>ចំនួនអតិថិជនរង់ចាំទទួលសារ ៖</b> <b>${usersList.length} Users</b>\n\n` +
            `👉 <i>សូមពិនិត្យគំរូសារខាងក្រោម ៖ ប្រសិនបើត្រឹមត្រូវ សូមចុចប៊ូតុង <b>[ 🚀 ផ្ញើទៅកាន់អតិថិជនទាំងអស់ ]</b> ខាងក្រោម ៖</i>`;

        const bcastKb = Markup.inlineKeyboard([
            [Markup.button.callback('🚀 ផ្ញើទៅកាន់អតិថិជនទាំងអស់ (Send Broadcast)', `send_bcast_${msgId}`)],
            [Markup.button.callback('❌ បោះបង់ (Cancel)', 'cancel_bcast')]
        ]);

        await ctx.replyWithHTML(previewPrompt, adminToolsKeyboard);
        
        try {
            await ctx.telegram.copyMessage(fromChatId, fromChatId, msgId, { reply_markup: bcastKb.reply_markup });
        } catch (e) {
            await ctx.replyWithHTML('⚠️ Could not generate message preview, but message ID is captured.', bcastKb);
        }
        return;
    }
});

// CATCH VIDEO, AUDIO, VOICE, DOCUMENT, STICKER, VIDEO_NOTE FOR BROADCAST
bot.on(['video', 'audio', 'voice', 'document', 'sticker', 'video_note'], async (ctx, next) => {
    const userId = ctx.from.id;
    const state = userState[userId];

    if (isAdmin(userId) && state && state.step === 'AWAITING_ADMIN_BROADCAST') {
        delete userState[userId];
        const msgId = ctx.message.message_id;
        const fromChatId = ctx.chat.id;

        const usersList = await getAllBroadcastUsers();

        const previewPrompt = 
            `👁️ <b>មើលគំរូសារប្រកាសជាមុន (Broadcast Message Preview) ៖</b>\n` +
            `----------------------------------------\n` +
            `📊 <b>ចំនួនអតិថិជនរង់ចាំទទួលសារ ៖</b> <b>${usersList.length} Users</b>\n\n` +
            `👉 <i>សូមពិនិត្យគំរូសារខាងក្រោម ៖ ប្រសិនបើត្រឹមត្រូវ សូមចុចប៊ូតុង <b>[ 🚀 ផ្ញើទៅកាន់អតិថិជនទាំងអស់ ]</b> ខាងក្រោម ៖</i>`;

        const bcastKb = Markup.inlineKeyboard([
            [Markup.button.callback('🚀 ផ្ញើទៅកាន់អតិថិជនទាំងអស់ (Send Broadcast)', `send_bcast_${msgId}`)],
            [Markup.button.callback('❌ បោះបង់ (Cancel)', 'cancel_bcast')]
        ]);

        await ctx.replyWithHTML(previewPrompt, adminToolsKeyboard);
        
        try {
            await ctx.telegram.copyMessage(fromChatId, fromChatId, msgId, { reply_markup: bcastKb.reply_markup });
        } catch (e) {
            await ctx.replyWithHTML('⚠️ Could not generate message preview, but message ID is captured.', bcastKb);
        }
        return;
    }

    return next();
});

// UNIVERSAL BROADCAST EXECUTION ACTION (COPIES ANY MESSAGE FORMAT 100% IDENTICALLY)
bot.action(/^send_bcast_(\d+)$/, async (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return ctx.answerCbQuery('⛔ សម្រាប់តែ Admin!');
    const msgId = parseInt(ctx.match[1]);

    try {
        await ctx.answerCbQuery('🚀 កំពុងផ្ញើសារប្រកាសទៅកាន់អតិថិជនទាំងអស់...');
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (e) {}

    const usersList = await getAllBroadcastUsers();
    await ctx.replyWithHTML(`⏳ <b>កំពុងផ្ញើសារប្រកាសជូនដំណឹងទៅកាន់ ${usersList.length} Users & Group...</b>`);

    let success = 0;
    let failed = 0;
    let channelPosted = false;

    // 1. Copy message 1-to-1 to all registered users
    for (const uId of usersList) {
        try {
            await bot.telegram.copyMessage(uId, userId, msgId);
            success++;
        } catch (e) {
            failed++;
        }
    }

    // 2. Copy message to ${BRAND_NAME}_Channel (https://t.me/+4JRdF_NXZTFlNmY1 / ID: -1003926070646)
    const targetChannel = detectedChannelChatId || process.env.BROADCAST_CHANNEL_ID || process.env.CHANNEL_CHAT_ID || -1003926070646;
    if (targetChannel) {
        try {
            await bot.telegram.copyMessage(targetChannel, userId, msgId);
            channelPosted = true;
        } catch (e) {
            console.error('⚠️ Could not copy broadcast message to channel:', e.message);
        }
    }

    const reportMsg = 
        `✅ <b>បានផ្ញើសារប្រកាសជូនដំណឹងជោគជ័យ ១០០%! (Broadcast Complete)</b>\n` +
        `----------------------------------------\n\n` +
        `🟢 <b>ផ្ញើជូនអតិថិជន 1-on-1 ៖</b> <b>${success} Users</b>\n` +
        `🔴 <b>បរាជ័យ (Block Bot) ៖</b> <b>${failed} Users</b>\n` +
        `📢 <b>ប្រកាសចូល ${BRAND_NAME}_Channel ៖</b> ${channelPosted ? 'ជោគជ័យ ✅' : 'អត់បានផ្ញើ (សូម Add Bot ចូល Channel ជា Admin)'}`;

    return ctx.replyWithHTML(reportMsg, adminToolsKeyboard);
});

bot.action('cancel_bcast', async (ctx) => {
    try {
        await ctx.answerCbQuery('❌ បានបោះបង់សារប្រកាស');
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        await ctx.replyWithHTML('❌ <b>បានបោះបង់ការផ្ញើសារប្រកាសជូនដំណឹង។</b>', adminToolsKeyboard);
    } catch (e) {}
});

// CATCH VIDEO FILE ID FOR HOW-TO-ORDER GUIDE
bot.on(['video', 'document'], (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];
    const isVideo = !!ctx.message.video;
    const fileId = ctx.message.video?.file_id || ctx.message.document?.file_id;

    if (fileId) {
        if (isAdmin(userId) && state && state.step === 'AWAITING_ADMIN_START_MEDIA') {
            delete userState[userId];
            customHowToOrderVideoId = fileId;
            saveMediaConfig(fileId);
            return ctx.replyWithHTML(
                `✅ <b>បានផ្លាស់ប្តូរ និង រក្សាទុកវីដេអូណែនាំរបៀបបញ្ជាទិញជោគជ័យ 100%!</b>\n----------------------------------------\n\n` +
                `🎬 <b>Video File ID ៖</b> <code>${fileId}</code>\n\n` +
                `✨ <i>អតិថិជនចុចមេនុយ [ 💡 របៀបបញ្ជាទិញ ] ឬ ចុច /start នឹងបានមើល Video Card ធំស្អាតនេះភ្លាមៗ! 🚀</i>`,
                adminToolsKeyboard
            );
        }

        if (isAdmin(userId) && isVideo) {
            customHowToOrderVideoId = fileId;
            saveMediaConfig(fileId);
            return ctx.replyWithHTML(
                `✅ <b>ទទួលបាន និង កំណត់ Video File ID ស្វ័យប្រវត្តិ ៖</b>\n<code>${fileId}</code>\n\n` +
                `✨ <i>អតិថិជនចុចមេនុយ [ 💡 របៀបបញ្ជាទិញ ] ឬ ចុច /start នឹងបានមើល Video Card ធំស្អាតនេះភ្លាមៗ! 🚀</i>`,
                adminToolsKeyboard
            );
        }
    }
});

// 📈 TOP-UP REPORTS (computed from real Supabase deposit records)
function isSuccessfulDepositStatus(status) {
    return !!status && (status.startsWith('Approved') || status === 'Completed');
}

bot.hears(['📈 · Top-up reports', 'Top-up reports'], async (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    if (!supabase) {
        return ctx.replyWithHTML(
            `📈 <b>Top-up Reports</b>\n----------------------------------------\n\n` +
            `⚠️ <b>Database មិនត្រូវបានភ្ជាប់ទេ (Supabase not configured)</b>\n` +
            `មិនអាចគណនា report បានទេ លុះត្រាតែកំណត់ <code>SUPABASE_URL</code>/<code>SUPABASE_KEY</code>។`,
            adminAnalyticsKeyboard
        );
    }

    try {
        const { data, error } = await supabase.from('deposits').select('amount, status, created_at');
        if (error) throw error;

        const successful = (data || []).filter(d => isSuccessfulDepositStatus(d.status));

        const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
        const startOfWeek = new Date(startOfDay); startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const start3Months = new Date(now); start3Months.setMonth(now.getMonth() - 3);

        const sumSince = (since) => successful
            .filter(d => new Date(d.created_at) >= since)
            .reduce((acc, d) => acc + parseFloat(d.amount || 0), 0);

        const todayTotal = sumSince(startOfDay);
        const weekTotal = sumSince(startOfWeek);
        const monthTotal = sumSince(startOfMonth);
        const last3MonthsTotal = sumSince(start3Months);
        const allTimeTotal = successful.reduce((acc, d) => acc + parseFloat(d.amount || 0), 0);

        const reportsMsg =
            `📈 <b>Top-up Reports</b>\n` +
            `⏰ Generated: ${dateStr} ${now.toLocaleTimeString('en-US', { hour12: false })} (Cambodia Time)\n` +
            `----------------------------------------\n\n` +
            `📅 <b>Today's Top-up</b>\n💸 Total: <b>$${todayTotal.toFixed(2)}</b>\n\n` +
            `📌 <b>This Week's Top-up</b>\n💸 Total: <b>$${weekTotal.toFixed(2)}</b>\n\n` +
            `📆 <b>This Month's Top-up</b>\n💸 Total: <b>$${monthTotal.toFixed(2)}</b>\n\n` +
            `📊 <b>Last 3 Months Top-up</b>\n💸 Total: <b>$${last3MonthsTotal.toFixed(2)}</b>\n\n` +
            `💰 <b>Total Top-up Since Bot Creation</b>\n💸 Total: <b>$${allTimeTotal.toFixed(2)}</b>\n\n` +
            `<i>(${successful.length} successful deposit(s) counted)</i>`;

        ctx.replyWithHTML(reportsMsg, adminAnalyticsKeyboard);
    } catch (e) {
        console.error('⚠️ Top-up reports query error:', e.message);
        ctx.replyWithHTML(
            `📈 <b>Top-up Reports</b>\n----------------------------------------\n\n` +
            `⚠️ <b>មិនអាចទាញទិន្នន័យបានទេ (query error)។</b>`,
            adminAnalyticsKeyboard
        );
    }
});

// 📋 DEPOSIT LOG & PANEL BALANCE
bot.hears(['📋 · Deposit log', '💰 · Panel balance', 'Deposit log', 'Panel balance'], async (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    if (!supabase) {
        return ctx.replyWithHTML(
            `💰 <b>Panel Balance & Deposit Log</b>\n----------------------------------------\n\n` +
            `⚠️ <b>Database មិនត្រូវបានភ្ជាប់ទេ (Supabase not configured)</b>`,
            adminAnalyticsKeyboard
        );
    }

    try {
        const { data: users } = await supabase.from('users').select('balance');
        const totalWalletBalance = (users || []).reduce((acc, u) => acc + parseFloat(u.balance || 0), 0);

        const { data: recentDeposits } = await supabase
            .from('deposits')
            .select('deposit_id, amount, status, created_at')
            .order('created_at', { ascending: false })
            .limit(5);

        const logLines = (recentDeposits || []).length > 0
            ? recentDeposits.map(d =>
                `• <code>${d.deposit_id}</code> — $${parseFloat(d.amount || 0).toFixed(2)} — ${d.status}`
              ).join('\n')
            : 'មិនទាន់មាន deposit ណាមួយត្រូវបានកត់ត្រាទេ។';

        const msg =
            `💰 <b>Panel Balance & Deposit Log</b>\n----------------------------------------\n\n` +
            `💳 <b>Total User Wallet Balances (all customers combined):</b> $${totalWalletBalance.toFixed(2)} USD\n` +
            `<i>(សរុប balance ដែលអតិថិជនទាំងអស់កាន់កាប់ក្នុងកាបូបលុយ — មិនមែនចំណូលក្រុមហ៊ុនទេ)</i>\n\n` +
            `📜 <b>Recent Deposits (last 5):</b>\n${logLines}`;

        ctx.replyWithHTML(msg, adminAnalyticsKeyboard);
    } catch (e) {
        console.error('⚠️ Panel balance query error:', e.message);
        ctx.replyWithHTML(
            `💰 <b>Panel Balance & Deposit Log</b>\n----------------------------------------\n\n` +
            `⚠️ <b>មិនអាចទាញទិន្នន័យបានទេ (query error)។</b>`,
            adminAnalyticsKeyboard
        );
    }
});

// ⚙️ BOT SETTINGS MENU
bot.hears(['⚙️ Bot Settings', 'Bot Settings'], (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    if (!isAdmin(userId)) return;

    const msg = 
        `⚙️ ━━━━━━━ [ <b>BOT SETTINGS</b> ] ━━━━━━━ ⚙️\n\n` +
        `Manage payment gateways, bonus promotion rates, and system settings ៖`;

    ctx.replyWithHTML(msg, getAdminSettingsKeyboard());
});

// 🖼️ CHANGE MODE 1 QR PHOTO
bot.hears(['🖼️ · Change Mode1 QR Photo', 'Change Mode1 QR Photo', 'Change Mode1 QR'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    userState[userId] = { step: 'AWAITING_ADMIN_MODE1_QR_PHOTO' };
    const prompt = 
        `🖼️ <b>ផ្លាស់ប្តូររូបថត QR សម្រាប់ Mode 1 (តម្រូវអនុម័ត) ៖</b>\n----------------------------------------\n\n` +
        `✍️ <b>សូមផ្ញើរូបថត QR ថ្មី ( ផ្ញើជារូប Photo ) មកកាន់ Bot ៖</b>\n\n` +
        `<i>(រូបថត QR ថ្មីនេះ នឹងត្រូវប្រើប្រាស់ស្វ័យប្រវត្តិ សម្រាប់អតិថិជនស្កែនទូទាត់ប្រាក់ក្នុង Mode 1)</i>`;

    ctx.replyWithHTML(prompt, Markup.keyboard([['🔐 Admin Menu']]).resize());
});

// 🏦 PAYWAY LINK SETTING
bot.hears(['🏦 · PayWay Link', 'PayWay Link'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    userState[userId] = { step: 'AWAITING_ADMIN_PAYWAY_LINK' };

    const msg = 
        `🏦 <b>Change ABA PayWay Link</b>\n\n` +
        `📋 Current link: <code>${paywayMerchantLink}</code>\n\n` +
        `✍️ Send the new PayWay payment link or slug (e.g. ABAPAYZy493509E):`;

    ctx.replyWithHTML(msg, Markup.keyboard([['🔐 Admin Menu']]).resize());
});

// 🎁 PROMOTION SETTINGS MENU
bot.hears(['🎁 Promotion Settings', 'Promotion Settings', '🎁 Promotion'], (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    if (!isAdmin(userId)) return;

    const promoStatusStr = isBonusPromoOn 
        ? `🟢 <b>Enabled (+${bonusPercentage}% on $${bonusMinDeposit.toFixed(2)}+)</b>` 
        : '🔴 <b>Disabled</b>';

    const msg = 
        `🎁 ━━━━━━━ [ <b>PROMOTION SETTINGS</b> ] ━━━━━━━ 🎁\n\n` +
        `Manage bonus promotions, deposit reward rates, and minimum thresholds ៖\n\n` +
        `• <b>Promotion Status:</b> ${promoStatusStr}\n` +
        `• <b>Bonus Rate:</b> <b>+${bonusPercentage}%</b>\n` +
        `• <b>Min Deposit Threshold:</b> <b>$${bonusMinDeposit.toFixed(2)} USD</b>`;

    ctx.replyWithHTML(msg, getAdminPromoKeyboard());
});

// 🎁 BONUS PROMOTION TOGGLE
bot.hears([/🎁 Bonus \(/i, /🎁 Bonus/i], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;
    isBonusPromoOn = !isBonusPromoOn;
    ctx.replyWithHTML(`✅ <b>Bonus Promotion is now ${isBonusPromoOn ? 'ENABLED' : 'DISABLED'}!</b>`, getAdminPromoKeyboard());
});

// Dynamic Group & Channel Chat ID Auto-Catcher
let autoDetectedGroupId = null;
let detectedChannelChatId = process.env.BROADCAST_CHANNEL_ID || process.env.CHANNEL_CHAT_ID || -1003926070646;

bot.use((ctx, next) => {
    if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup' || ctx.chat.type === 'channel')) {
        autoDetectedGroupId = ctx.chat.id;
        if (ctx.chat.type === 'channel') detectedChannelChatId = ctx.chat.id;
        console.log('📌 Auto-detected Chat ID:', ctx.chat.id, 'Type:', ctx.chat.type);
    }
    return next();
});

// /id Command to get Chat ID easily (supports Groups & Channels)
bot.hears([/\/id/i, /^\/id/i, /^id$/i], (ctx) => {
    if (ctx.chat) {
        autoDetectedGroupId = ctx.chat.id;
        if (ctx.chat.type === 'channel') detectedChannelChatId = ctx.chat.id;
        ctx.replyWithHTML(`🆔 <b>Chat ID របស់អ្នកគឺ ៖</b> <code>${ctx.chat.id}</code>`);
    }
});

// Listen to Channel posts for /id command in Channels
bot.on('channel_post', (ctx) => {
    if (ctx.chat && ctx.chat.type === 'channel') {
        detectedChannelChatId = ctx.chat.id;
        autoDetectedGroupId = ctx.chat.id;
        console.log('📌 Channel Post Chat ID:', ctx.chat.id);
        const text = ctx.channelPost ? (ctx.channelPost.text || '').trim() : '';
        if (text.toLowerCase().includes('/id') || text.toLowerCase() === 'id') {
            ctx.replyWithHTML(`🆔 <b>Channel Chat ID របស់អ្នកគឺ ៖</b> <code>${ctx.chat.id}</code>`);
        }
    }
});

// Welcome message & auto ID capture when bot is added to group
bot.on('new_chat_members', (ctx) => {
    if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
        autoDetectedGroupId = ctx.chat.id;
        ctx.replyWithHTML(`👋 <b>សួស្តី!</b>\n\n🆔 <b>Group Chat ID របស់អ្នកគឺ ៖</b> <code>${ctx.chat.id}</code>`);
    }
});

// ==========================================
// 4. ELEGANT ADMIN CONTROL PANEL SYSTEM
// ==========================================
let isBotOpen = true; // Bot status: open or maintenance
let isBonusPromoOn = true;
let bonusPercentage = 5; // Default: 5% bonus
let bonusMinDeposit = 5.00; // Default: $5.00 minimum deposit
let isBakongPaymentOn = true;
let isInstantAutoDepositOn = true; // Mode 3: ABA PayWay Merchant Auto-Payment
let depositMode = 'MANUAL'; // Default: Mode 1 - Manual Admin Approval ('MANUAL')
let mode1CustomQrFileId = null; // Custom uploaded Mode 1 QR photo file ID
let customHowToOrderVideoId = null; // Custom uploaded how-to-order video file ID
const processedDepositIds = new Set(); // Multi-layer anti-duplicate click protection set
const processedOrderActions = new Set(); // Prevents an order being Done AND Cancel/Refund'd (or either twice)
let paywayMerchantLink = process.env.PAYWAY_LINK || 'https://link.payway.com.kh/ABAPAYJj498612l';
// howtoVideoLinks is declared earlier (near loadHowtoConfig/saveHowtoConfig) so the
// startup loadHowtoConfig() call can assign it without a temporal-dead-zone error.

// Authorized Admin Telegram IDs (Strict Security: Only 521984577)
// Default admin IDs used only when ADMIN_IDS is not set in .env — set ADMIN_IDS
// to take full, exclusive control of who has admin access.
const DEFAULT_ADMIN_IDS = [521984577];
const registeredAdminIds = new Set(
    process.env.ADMIN_IDS
        ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
        : DEFAULT_ADMIN_IDS
);
// Merge in admins added at runtime via the "Manage Admins" menu (loaded from admins_config.json above)
extraAdminIds.forEach(id => registeredAdminIds.add(id));

// Host support access — for white-label clones of this bot (see NEW_CLIENT_SETUP.md),
// the hosting provider sets their own Telegram ID here to retain admin access for
// support/billing on every clone they host. Unlike the old hardcoded ALLOWED_ADMIN_IDS
// bypass (removed as a security fix), this is a named, client-visible env var the
// client can see in their own deployment and revoke by simply not setting it.
const hostSuperAdminIds = new Set(
    (process.env.HOST_SUPER_ADMIN_ID || '')
        .split(',')
        .map(id => parseInt(id.trim()))
        .filter(id => !isNaN(id))
);

function isAdmin(userId) {
    if (!userId) return false;
    const numericId = parseInt(userId);
    return registeredAdminIds.has(numericId) || hostSuperAdminIds.has(numericId);
}

// Dynamic Admin Keyboards Generator
function getAdminMainKeyboard() {
    return Markup.keyboard([
        ['🎵 Users & Balances', '⚙️ Bot Settings'],
        ['🎁 Promotion Settings', '📊 Analytics & Reports'],
        ['🛠️ Tools & System', isBotOpen ? '🟢 · Bot: open' : '🔴 · Bot: maintenance'],
        ['👥 · Manage Admins', '💼 · Manage Resellers'],
        ['💸 · Exit to user']
    ]).resize();
}

function getAdminPromoKeyboard() {
    const promoBtn = isBonusPromoOn
        ? `🎁 Bonus (${bonusPercentage}% on $${bonusMinDeposit.toFixed(0)}+): ✅ ON`
        : `🎁 Bonus (${bonusPercentage}%): ❌ OFF`;

    return Markup.keyboard([
        [promoBtn],
        ['✏️ · Edit Bonus Rate (%)', '💵 · Edit Min Bonus Deposit ($)'],
        [`✏️ · Edit Reseller Discount (${resellerDiscountPercent}%)`],
        ['🔐 Admin Menu']
    ]).resize();
}

const adminManageResellersKeyboard = Markup.keyboard([
    ['➕ Add Reseller ID', '➖ Remove Reseller ID'],
    ['🔐 Admin Menu']
]).resize();

const adminUsersKeyboard = Markup.keyboard([
    ['🔍 Find user', '📋 All Users'],
    ['➕ Credit user', '➖ Deduct user'],
    ['💸 · Exit to user', '🔐 Admin Menu']
]).resize();

const adminAnalyticsKeyboard = Markup.keyboard([
    ['📊 · Bot metrics', '💰 · Panel balance'],
    ['📈 · Top-up reports', '📋 · Deposit log'],
    ['🔐 Admin Menu']
]).resize();

function getAdminSettingsKeyboard() {
    let modeBtn = `💳 Mode: 📋 1. តម្រូវអនុម័ត ( Admin Channel )`;
    if (depositMode === 'AUTO') modeBtn = `💳 Mode: ⚡ 2. Auto Payments ( ACLEDA API )`;
    if (depositMode === 'PAYWAY') modeBtn = `💳 Mode: 🏦 3. ABA PayWay ( Auto Payments )`;
    if (depositMode === 'BAKONG') modeBtn = `💳 Mode: 🇰🇭 4. Bakong KHQR ( Auto Payments )`;

    return Markup.keyboard([
        [modeBtn],
        ['🖼️ · Change Mode1 QR Photo', '🏦 · PayWay Link'],
        [isAcledaPaymentOn ? '🏦 ACLEDA Auto-Pay: ✅ ON' : '🏦 ACLEDA Auto-Pay: ❌ OFF', '🔑 · Edit ACLEDA Token'],
        [isBakongPaymentOn ? '🏦 Bakong Payment: ✅ ON' : '🏦 Bakong Payment: ❌ OFF', '🇰🇭 · Edit Bakong ID'],
        ['🔐 Admin Menu']
    ]).resize();
}

const adminManageAdminsKeyboard = Markup.keyboard([
    ['➕ Add Admin ID', '➖ Remove Admin ID'],
    ['🔐 Admin Menu']
]).resize();

const adminToolsKeyboard = Markup.keyboard([
    ['🎥 · Start media', '🎥 · How to links'],
    ['🏷️ · Services & Prices', '📢 · Broadcast Message'],
    ['🔐 Admin Menu']
]).resize();

// MAIN ADMIN CONTROL DASHBOARD (/admin, Admin Menu, 🔐 Admin Menu)
bot.command(['admin', 'dashboard'], (ctx) => sendAdminDashboard(ctx));
bot.hears(['🔐 Admin Menu', 'Admin Menu', '/admin', 'admin', 'Dashboard'], (ctx) => sendAdminDashboard(ctx));

function sendAdminDashboard(ctx) {
    const userId = ctx.from.id;
    delete userState[userId];
    if (!isAdmin(userId)) {
        return ctx.replyWithHTML('⛔ <b>សិទ្ធិត្រូវបានបដិសេធ (Access Denied)!</b>\nបញ្ជានេះសម្រាប់តែ Admin ប៉ុណ្ណោះ។');
    }

    const adminMsg = 
        `🔐 ━━━━━━━ [ <b>ADMIN CONTROL PANEL</b> ] ━━━━━━━ 🔐\n\n` +
        `👋 Welcome <b>Admin</b>! Select an option below to manage users, settings, analytics, and system tools ៖`;

    return ctx.replyWithHTML(adminMsg, getAdminMainKeyboard());
}

// 🎵 USERS & BALANCES MENU
bot.hears(['🎵 Users & Balances', 'Users & Balances'], (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    if (!isAdmin(userId)) return;

    const msg = 
        `🎵 ━━━━━━━ [ <b>USER MANAGEMENT</b> ] ━━━━━━━ 🎵\n\n` +
        `Select an option ៖\n` +
        `• <b>Search user by ID</b>\n` +
        `• <b>View user details</b>\n` +
        `• <b>Manage user balance</b>`;

    ctx.replyWithHTML(msg, adminUsersKeyboard);
});

// 🔍 FIND USER
bot.hears(['🔍 Find user', 'Find user'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;
    userState[userId] = { step: 'AWAITING_ADMIN_FIND_USER' };
    ctx.replyWithHTML(`🔍 <b>Enter the user ID to search ៖</b>`, Markup.keyboard([['🔐 Admin Menu']]).resize());
});

// 📋 ALL USERS LIST & PAGINATION
bot.hears(['📋 All Users', 'All Users'], async (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    delete userBalances['NaN'];
    delete userBalances[NaN];

    let usersList = Object.keys(userBalances)
        .filter(id => id && id !== 'NaN' && !isNaN(parseInt(id)))
        .map(id => ({
            telegram_id: id,
            balance: userBalances[id] || 0
        }));

    if (supabase) {
        try {
            const { data } = await supabase.from('users').select('*').limit(20);
            if (data && data.length > 0) {
                usersList = data.filter(u => u && u.telegram_id && u.telegram_id !== 'NaN' && !isNaN(parseInt(u.telegram_id)));
            }
        } catch (e) {}
    }

    let totalBal = usersList.reduce((acc, u) => acc + parseFloat(u.balance || 0), 0);

    const listText = 
        `📋 <b>${BRAND_NAME_UPPER} — ALL USERS LIST</b>\n` +
        `----------------------------------------\n\n` +
        usersList.slice(0, 15).map(u => 
            `🆔 <b>ID:</b> <code>${u.telegram_id}</code> | 💰 <b>$${parseFloat(u.balance || 0).toFixed(2)} USD</b>`
        ).join('\n') +
        `\n----------------------------------------\n` +
        `💰 <b>ប្រាក់សរុបក្នុងប្រព័ន្ធ ៖ $${totalBal.toFixed(2)} USD</b> 💵`;

    ctx.replyWithHTML(listText, adminUsersKeyboard);
});

// ➕ CREDIT USER
bot.hears(['➕ Credit user', 'Credit user'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;
    userState[userId] = { step: 'AWAITING_ADMIN_CREDIT_ID' };
    ctx.replyWithHTML(`🆔 <b>Send the user ID to add balance ៖</b>`, Markup.keyboard([['🔐 Admin Menu']]).resize());
});

// ➖ DEDUCT USER
bot.hears(['➖ Deduct user', 'Deduct user'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;
    userState[userId] = { step: 'AWAITING_ADMIN_DEDUCT_ID' };
    ctx.replyWithHTML(`🆔 <b>Send the user ID to deduct balance ៖</b>`, Markup.keyboard([['🔐 Admin Menu']]).resize());
});

// 📊 ANALYTICS & REPORTS MENU
bot.hears(['📊 Analytics & Reports', 'Analytics & Reports'], (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    if (!isAdmin(userId)) return;

    const msg = 
        `📊 ━━━━━━━ [ <b>ANALYTICS & REPORTS</b> ] ━━━━━━━ 📊\n\n` +
        `Select a report option below ៖`;

    ctx.replyWithHTML(msg, adminAnalyticsKeyboard);
});

// 📊 BOT METRICS
bot.hears(['📊 · Bot metrics', 'Bot metrics'], async (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    let usersCount = Object.keys(userBalances).length;
    let ordersCount = 0;
    let depositsCount = 0;

    if (supabase) {
        try {
            const { count: uCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
            const { count: oCount } = await supabase.from('orders').select('*', { count: 'exact', head: true });
            const { count: dCount } = await supabase.from('deposits').select('*', { count: 'exact', head: true });
            if (uCount !== null) usersCount = uCount;
            if (oCount !== null) ordersCount = oCount;
            if (dCount !== null) depositsCount = dCount;
        } catch (e) {}
    }

    const metricsMsg = 
        `📊 <b>Bot Metrics & System Health</b>\n----------------------------------------\n\n` +
        `👥 <b>Total Registered Users:</b> ${usersCount}\n` +
        `📦 <b>Total Orders Processed:</b> ${ordersCount}\n` +
        `💳 <b>Total Deposit Requests:</b> ${depositsCount}\n` +
        `🗄️ <b>Database Status:</b> <b>Connected 🟢</b>\n` +
        `⚡ <b>System Uptime Status:</b> 🟢 <b>Online 24/7</b>`;

    ctx.replyWithHTML(metricsMsg, adminAnalyticsKeyboard);
});

// 💳 DEPOSIT MODE CYCLE TOGGLE ( 1. តម្រូវអនុម័ត -> 2. ACLEDA API -> 3. ABA PayWay -> 4. Bakong KHQR -> 1. តម្រូវអនុម័ត )
bot.hears([/Deposit Mode/i, /💳 Mode:/i, /1. តម្រូវអនុម័ត/i, /2. Auto Payments/i, /3. ABA PayWay/i, /4. Bakong KHQR/i], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    if (depositMode === 'MANUAL') {
        depositMode = 'AUTO';
        isInstantAutoDepositOn = true;
    } else if (depositMode === 'AUTO') {
        depositMode = 'PAYWAY';
        isInstantAutoDepositOn = true;
    } else if (depositMode === 'PAYWAY') {
        depositMode = 'BAKONG';
        isInstantAutoDepositOn = true;
    } else {
        depositMode = 'MANUAL';
        isInstantAutoDepositOn = false;
    }

    let modeTitle = '📋 1. តម្រូវអនុម័ត ( QR Code + 1-Click Approval in Admin Channel -1003953732694)';
    if (depositMode === 'AUTO') modeTitle = '⚡ 2. Auto Payments ( ACLEDA API Token Pending Notice Card )';
    if (depositMode === 'PAYWAY') modeTitle = '🏦 3. ABA PayWay Merchant ( Direct PayWay Link Auto-Payment )';
    if (depositMode === 'BAKONG') modeTitle = '🇰🇭 4. Bakong KHQR ( National Bank Bakong Open API Auto Payment )';

    ctx.replyWithHTML(`✅ <b>កែប្រែរបៀបទូទាត់ប្រាក់ទៅជា ៖ ${modeTitle}</b>`, getAdminSettingsKeyboard());
});

// ✏️ EDIT BONUS PERCENTAGE RATE (%)
bot.hears(['✏️ · Edit Bonus Rate (%)', 'Edit Bonus Rate (%)', 'Edit Bonus Rate'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    userState[userId] = { step: 'AWAITING_ADMIN_SET_BONUS_PERCENT' };
    const prompt = 
        `🎁 <b>កែប្រែភាគរយ Bonus (%) ៖</b>\n\n` +
        `📊 ភាគរយបច្ចុប្បន្ន ៖ <b>+${bonusPercentage}%</b>\n\n` +
        `✍️ សូមវាយបញ្ចូលភាគរយ Bonus ថ្មី (ឧទាហរណ៍ ៖ 5, 10, 15, ឬ 20) ៖`;

    ctx.replyWithHTML(prompt, Markup.keyboard([['🔐 Admin Menu']]).resize());
});

// ✏️ EDIT RESELLER DISCOUNT (%)
bot.hears([/✏️ · Edit Reseller Discount \(/i, 'Edit Reseller Discount'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    userState[userId] = { step: 'AWAITING_ADMIN_SET_RESELLER_DISCOUNT' };
    const prompt =
        `💼 <b>កែប្រែ Reseller Wholesale Discount (%) ៖</b>\n\n` +
        `📊 ភាគរយបច្ចុប្បន្ន ៖ <b>-${resellerDiscountPercent}%</b>\n\n` +
        `✍️ សូមវាយបញ្ចូលភាគរយបញ្ចុះតម្លៃថ្មីសម្រាប់ Reseller (ឧទាហរណ៍ ៖ 15, 20, 25) ៖`;

    ctx.replyWithHTML(prompt, Markup.keyboard([['🔐 Admin Menu']]).resize());
});

// 💵 EDIT MINIMUM DEPOSIT FOR BONUS ($)
bot.hears(['💵 · Edit Min Bonus Deposit ($)', 'Edit Min Bonus Deposit ($)', 'Edit Min Bonus Deposit'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    userState[userId] = { step: 'AWAITING_ADMIN_SET_BONUS_MIN' };
    const prompt = 
        `💵 <b>កែប្រែប្រាក់ទាបបំផុតដើម្បីទទួលបាន Bonus ($) ៖</b>\n\n` +
        `💰 ប្រាក់ទាបបំផុតបច្ចុប្បន្ន ៖ <b>$${bonusMinDeposit.toFixed(2)} USD</b>\n\n` +
        `✍️ សូមវាយបញ្ចូលប្រាក់ Deposit ទាបបំផុតថ្មី (ឧទាហរណ៍ ៖ 5, 10, 15, ឬ 20) ៖`;

    ctx.replyWithHTML(prompt, Markup.keyboard([['🔐 Admin Menu']]).resize());
});

// 🏦 ACLEDA AUTO-PAY TOGGLE
bot.hears(['🏦 ACLEDA Auto-Pay: ✅ ON', '🏦 ACLEDA Auto-Pay: ❌ OFF', /ACLEDA Auto-Pay/i], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    isAcledaPaymentOn = !isAcledaPaymentOn;
    const statusMsg = isAcledaPaymentOn 
        ? '✅ <b>ACLEDA Toanchet Pay Auto-Verification Mode Enabled!</b>' 
        : '❌ <b>ACLEDA Toanchet Pay Auto-Verification Mode Disabled!</b>';
    ctx.replyWithHTML(statusMsg, getAdminSettingsKeyboard());
});

// 🔑 EDIT ACLEDA API TOKEN
bot.hears(['🔑 · Edit ACLEDA Token', 'Edit ACLEDA Token'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    userState[userId] = { step: 'AWAITING_ADMIN_SET_ACLEDA_TOKEN' };
    const maskedToken = acledaApiToken ? `${acledaApiToken.slice(0, 8)}...${acledaApiToken.slice(-6)}` : 'Not Set';
    const prompt = 
        `🔑 <b>កែប្រែ ACLEDA Bank API Token ៖</b>\n\n` +
        `📋 Token បច្ចុប្បន្ន ៖ <code>${maskedToken}</code>\n\n` +
        `✍️ សូមផ្ញើ ACLEDA API Token ថ្មីរបស់អ្នក ( ដែលទទួលបានពី ACLEDA Bank ) ៖`;

    ctx.replyWithHTML(prompt, Markup.keyboard([['🔐 Admin Menu']]).resize());
});

// 🏦 BAKONG PAYMENT TOGGLE
bot.hears(['🏦 Bakong Payment: ✅ ON', '🏦 Bakong Payment: ❌ OFF'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    isBakongPaymentOn = !isBakongPaymentOn;
    const statusMsg = isBakongPaymentOn ? '✅ <b>Bakong Payment Mode Enabled!</b>' : '❌ <b>Bakong Payment Mode Disabled!</b>';
    ctx.replyWithHTML(statusMsg, getAdminSettingsKeyboard());
});

// 🇰🇭 EDIT BAKONG MERCHANT ACCOUNT ID
bot.hears(['🇰🇭 · Edit Bakong ID', 'Edit Bakong ID', 'Edit Bakong'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    userState[userId] = { step: 'AWAITING_ADMIN_BAKONG_ID' };
    const prompt = 
        `🇰🇭 <b>កែប្រែ Bakong Merchant Account ID ៖</b>\n\n` +
        `📋 Bakong Account ID បច្ចុប្បន្ន ៖ <code>${bakongAccountId || 'lasa_leng@aclb'}</code>\n\n` +
        `✍️ <b>សូមផ្ញើ Bakong Account ID ថ្មីរបស់អ្នក ( ឧទាហរណ៍ ៖ blessing_kh@aclb ) ៖</b>`;

    ctx.replyWithHTML(prompt, Markup.keyboard([['🔐 Admin Menu']]).resize());
});

// 👥 MANAGE ADMINS (View list / Add / Remove admin by Telegram ID)
bot.hears(['👥 · Manage Admins', 'Manage Admins'], (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    if (!isAdmin(userId)) return;

    const baseAdmins = Array.from(registeredAdminIds).filter(id => !extraAdminIds.includes(id));
    const listText =
        `👥 <b>Manage Admins</b>\n----------------------------------------\n\n` +
        `🔒 <b>Base Admins</b> (កំណត់ក្នុង <code>ADMIN_IDS</code>/code, ត្រូវកែ env ដើម្បីដកចេញ):\n` +
        (baseAdmins.length > 0 ? baseAdmins.map(id => `• <code>${id}</code>`).join('\n') : '—') +
        `\n\n➕ <b>Added via Bot</b> (អាចដកចេញបានតាមម៉ឺនុយនេះ):\n` +
        (extraAdminIds.length > 0 ? extraAdminIds.map(id => `• <code>${id}</code>`).join('\n') : 'មិនទាន់មាន') +
        `\n\n👇 ជ្រើសរើសសកម្មភាពខាងក្រោម ៖`;

    ctx.replyWithHTML(listText, adminManageAdminsKeyboard);
});

bot.hears(['➕ Add Admin ID'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;
    userState[userId] = { step: 'AWAITING_ADMIN_ADD_ID' };
    ctx.replyWithHTML(`🆔 <b>សូមផ្ញើ Telegram User ID របស់អ្នកដែលចង់ដាក់ជា Admin ៖</b>\n<i>(ស្នើសុំពី @userinfobot ឬឱ្យគេផ្ញើ /id ទៅ Bot នេះ)</i>`, Markup.keyboard([['👥 · Manage Admins']]).resize());
});

bot.hears(['➖ Remove Admin ID'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;
    userState[userId] = { step: 'AWAITING_ADMIN_REMOVE_ID' };
    ctx.replyWithHTML(`🆔 <b>សូមផ្ញើ Telegram User ID ដែលចង់ដកចេញពី Admin ៖</b>\n<i>(អាចដកចេញបានតែ ID ដែលបានបន្ថែមតាម Bot ប៉ុណ្ណោះ)</i>`, Markup.keyboard([['👥 · Manage Admins']]).resize());
});

// 💼 MANAGE RESELLERS (View list / Add / Remove reseller by Telegram ID)
bot.hears(['💼 · Manage Resellers', 'Manage Resellers'], (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    if (!isAdmin(userId)) return;

    const listText =
        `💼 <b>Manage Resellers</b>\n----------------------------------------\n\n` +
        `🏅 <b>Wholesale Discount ៖</b> -${resellerDiscountPercent}% (កែបានតាម Promotion Settings)\n\n` +
        `📋 <b>Reseller List ៖</b>\n` +
        (resellerIdsList.length > 0 ? resellerIdsList.map(id => `• <code>${id}</code>`).join('\n') : 'មិនទាន់មាន Reseller') +
        `\n\n👇 ជ្រើសរើសសកម្មភាពខាងក្រោម ៖`;

    ctx.replyWithHTML(listText, adminManageResellersKeyboard);
});

bot.hears(['➕ Add Reseller ID'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;
    userState[userId] = { step: 'AWAITING_ADMIN_ADD_RESELLER_ID' };
    ctx.replyWithHTML(`🆔 <b>សូមផ្ញើ Telegram User ID របស់អ្នកដែលចង់ដាក់ជា Reseller ៖</b>\n<i>(ស្នើសុំពី @userinfobot ឬឱ្យគេផ្ញើ /id ទៅ Bot នេះ)</i>`, Markup.keyboard([['💼 · Manage Resellers']]).resize());
});

bot.hears(['➖ Remove Reseller ID'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;
    userState[userId] = { step: 'AWAITING_ADMIN_REMOVE_RESELLER_ID' };
    ctx.replyWithHTML(`🆔 <b>សូមផ្ញើ Telegram User ID ដែលចង់ដកចេញពី Reseller ៖</b>`, Markup.keyboard([['💼 · Manage Resellers']]).resize());
});

// 🛠️ TOOLS & SYSTEM MENU
bot.hears(['🛠️ Tools & System', 'Tools & System'], (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    if (!isAdmin(userId)) return;

    const msg = 
        `🛠️ ━━━━━━━ [ <b>TOOLS & SYSTEM</b> ] ━━━━━━━ 🛠️\n\n` +
        `Manage bot media, how-to guides, and broadcast announcements ៖`;

    ctx.replyWithHTML(msg, adminToolsKeyboard);
});

// 🎥 START MEDIA (Set How to Order Video Card)
bot.hears(['🎥 · Start media', 'Start media'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    userState[userId] = { step: 'AWAITING_ADMIN_START_MEDIA' };
    const msg = 
        `🎥 <b>កំណត់វីដេអូណែនាំរបៀបបញ្ជាទិញ (How to Order Video Card) ៖</b>\n----------------------------------------\n\n` +
        `✍️ <b>សូមផ្ញើឯកសារវីដេអូ (Video File MP4) មកកាន់ Bot ៖</b>\n\n` +
        `<i>( វីដេអូដែលផ្ញើមក នឹងត្រូវប្រើប្រាស់ស្វ័យប្រវត្តិ សម្រាប់អតិថិជនចុចមើលក្នុងមេនុយ [ 💡 របៀបបញ្ជាទិញ ] )</i>`;

    ctx.replyWithHTML(msg, adminToolsKeyboard);
});

// 🎥 HOWTO LINKS (Edit Tutorial Web/Channel Links)
bot.hears(['🎥 · How to links', 'How to links', '🎥 · Howto links', 'Howto links'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    userState[userId] = { step: 'AWAITING_ADMIN_HOWTO_LINK' };
    const msg = 
        `📋 <b>កែប្រែ How-to Video Links ៖</b>\n----------------------------------------\n\n` +
        `📌 <b>Link បច្ចុប្បន្ន ៖</b> <code>${howtoVideoLinks[0]}</code>\n\n` +
        `✍️ <b>សូមផ្ញើ Link Telegram វីដេអូណែនាំថ្មី (ឧទាហរណ៍ ៖ https://t.me/Blessing_Kh_Public/3) ៖</b>`;

    ctx.replyWithHTML(msg, { disable_web_page_preview: true, ...adminToolsKeyboard });
});

// 🏷️ SERVICES & PRICES MANAGER
bot.hears(['🏷️ · Services & Prices', 'Services & Prices', '🏷️ · កែប្រែសេវា & តម្លៃ', 'Services'], async (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    delete userState[userId];

    const catalogMsg = 
        `🏷️ ━━━━━━━ [ <b>SERVICES & PRICING MANAGER</b> ] ━━━━━━━ 🏷️\n\n` +
        `លោកអ្នកអាចកែប្រែប្រភេទសេវាកម្ម និង តម្លៃកញ្ចប់ Package នីមួយៗបានយ៉ាងងាយស្រួល ៖\n\n` +
        `🔴 <b>A. ❤️ Like & Views Khmer ( Category A ) ៖</b>\n` +
        `✦ 549 - 1.2K Likes + Views = <b>$1.99</b>\n` +
        `✦ 900 - 2.5K Likes + Views = <b>$3.00</b>\n` +
        `✦ 3K - 6.8K Likes + Views = <b>$8.00</b>\n\n` +
        `🔴 <b>B. 👀 Video Views Khmer ( Category B ) ៖</b>\n` +
        `✦ 2.4K - 8.2K Views = <b>$1.99</b>\n` +
        `✦ 4.2K - 14.4K Views = <b>$3.00</b>\n` +
        `✦ 13.2K - 45.3K Views = <b>$8.00</b>\n\n` +
        `🔴 <b>C. 👥 Followers Khmer ( Category C ) ៖</b>\n` +
        `✦ 18 - 90 Khmer Followers = <b>$1.99</b>\n` +
        `✦ 32 - 160 Khmer Followers = <b>$3.00</b>\n` +
        `✦ 100 - 500 Khmer Followers = <b>$8.00</b>\n\n` +
        `👇 <i>សូមជ្រើសរើសប្រភេទសេវាកម្មខាងក្រោម ( ផ្ញើ A, B, C ឬ ចុចប៊ូតុង ) ៖</i>`;

    const serviceAdminKb = Markup.inlineKeyboard([
        [Markup.button.callback('🔴 A. កែប្រែតម្លៃ Likes & Views (Cat A)', 'edit_price_likes')],
        [Markup.button.callback('🔴 B. កែប្រែតម្លៃ Video Views (Cat B)', 'edit_price_views')],
        [Markup.button.callback('🔴 C. កែប្រែតម្លៃ Followers Khmer (Cat C)', 'edit_price_followers')]
    ]);

    ctx.replyWithHTML(catalogMsg, { ...serviceAdminKb, ...adminToolsKeyboard });
});

// Helper: Render full category packages card for Admin inspection
function sendAdminCategoryPackagesCard(ctx, catId) {
    const userId = ctx.from.id;
    let title = '';
    let catKey = 'likes';

    if (catId === 'likes' || catId === 'A' || catId === 'a') {
        title = '🔴 <b>A. ❤️ តារាងសេវាកម្មកញ្ចប់ Likes & Views Khmer ទាំងអស់ ៖</b>';
        catKey = 'likes';
    } else if (catId === 'views' || catId === 'B' || catId === 'b') {
        title = '🔴 <b>B. 👀 តារាងសេវាកម្មកញ្ចប់ Video Views Khmer ទាំងអស់ ៖</b>';
        catKey = 'views';
    } else {
        title = '🔴 <b>C. 👥 តារាងសេវាកម្មកញ្ចប់ Followers Khmer ទាំងអស់ ៖</b>';
        catKey = 'followers';
    }

    const pkgs = dynamicPackagePrices[catKey].map(p => `${p.name} = $${p.price.toFixed(2)}`);

    let cardText = `${title}\n----------------------------------------\n\n`;
    pkgs.forEach((p, i) => {
        cardText += `<b>${i + 1}.</b> ${p}\n`;
    });
    cardText += `\n✍️ <b>ដើម្បីកែប្រែកញ្ចប់ណា ៖</b> សូមផ្ញើសារតាមទម្រង់ ( មាន <b>L:</b> ខាងមុខ ) ៖\n<code>L: [ឈ្មោះ Package] = $[តម្លៃ]</code>\n\n`;
    cardText += `👉 <b>ឧទាហរណ៍ ៖</b> <code>L: ${pkgs[0]}</code>`;

    userState[userId] = { step: 'AWAITING_ADMIN_EDIT_PRICE_INPUT', catId: catId };

    const actionKb = Markup.inlineKeyboard([
        [Markup.button.callback('✏️ ចាប់ផ្តើមកែប្រែ (Continue Edit)', `continue_edit_price_${catId}`)],
        [Markup.button.callback('❌ បោះបង់ (Cancel / Back)', 'cancel_admin_edit')]
    ]);

    ctx.replyWithHTML(cardText, { ...actionKb, ...adminToolsKeyboard });
}

bot.action('edit_price_followers', (ctx) => {
    try { ctx.answerCbQuery(); } catch (e) {}
    if (!isAdmin(ctx.from.id)) return;
    return sendAdminCategoryPackagesCard(ctx, 'followers');
});

bot.action('edit_price_likes', (ctx) => {
    try { ctx.answerCbQuery(); } catch (e) {}
    if (!isAdmin(ctx.from.id)) return;
    return sendAdminCategoryPackagesCard(ctx, 'likes');
});

bot.action('edit_price_views', (ctx) => {
    try { ctx.answerCbQuery(); } catch (e) {}
    if (!isAdmin(ctx.from.id)) return;
    return sendAdminCategoryPackagesCard(ctx, 'views');
});

bot.hears(['A', 'a', '🅰️', 'A️⃣'], (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    return sendAdminCategoryPackagesCard(ctx, 'likes');
});

bot.hears(['B', 'b', '🅱️', 'B️⃣'], (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    return sendAdminCategoryPackagesCard(ctx, 'views');
});

bot.hears(['C', 'c', '🅲', 'C️⃣'], (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    return sendAdminCategoryPackagesCard(ctx, 'followers');
});

bot.action(/continue_edit_price_(.+)/, (ctx) => {
    try { ctx.answerCbQuery(); } catch (e) {}
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;
    const catId = ctx.match[1];
    userState[userId] = { step: 'AWAITING_ADMIN_EDIT_PRICE_INPUT', catId: catId };
    return ctx.replyWithHTML(
        `✍️ <b>សូមផ្ញើសារកែប្រែតម្លៃតាមទម្រង់ខាងក្រោម ៖</b>\n----------------------------------------\n` +
        `<code>[ឈ្មោះ Package] = $[តម្លៃ]</code>\n\n` +
        `<i>( ឬ ផ្ញើ ❌ បោះបង់ ដើម្បីចាកចេញ )</i>`,
        Markup.inlineKeyboard([[Markup.button.callback('❌ បោះបង់ (Cancel)', 'cancel_admin_edit')]])
    );
});

bot.action('cancel_admin_edit', async (ctx) => {
    try { await ctx.answerCbQuery('❌ បានបោះបង់!'); } catch (e) {}
    const userId = ctx.from.id;
    delete userState[userId];
    try {
        await ctx.editMessageText('❌ <b>បានបោះបង់ការកែប្រែតម្លៃ។ លោកអ្នកស្ថិតក្នុងមេនុយដើម។</b>', { parse_mode: 'HTML' });
    } catch (e) {
        await ctx.replyWithHTML('❌ <b>បានបោះបង់ការកែប្រែ។ លោកអ្នកស្ថិតក្នុងមេនុយដើម។</b>', adminToolsKeyboard);
    }
});

bot.action('confirm_save_pkg_price', async (ctx) => {
    try { await ctx.answerCbQuery('✅ រក្សាទុកជោគជ័យ!'); } catch (e) {}
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    const state = userState[userId];
    if (state && state.targetPkgName && state.newPrice) {
        const pkgName = state.targetPkgName;
        const price = state.newPrice;
        delete userState[userId];

        // LIVE UPDATE DYNAMIC PACKAGE PRICES 24/7!
        updateDynamicPackagePrice(pkgName, price);

        const successCard = 
            `🎉 <b>កែប្រែតម្លៃសេវាកម្មជោគជ័យ ១០០%!</b>\n----------------------------------------\n\n` +
            `📦 <b>កញ្ចប់សេវាកម្ម ៖</b> ${pkgName}\n` +
            `💵 <b>តម្លៃថ្មី ៖</b> <b>$${price.toFixed(2)} USD</b> ⚡\n\n` +
            `💡 <i>ទិន្នន័យត្រូវបានធ្វើបច្ចុប្បន្នភាពសម្រាប់អតិថិជនទាំងអស់ស្វ័យប្រវត្តិ។</i>`;

        try {
            await ctx.editMessageText(successCard, { parse_mode: 'HTML' });
        } catch (e) {
            await ctx.replyWithHTML(successCard, adminToolsKeyboard);
        }
        return;
    }

    delete userState[userId];
    try {
        await ctx.editMessageText('✅ <b>បានកែប្រែតម្លៃរួចរាល់!</b>', { parse_mode: 'HTML' });
    } catch (e) {
        ctx.replyWithHTML('✅ <b>កែប្រែតម្លៃរួចរាល់!</b>', adminToolsKeyboard);
    }
});

bot.action('confirm_save_howto_link', async (ctx) => {
    try { await ctx.answerCbQuery('✅ កំណត់ជោគជ័យ!'); } catch (e) {}
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    const state = userState[userId];
    if (state && state.pendingLink) {
        const cleanLink = state.pendingLink;
        delete userState[userId];

        howtoVideoLinks = [cleanLink];
        saveHowtoConfig();

        const successCard = 
            `🎉 <b>កែប្រែ How-to Video Link ជោគជ័យ ១០០%!</b>\n----------------------------------------\n\n` +
            `🔗 <b>Link ថ្មី ៖</b> <code>${cleanLink}</code> ⚡\n\n` +
            `💡 <i>អតិថិជននឹងមើលឃើញ Link ថ្មីនេះភ្លាមៗ ស្វ័យប្រវត្តិ។</i>`;

        try {
            await ctx.editMessageText(successCard, { parse_mode: 'HTML', disable_web_page_preview: true });
        } catch (e) {
            await ctx.replyWithHTML(successCard, { disable_web_page_preview: true, ...adminToolsKeyboard });
        }
        return;
    }

    delete userState[userId];
    try {
        await ctx.editMessageText('✅ <b>បានកែប្រែ Link រួចរាល់!</b>', { parse_mode: 'HTML' });
    } catch (e) {
        ctx.replyWithHTML('✅ <b>បានកែប្រែ Link រួចរាល់!</b>', adminToolsKeyboard);
    }
});

// 📢 BROADCAST MESSAGE
bot.hears(['📢 · Broadcast Message', 'Broadcast Message', '/broadcast'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    userState[userId] = { step: 'AWAITING_ADMIN_BROADCAST' };
    ctx.replyWithHTML(`📢 <b>Send the announcement message to broadcast to all users ៖</b>`, Markup.keyboard([['🔐 Admin Menu']]).resize());
});

// 🟢 BOT OPEN / 🔴 MAINTENANCE TOGGLE
bot.hears(['🟢 · Bot: open', '🔴 · Bot: maintenance'], (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return;

    isBotOpen = !isBotOpen;
    const statusMsg = isBotOpen ? 
        '🟢 <b>Bot status set to OPEN (Online 24/7)!</b>' : 
        '🔴 <b>Bot status set to MAINTENANCE MODE (Users cannot place orders)!</b>';

    ctx.replyWithHTML(statusMsg, getAdminMainKeyboard());
});

// 💸 EXIT TO USER
bot.hears(['💸 · Exit to user', 'Exit to user'], (ctx) => {
    const userId = ctx.from.id;
    delete userState[userId];
    const lang = getLang(userId);
    ctx.replyWithHTML(`👋 Switched back to Customer View!`, getMainKeyboard(lang));
});

// ==========================================
// 5. DEPOSIT CONFIRMATION & ADMIN APPROVAL CALLBACKS
// ==========================================

// Customer clicks [ ⚡ Auto Payment (ACLEDA/Bakong API) ]
bot.action(/^auto_dep/, async (ctx) => {
    const dataStr = ctx.callbackQuery.data;
    const parts = dataStr.split('_');

    const bonus = parseFloat(parts[parts.length - 1]) || 0;
    const amount = parseFloat(parts[parts.length - 2]) || 0;
    const depId = parts.slice(2, parts.length - 2).join('_') || 'DEP100000';
    const totalCredit = amount + bonus;
    const userId = ctx.from.id;

    try {
        await ctx.answerCbQuery('⚡ ប្រព័ន្ធរត់ស្កែនទូទាត់ស្វ័យប្រវត្តិ ២៤/៧!');
    } catch (e) {}

    const autoNotice = 
        `⚡ <b>Auto Payment Mode (ACLEDA & Bakong API)</b>\n----------------------------------------\n\n` +
        `🆔 <b>Deposit ID:</b> <code>#${depId}</code>\n` +
        `💳 <b>Amount:</b> $${amount.toFixed(2)} USD\n` +
        `🎁 <b>Bonus:</b> +$${bonus.toFixed(2)} USD\n` +
        `💰 <b>Total Credited:</b> $${totalCredit.toFixed(2)} USD\n\n` +
        `📲 <i>ប្រព័ន្ធ ACLEDA / Bakong Open API កំពុងរត់ផ្ទៀងផ្ទាត់ និង ទម្លាក់លុយចូលកាបូបលុយរបស់អ្នកស្វ័យប្រវត្តិ ១០០% ភ្លាមៗ ( មិនបាច់ចុចអ្វីទៀតឡើយ! )...</i>`;

    try {
        await ctx.editMessageText(autoNotice, { parse_mode: 'HTML' });
    } catch (e) {}
});

// Customer clicks [ 🔄 ខ្ញុំបានទូទាត់រួចរាល់ (Check PayWay) ] on main Add Funds prompt
// Customer clicks [ 🔄 ផ្ទៀងផ្ទាត់ការទូទាត់ប្រាក់ (Check Payment) ]
bot.action(['check_payway_direct', /^check_payway_/], async (ctx) => {
    const userId = ctx.from.id;
    userState[userId] = { step: 'AWAITING_PAYWAY_PAID_AMOUNT' };
    try {
        await ctx.answerCbQuery('📲 សូមវាយបញ្ចូលចំនួនលុយដែលអ្នកបានទូទាត់លើ ABA PayWay...');
    } catch (e) {}
    return ctx.replyWithHTML(`✍️ <b>សូមវាយបញ្ចូលចំនួនលុយ ($ USD) ដែលអ្នកបានទូទាត់លើ ABA PayWay (ឧទាហរណ៍ ៖ 1, 3, 5) ៖</b>`);
});



// Step 1 Click: Customer clicks [ 🏦 ទូទាត់តាម ABA PayWay ] in Mode 3
bot.action(/^open_payway_/, async (ctx) => {
    const dataStr = ctx.callbackQuery.data;
    const parts = dataStr.split('_');
    const bonus = parseFloat(parts.pop()) || 0;
    const amount = parseFloat(parts.pop()) || 0;
    const depId = parts.slice(2).join('_') || 'DEP100000';
    const userId = ctx.from.id;
    const lang = getLang(userId);
    const isKm = lang === 'km';

    // 1. Open PayWay URL via callback query answer
    try {
        await ctx.answerCbQuery(isKm ? '🔗 កំពុងបើក ABA PayWay Link...' : '🔗 Opening ABA PayWay Link...', { url: paywayMerchantLink });
    } catch (e) {
        try {
            await ctx.answerCbQuery('🔗 PayWay Link: ' + paywayMerchantLink);
        } catch (err) {}
    }

    // 2. Replace single button with 2 buttons: [ 💳 ខ្ញុំបានទូទាត់រួចរាល់ ] and [ ❌ បោះបង់ ]
    const updatedPaywayMsg = isKm ?
        `🏦 <b>ទូទាត់តាម ABA PayWay (Link ទូទាត់ប្រាក់)</b>\n----------------------------------------\n\n` +
        `💳 <b>ចំនួនប្រាក់ Deposit ៖ $${amount.toFixed(2)} USD</b>\n` +
        (bonus > 0 ? `🎁 <b>Bonus ថែមជូន ៖ +$${bonus.toFixed(2)} USD</b>\n` : '') +
        `🆔 <b>លេខ Deposit ID:</b> <code>#${depId}</code>\n\n` +
        `🔗 <b>Link ទូទាត់ប្រាក់ ៖</b> <a href="${paywayMerchantLink}">${paywayMerchantLink}</a>\n\n` +
        `⚠️ <i>បន្ទាប់ពីទូទាត់រួច សូមចុចប៊ូតុង <b>[ 💳 ខ្ញុំបានទូទាត់រួចរាល់ ]</b> ខាងក្រោម ៖</i>` :

        `🏦 <b>Payment via ABA PayWay Link</b>\n----------------------------------------\n\n` +
        `💳 <b>Deposit Amount: $${amount.toFixed(2)} USD</b>\n` +
        (bonus > 0 ? `🎁 <b>Bonus: +$${bonus.toFixed(2)} USD</b>\n` : '') +
        `🆔 <b>Deposit ID:</b> <code>#${depId}</code>\n\n` +
        `🔗 <b>Payment Link:</b> <a href="${paywayMerchantLink}">${paywayMerchantLink}</a>\n\n` +
        `⚠️ <i>After payment, please click <b>[ 💳 I Have Paid ]</b> below ៖</i>`;

    const twoButtonsKb = Markup.inlineKeyboard([
        [Markup.button.callback(isKm ? '💳 ខ្ញុំបានទូទាត់រួចរាល់' : '💳 I Have Paid (Confirm Payment)', `confirm_dep_${depId}_${amount}_${bonus}`)],
        [Markup.button.callback(isKm ? '❌ បោះបង់ការទូទាត់' : '❌ Cancel Payment', `cancel_dep_${depId}`)]
    ]);

    try {
        await ctx.editMessageText(updatedPaywayMsg, { parse_mode: 'HTML', ...twoButtonsKb, disable_web_page_preview: true });
    } catch (e) {
        try {
            await ctx.editMessageReplyMarkup(twoButtonsKb.reply_markup);
        } catch (err) {}
    }
});

// Customer clicks [ 💳 ខ្ញុំបានទូទាត់រួចរាល់ (Confirm Payment) ]
bot.action(/^confirm_dep/, async (ctx) => {
    const dataStr = ctx.callbackQuery.data;
    const parts = dataStr.split('_');

    const bonus = parseFloat(parts[parts.length - 1]) || 0;
    const amount = parseFloat(parts[parts.length - 2]) || 0;
    const depId = parts.slice(2, parts.length - 2).join('_') || 'DEP100000';
    const totalCredit = amount + bonus;
    const userId = ctx.from.id;
    const name = ctx.from.first_name || 'Customer';
    const lang = getLang(userId);
    const isKm = lang === 'km';

    // 🛑 STAGE 1 ANTI-DUPLICATE CHECK: Instant Inline Keyboard Removal from UI
    try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (e) {}

    // 🛑 STAGE 2 ANTI-DUPLICATE CHECK: Immediate Memory Set Check
    if (processedDepositIds.has(depId) || processedDepositIds.has(`cancel_${depId}`)) {
        try {
            await ctx.answerCbQuery(
                isKm ? '⚠️ សំណើទូទាត់នេះត្រូវបានផ្ញើ ឬ រួចរាល់ហើយ!' : '⚠️ This deposit request has already been submitted!',
                { show_alert: true }
            );
        } catch (e) {}
        return;
    }
    processedDepositIds.add(depId);

    try {
        await ctx.answerCbQuery(isKm ? '✅ បានផ្ញើសារស្នើសុំបញ្ជាក់ការទូទាត់ទៅកាន់ Admin រួចរាល់!' : '✅ Payment confirmation request sent to Admin!');
    } catch (e) {}

    // Attempt Bakong Open API Auto-Verification if Bakong Token is set
    const OFFICIAL_ABA_KHQR = '00020101021129450016abaakhppxxx@abaa01090024509660208ABA Bank40600006abaP2P0112E4E557F93E67020900245096603090128400850404Dual5204000053031165802KH5917BANDITHSOPHEA BUN6010Phnom Penh63045A92';
    const khqrString = process.env.ABA_KHQR_STRING || OFFICIAL_ABA_KHQR;
    const md5Hash = require('crypto').createHash('md5').update(khqrString).digest('hex');

    // Skip the Bakong/ACLEDA check entirely in Manual/PayWay mode — their
    // result is ignored below anyway (those modes never take the instant-
    // approve branch), so calling them just burns Bakong's scarce daily
    // request quota for nothing.
    const skipAutoCheck = depositMode === 'MANUAL' || depositMode === 'PAYWAY';
    const isBakongVerified = skipAutoCheck ? false : await checkBakongTransaction(md5Hash);
    const isAcledaVerified = (!skipAutoCheck && isAcledaPaymentOn) ? await checkAcledaTransaction(depId, amount) : false;

    if (depositMode !== 'MANUAL' && depositMode !== 'PAYWAY' && (isInstantAutoDepositOn || isBakongVerified || isAcledaVerified)) {
        // Instant 100% Fully Automated Deposit Approval!
        const currentBal = getBalance(userId);
        const newBal = currentBal + totalCredit;
        await dbUpdateBalance(userId, newBal);

        if (supabase) {
            try {
                await supabase.from('deposits').update({ status: 'Approved (Auto-Paid)' }).eq('deposit_id', depId);
            } catch (e) {}
        }

        const thankYouMsg = 
            `💖 <b>អរគុណបងពូកែ! លុយចូលហើយណា 🥰 (Auto Payment Verified ⚡)</b>\n` +
            `<b>Thank you so much for trusting us! 🌸</b>\n\n` +
            `➕ <b>Balance Added:</b> $${amount.toFixed(2)} ✔️\n` +
            `🎁 <b>Bonus Added:</b> $${bonus.toFixed(2)} 🎉 (បងសំណាងណាស់!)\n\n` +
            `💰 <b>New Balance: $${newBal.toFixed(2)} USD</b>\n\n` +
            `⚡ <i>ប្រព័ន្ធបានបញ្ចូលលុយចូលកាបូបលុយរបស់អ្នកស្វ័យប្រវត្តិ ១០០% រួចរាល់ហើយ!</i>`;

        try {
            await ctx.editMessageText(thankYouMsg, { parse_mode: 'HTML' });
        } catch (e) {}

        // Notify Admin Channel (-1003953732694)
        const channelMsg = 
            `⚡ <b>AUTO-DEPOSIT APPROVED (100% Automated)!</b>\n` +
            `----------------------------------------\n` +
            `🆔 <b>Deposit ID:</b> <code>#${depId}</code>\n` +
            `📲 <b>User ID:</b> <code>${userId}</code>\n` +
            `👤 <b>Customer:</b> ${name}\n` +
            `💵 <b>Amount:</b> $${amount.toFixed(2)} USD\n` +
            `🎁 <b>Bonus:</b> +$${bonus.toFixed(2)} USD\n` +
            `💰 <b>Total Credited:</b> $${totalCredit.toFixed(2)} USD\n` +
            `🟢 <b>Status:</b> Auto-Approved ⚡`;

        try {
            await bot.telegram.sendMessage(TARGET_ADMIN_CHAT_ID, channelMsg, { parse_mode: 'HTML' });
        } catch (e) {}

        return;
    }

    const pendingText = isKm ?
        `⏳ <b>កំពុងរង់ចាំ Admin ពិនិត្យ និង យល់ព្រម...</b>\n----------------------------------------\n\n` +
        `🆔 <b>លេខ Deposit ID:</b> <code>#${depId}</code>\n` +
        `💳 <b>ចំនួនប្រាក់ ៖</b> $${amount.toFixed(2)} USD\n` +
        (bonus > 0 ? `🎁 <b>Bonus ថែមជូន ៖</b> +$${bonus.toFixed(2)} USD\n\n` : '\n') +
        `📲 <i>សារស្នើសុំទូទាត់ប្រាក់ត្រូវបានផ្ញើជូន Admin ពិនិត្យ និង យល់ព្រមរួចរាល់!</i>` :

        `⏳ <b>Waiting for Admin Approval...</b>\n----------------------------------------\n\n` +
        `🆔 <b>Deposit ID:</b> <code>#${depId}</code>\n` +
        `💳 <b>Amount:</b> $${amount.toFixed(2)} USD\n` +
        (bonus > 0 ? `🎁 <b>Bonus:</b> +$${bonus.toFixed(2)} USD\n\n` : '\n') +
        `📲 <i>Your payment confirmation request has been sent to Admin!</i>`;

    try {
        await ctx.editMessageCaption(pendingText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
    } catch (e) {
        try {
            await ctx.editMessageText(pendingText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
        } catch (err) {
            try {
                await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
            } catch (err2) {}
        }
    }

    // Notify Admin Group with 1-Click Approval buttons
    const isPayWayMode = depositMode === 'PAYWAY';
    const adminNotifyMsg = 
        `💳 <b>NEW DEPOSIT SUBMITTED (${isPayWayMode ? 'Mode 3: ABA PayWay Link' : 'Mode 1: Admin Approval'})</b>\n` +
        `----------------------------------------\n` +
        `🆔 <b>Deposit ID:</b> <code>#${depId}</code>\n` +
        `📲 <b>User ID:</b> <code>${userId}</code>\n` +
        `👤 <b>Customer:</b> ${name}\n` +
        `💳 <b>Amount:</b> $${amount.toFixed(2)} USD\n` +
        `🎁 <b>Bonus:</b> +$${bonus.toFixed(2)} USD\n` +
        `💰 <b>Total to Credit:</b> $${totalCredit.toFixed(2)} USD\n` +
        `⏳ <b>Status:</b> Pending Approval ⏳`;

    const adminApprovalKb = Markup.inlineKeyboard([
        [Markup.button.callback('✅ យល់ព្រម (Approve)', `approve_dep_${depId}_${userId}_${amount}_${bonus}`)],
        [Markup.button.callback('❌ បដិសេធ (Reject)', `reject_dep_${depId}_${userId}`)]
    ]);

    // Send 1-Click Approval notification ONLY to Admin Private Group (-1003953732694)
    try {
        await bot.telegram.sendMessage(TARGET_ADMIN_CHAT_ID, adminNotifyMsg, {
            parse_mode: 'HTML',
            ...adminApprovalKb
        });
        console.log(`✅ Sent Mode 1 Deposit Request to ${BRAND_NAME}_Purchase Order Group (-1003953732694)!`);
    } catch (groupErr) {
        console.error('⚠️ Could not send to admin channel:', groupErr.message);
    }
});

// Admin clicks [ ✅ យល់ព្រម (Approve) ]
bot.action(/^approve_dep/, async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) {
        try { return ctx.answerCbQuery('⛔ សម្រាប់តែ Admin!', { show_alert: true }); } catch (e) { return; }
    }

    const dataStr = ctx.callbackQuery.data;
    const parts = dataStr.split('_');

    const bonus = parseFloat(parts.pop()) || 0;
    const amount = parseFloat(parts.pop()) || 0;
    const targetUserId = parseInt(parts.pop()) || ctx.from.id;
    const depId = parts.slice(2).join('_') || 'DEP100000';
    const totalCredit = amount + bonus;

    // Anti-double-click / anti-double-approval protection — an admin decision
    // (approve or reject) on this deposit can only be made once.
    if (processedDepositIds.has(`admin_decided_${depId}`)) {
        try {
            return ctx.answerCbQuery('⚠️ ការទូទាត់នេះត្រូវបានសម្រេចរួចហើយ!', { show_alert: true });
        } catch (e) { return; }
    }
    processedDepositIds.add(`admin_decided_${depId}`);
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (e) {}

    const currentBal = getBalance(targetUserId);
    const newBal = currentBal + totalCredit;
    await dbUpdateBalance(targetUserId, newBal);

    if (supabase) {
        try {
            await supabase.from('deposits').update({ status: 'Completed' }).eq('deposit_id', depId);
        } catch (e) {}
    }

    try {
        await ctx.answerCbQuery('✅ បញ្ចូលលុយជោគជ័យ!');
    } catch (e) {}

    try {
        await ctx.editMessageText(
            `✅ <b>បានយល់ព្រមការទូទាត់ #${depId} ជោគជ័យ!</b>\n\n` +
            `📲 User ID: <code>${targetUserId}</code>\n` +
            `💳 Added: $${amount.toFixed(2)} + Bonus: $${bonus.toFixed(2)} = <b>$${totalCredit.toFixed(2)} USD</b>\n` +
            `💰 New Balance: <b>$${newBal.toFixed(2)} USD</b>`,
            { parse_mode: 'HTML' }
        );
    } catch (e) {}

    // Send thank you receipt message directly to Customer
    const thankYouMsg = 
        `💖 <b>អរគុណបងពូកែ! លុយចូលហើយណា 🥰</b>\n` +
        `<b>Thank you so much for trusting us! 🌸</b>\n\n` +
        `➕ <b>Balance Added:</b> $${amount.toFixed(2)} ✔️\n` +
        `🎁 <b>Bonus Added:</b> $${bonus.toFixed(2)} 🎉 (បងសំណាងណាស់!)\n\n` +
        `💰 <b>New Balance: $${newBal.toFixed(2)} USD</b>\n\n` +
        `🛍️ <b>លោកអ្នកអាចចាប់ផ្តើមបញ្ជាទិញសេវាកម្មឥឡូវនេះបានហើយ! 🚀</b>\n` +
        `<i>( Click Menu [ 🛒 ជ្រើសរើសសេវាកម្ម ] to place your order now! ✨ )</i>`;

    try {
        await bot.telegram.sendMessage(targetUserId, thankYouMsg, { parse_mode: 'HTML' });
    } catch (e) {}
});

// Admin clicks [ ❌ បដិសេធ (Reject) ]
bot.action(/^reject_dep_([^_]+)_([^_]+)$/, async (ctx) => {
    const userId = ctx.from.id;
    if (!isAdmin(userId)) return ctx.answerCbQuery('⛔ សម្រាប់តែ Admin!');

    const depId = ctx.match[1];
    const targetUserId = parseInt(ctx.match[2]);

    // Anti-double-click / anti-conflicting-decision protection — matches approve_dep.
    if (processedDepositIds.has(`admin_decided_${depId}`)) {
        try {
            return ctx.answerCbQuery('⚠️ ការទូទាត់នេះត្រូវបានសម្រេចរួចហើយ!', { show_alert: true });
        } catch (e) { return; }
    }
    processedDepositIds.add(`admin_decided_${depId}`);
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (e) {}

    if (supabase) {
        try {
            await supabase.from('deposits').update({ status: 'Rejected' }).eq('deposit_id', depId);
        } catch (e) {}
    }

    ctx.answerCbQuery('❌ បានបដិសេធការទូទាត់');
    ctx.editMessageText(`❌ <b>បានបដិសេធការទូទាត់ #${depId}</b>`, { parse_mode: 'HTML' });

    try {
        await bot.telegram.sendMessage(targetUserId, `❌ <b>ការទូទាត់ #${depId} មិនត្រូវបានទទួលស្គាល់ឡើយ។ សូមទាក់ទង Admin Support!</b>`, { parse_mode: 'HTML' });
    } catch (e) {}
});

// Customer clicks [ ❌ បោះបង់ការទូទាត់ ]
bot.action(/^cancel_dep_([^_]+)$/, async (ctx) => {
    const depId = ctx.match[1];
    const userId = ctx.from.id;
    const lang = getLang(userId);
    const isKm = lang === 'km';

    // 🛑 STAGE 1 ANTI-DUPLICATE CHECK: Instant Inline Keyboard Removal from UI
    try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (e) {}

    // 🛑 STAGE 2 ANTI-DUPLICATE CHECK: Immediate Memory Set Check
    if (processedDepositIds.has(`cancel_${depId}`) || processedDepositIds.has(depId)) {
        try {
            await ctx.answerCbQuery(
                isKm ? '⚠️ ការទូទាត់នេះត្រូវបានបោះបង់ ឬ អនុម័តរួចរាល់ហើយ!' : '⚠️ This deposit is already cancelled or processed!',
                { show_alert: true }
            );
        } catch (e) {}
        return;
    }
    processedDepositIds.add(`cancel_${depId}`);

    if (pendingAutoDeposits[depId]) {
        delete pendingAutoDeposits[depId];
    }
    delete userLastPendingDeposit[userId];

    try {
        await ctx.answerCbQuery(isKm ? '❌ បានបោះបង់ការទូទាត់ប្រាក់' : '❌ Deposit cancelled');
    } catch (e) {}

    try {
        await ctx.editMessageCaption(
            isKm ?
            `❌ <b>បានបោះបង់ការទូទាត់ប្រាក់ #${depId} រួចរាល់!</b>\n` +
            `----------------------------------------\n` +
            `<i>លោកអ្នកអាចចុចមេនុយ [ Add Funds/Wallet ] ដើម្បីធ្វើការទូទាត់ប្រាក់ជាថ្មីម្ដងទៀត។</i>` :

            `❌ <b>Deposit #${depId} has been cancelled!</b>\n` +
            `----------------------------------------\n` +
            `<i>You can click [ Add Funds/Wallet ] to start a new deposit anytime.</i>`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
        );
    } catch (e) {
        try {
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch (err) {}
    }
});

// Admin clicks [ ✅ ចុចបញ្ចប់ការទិញ (Done) ] in Group LazR v3.0 Supports
bot.action(/^done_order_/, async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) {
        try { return ctx.answerCbQuery('⛔ សម្រាប់តែ Admin!', { show_alert: true }); } catch (e) { return; }
    }

    const dataStr = ctx.callbackQuery.data;
    const parts = dataStr.split('_');

    const targetUserId = parseInt(parts.pop());
    const rawOrderId = parts.slice(2).join('_');
    const fullOrderId = rawOrderId.startsWith('ORD-') ? `#${rawOrderId}` : `#ORD-${rawOrderId}`;
    const adminName = ctx.from.first_name || 'Admin';

    // Anti-double-click protection — also prevents an order being marked Done
    // after it was already Cancel/Refund'd (or vice versa).
    if (processedOrderActions.has(fullOrderId)) {
        try {
            return ctx.answerCbQuery('⚠️ Order នេះត្រូវបានសម្រេចរួចហើយ!', { show_alert: true });
        } catch (e) { return; }
    }
    processedOrderActions.add(fullOrderId);
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (e) {}

    // 1. Update status in Supabase DB
    let targetOrder = null;
    if (supabase) {
        try {
            const { data } = await supabase
                .from('orders')
                .select('*')
                .or(`order_id.ilike.%${rawOrderId.replace('#', '')}%`)
                .maybeSingle();
            targetOrder = data;

            if (targetOrder) {
                await supabase
                    .from('orders')
                    .update({ status: 'Completed' })
                    .eq('id', targetOrder.id);
            }
        } catch (e) {}
    }

    // Update memory cache
    if (userOrdersCache[targetUserId]) {
        const item = userOrdersCache[targetUserId].find(o => o.order_id.includes(rawOrderId.replace('#', '')));
        if (item) {
            item.status = 'Completed';
            if (!targetOrder) targetOrder = item;
        }
    }

    try {
        await ctx.answerCbQuery('✅ បានបញ្ចប់ការបញ្ជាទិញដោយជោគជ័យ!');
    } catch (e) {}

    // Edit message in Group LazR v3.0 Supports
    const groupDoneText = 
        `✅ <b>បានបញ្ចប់ការបញ្ជាទិញ ${fullOrderId} ដោយជោគជ័យ!</b>\n` +
        `----------------------------------------\n` +
        `👤 <b>Admin ៖</b> ${adminName}\n` +
        `🟢 <b>Status:</b> <b>Completed ✅</b>`;

    try {
        await ctx.editMessageText(groupDoneText, { parse_mode: 'HTML' });
    } catch (e) {}

    // AUTOMATICALLY SEND NOTIFICATION TO CUSTOMER (BILINGUAL WITH 12-24H NOTICE)!
    const userLangCode = getLang(targetUserId);
    const customerNotifyMsg = userLangCode === 'en' ?
        `🎉 <b>Order Completed Successfully!</b>\n` +
        `----------------------------------------\n` +
        `🆔 <b>Order ID:</b> <code>${fullOrderId}</code>\n` +
        `📦 <b>Package:</b> ${targetOrder ? targetOrder.package_name : 'SMM Service'}\n` +
        `🟢 <b>Status:</b> <b>Completed ✅ (100% Success)</b>\n\n` +
        `(You will see Likes and Views increase within 12 to 24 hours)\n\n` +
        `📢 <b>Channel:</b> ${CHANNEL_LINK}\n` +
        `💖 <i>Thank you for using VIP SMM service from <b>${BRAND_NAME_UPPER}</b>!</i>` :
        `🎉 <b>ការបញ្ជាទិញរបស់អ្នកត្រូវបានបញ្ចប់ដោយជោគជ័យ (Order Completed)!</b>\n` +
        `----------------------------------------\n` +
        `🆔 <b>Order ID:</b> <code>${fullOrderId}</code>\n` +
        `📦 <b>Package:</b> ${targetOrder ? targetOrder.package_name : 'SMM Service'}\n` +
        `🟢 <b>Status:</b> <b>Completed ✅ (ជោគជ័យ ១០០%)</b>\n\n` +
        `(អ្នកនឹងឃើញកំណើន Like និង View កើនឡើងក្នុងចន្លោះពី 12 ទៅ 24 ម៉ោងក្រោយ)\n\n` +
        `📢 <b>Channel ៖</b> ${CHANNEL_LINK}\n` +
        `💖 <i>អរគុណសម្រាប់ការប្រើប្រាស់សេវាកម្ម SMM VIP របស់ <b>${BRAND_NAME_UPPER}</b>!</i>`;

    try {
        await bot.telegram.sendMessage(targetUserId, customerNotifyMsg, { 
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    } catch (e) {}
});

// Admin clicks [ ❌ បោះបង់ & វេរលុយសង (Cancel/Refund) ] in Admin Channel
bot.action(/^cancel_order_/, async (ctx) => {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) {
        try { return ctx.answerCbQuery('⛔ សម្រាប់តែ Admin!', { show_alert: true }); } catch (e) { return; }
    }

    const dataStr = ctx.callbackQuery.data;
    const parts = dataStr.split('_');

    const targetUserId = parseInt(parts.pop());
    const rawOrderId = parts.slice(2).join('_');
    const fullOrderId = rawOrderId.startsWith('ORD-') ? `#${rawOrderId}` : `#ORD-${rawOrderId}`;
    const adminName = ctx.from.first_name || 'Admin';

    // Anti-double-click protection — also prevents a refund after the order
    // was already marked Done (or a double refund from clicking twice).
    if (processedOrderActions.has(fullOrderId)) {
        try {
            return ctx.answerCbQuery('⚠️ Order នេះត្រូវបានសម្រេចរួចហើយ!', { show_alert: true });
        } catch (e) { return; }
    }
    processedOrderActions.add(fullOrderId);
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (e) {}

    let targetOrder = null;

    if (supabase) {
        try {
            const { data } = await supabase
                .from('orders')
                .select('*')
                .or(`order_id.ilike.%${rawOrderId.replace('#', '')}%`)
                .maybeSingle();
            targetOrder = data;

            if (targetOrder) {
                await supabase
                    .from('orders')
                    .update({ status: 'Canceled & Refunded' })
                    .eq('id', targetOrder.id);
            }
        } catch (e) {}
    }

    if (userOrdersCache[targetUserId]) {
        const item = userOrdersCache[targetUserId].find(o => o.order_id.includes(rawOrderId.replace('#', '')));
        if (item) {
            item.status = 'Canceled & Refunded';
            if (!targetOrder) targetOrder = item;
        }
    }

    const refundAmount = targetOrder ? parseFloat(targetOrder.price || 0) : 0;
    const currentBalance = getBalance(targetUserId);
    const newBalance = currentBalance + refundAmount;

    if (refundAmount > 0) {
        await dbUpdateBalance(targetUserId, newBalance);
    }

    try {
        await ctx.answerCbQuery('❌ បានបោះបង់ និង វេរលុយសងអតិថិជនវិញរួចរាល់!');
    } catch (e) {}

    // Edit message in Admin Channel
    const groupCancelText = 
        `❌ <b>បានបោះបង់ការបញ្ជាទិញ ${fullOrderId} និង វេរលុយសងវិញ!</b>\n` +
        `----------------------------------------\n` +
        `👤 <b>Admin ៖</b> ${adminName}\n` +
        `💵 <b>Refunded Amount:</b> $${refundAmount.toFixed(2)} USD\n` +
        `💰 <b>Customer New Balance:</b> $${newBalance.toFixed(2)} USD\n` +
        `🔴 <b>Status:</b> <b>Canceled & Refunded 💸</b>`;

    try {
        await ctx.editMessageText(groupCancelText, { parse_mode: 'HTML' });
    } catch (e) {}

    // AUTOMATICALLY SEND REFUND NOTIFICATION TO CUSTOMER!
    const customerNotifyMsg = 
        `⚠️ <b>ការបញ្ជាទិញរបស់អ្នកត្រូវបានបោះបង់ និង វេរលុយសងវិញ (Order Canceled & Refunded)!</b>\n` +
        `----------------------------------------\n` +
        `🆔 <b>Order ID:</b> <code>${fullOrderId}</code>\n` +
        `📦 <b>Package:</b> ${targetOrder ? targetOrder.package_name : 'SMM Service'}\n` +
        `💵 <b>ចំនួនលុយវេរជម្រះសងវិញ ៖</b> <b>+$${refundAmount.toFixed(2)} USD</b> 💸\n` +
        `💰 <b>តុល្យភាពបច្ចុប្បន្ន ៖</b> <b>$${newBalance.toFixed(2)} USD</b>\n` +
        `🔴 <b>Status:</b> <b>Canceled & Refunded 💸</b>\n\n` +
        `💡 <i>ប្រាក់ត្រូវបានបញ្ចូលត្រឡប់ទៅក្នុងកាបូបលុយរបស់អ្នកវិញរួចរាល់ហើយ។</i>\n` +
        `📞 <b>Support Admin ៖</b> ${SUPPORT_LINK}`;

    try {
        await bot.telegram.sendMessage(targetUserId, customerNotifyMsg, { parse_mode: 'HTML' });
    } catch (e) {}
});

// ADMIN COMMAND: /setstatus <ORDER_ID> <STATUS> (e.g. /setstatus ORD-749927 Completed)
bot.command(['setstatus', 'status', 'done'], async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/);

    if (parts.length < 2) {
        return ctx.replyWithHTML(
            `🛠 <b>របៀបប្រើប្រាស់ Admin Order Status Command ៖</b>\n` +
            `👉 <code>/setstatus ORD-749927 Completed</code>\n` +
            `👉 <code>/setstatus 749927 Completed</code>\n` +
            `👉 <code>/setstatus ORD-749927 Canceled</code>`
        );
    }

    const rawId = parts[1].replace('#', '').trim();
    const newStatus = parts[2] ? parts[2].trim() : 'Completed';

    let targetOrder = null;

    if (supabase) {
        try {
            const { data } = await supabase
                .from('orders')
                .select('*')
                .or(`order_id.ilike.%${rawId}%`)
                .maybeSingle();
            targetOrder = data;

            if (targetOrder) {
                await supabase
                    .from('orders')
                    .update({ status: newStatus })
                    .eq('id', targetOrder.id);
            }
        } catch (e) {}
    }

    // Update memory cache
    for (const uId in userOrdersCache) {
        const item = userOrdersCache[uId].find(o => o.order_id.includes(rawId));
        if (item) {
            item.status = newStatus;
            if (!targetOrder) targetOrder = item;
        }
    }

    if (targetOrder) {
        // Send notification to customer (Bilingual)
        try {
            const isCompleted = newStatus.toLowerCase().includes('complete') || newStatus.toLowerCase().includes('ជោគជ័យ');
            const statusBadge = isCompleted ? 'Completed ✅ (ជោគជ័យ ១០០%)' : `${newStatus} ⚠️`;
            const uLang = getLang(targetOrder.telegram_id);

            const notifyMsg = uLang === 'en' ?
                `🎉 <b>Order Status Update!</b>\n` +
                `----------------------------------------\n` +
                `🆔 <b>Order ID:</b> <code>${targetOrder.order_id}</code>\n` +
                `📦 <b>Package:</b> ${targetOrder.package_name}\n` +
                `🟢 <b>Status:</b> <b>${statusBadge}</b>\n\n` +
                `(You will see Likes and Views increase within 12 to 24 hours)\n\n` +
                `📢 <b>Channel:</b> ${CHANNEL_LINK}\n` +
                `💖 <i>Thank you for using VIP SMM service from <b>${BRAND_NAME_UPPER}</b>!</i>` :
                `🎉 <b>ព័ត៌មានបច្ចុប្បន្នភាពការបញ្ជាទិញ (Order Status Update)!</b>\n` +
                `----------------------------------------\n` +
                `🆔 <b>Order ID:</b> <code>${targetOrder.order_id}</code>\n` +
                `📦 <b>Package:</b> ${targetOrder.package_name}\n` +
                `🟢 <b>Status:</b> <b>${statusBadge}</b>\n\n` +
                `(អ្នកនឹងឃើញកំណើន Like និង View កើនឡើងក្នុងចន្លោះពី 12 ទៅ 24 ម៉ោងក្រោយ)\n\n` +
                `📢 <b>Channel ៖</b> ${CHANNEL_LINK}\n` +
                `💖 <i>អរគុណសម្រាប់ការប្រើប្រាស់សេវាកម្ម SMM VIP របស់ <b>${BRAND_NAME_UPPER}</b>!</i>`;

            await bot.telegram.sendMessage(targetOrder.telegram_id, notifyMsg, { 
                parse_mode: 'HTML',
                disable_web_page_preview: true 
            });
        } catch (e) {}

        return ctx.replyWithHTML(`✅ បានធ្វើបច្ចុប្បន្នភាព Order <b>#${targetOrder.order_id}</b> ទៅជា <b>${newStatus}</b> រួចរាល់!`);
    } else {
        return ctx.replyWithHTML(`❌ រកមិនឃើញ Order លេខ <code>${rawId}</code> ឡើយ!`);
    }
});

// REGISTER MENU COMMANDS (រក្សាទុកតែ /start មួយគត់ក្នុងប៊ូតុង Menu)
bot.telegram.setMyCommands([
    { command: 'start', description: '🔄 Start / ចាប់ផ្តើម' }
]).catch(err => console.log('Notice: Could not set my commands:', err.message));

// Reliable bot launch with dropPendingUpdates and auto-retry on polling error
let isShuttingDown = false;
function launchBot() {
    bot.launch({
        allowedUpdates: ['message', 'callback_query', 'channel_post'],
        dropPendingUpdates: true
    }).then(() => {
        console.log('🤖 Telegram Bot (LazR v2.0 exact Khmer/English UI) is running!');
    }).catch((err) => {
        console.error('❌ Failed to launch bot:', err.message);
        // Don't keep retrying once we're shutting down (e.g. mid-redeploy) —
        // otherwise the old instance spams 409 Conflict against the new one
        // until Render force-kills it.
        if (!isShuttingDown) setTimeout(launchBot, 5000);
    });
}
launchBot();

// HTTP Server for Render Health Check & ABA PayWay Webhooks
const PORT = process.env.PORT || 3000;
function readJsonBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve({}); }
        });
    });
}

function sendJson(res, statusCode, obj) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
}

http.createServer(async (req, res) => {
    const apiPath = req.url.split('?')[0];

    // ==========================================
    // JSON API for the standalone web ordering site (website/) — session-gated
    // via the Telegram Login Widget (see verifyTelegramLoginData above).
    // ==========================================
    if (apiPath.startsWith('/api/')) {
        if (apiPath === '/api/bot-info' && req.method === 'GET') {
            // Public — lets the frontend build the Telegram Login Widget without
            // hardcoding the bot's @username (so this same file works for any
            // white-label clone, see BRAND_NAME/NEW_CLIENT_SETUP.md). Also
            // exposes depositMode so the website's deposit flow can match
            // whatever mode the admin has set on the bot (auto-payment vs
            // manual admin-approval) instead of always assuming auto-payment.
            return sendJson(res, 200, { username: (bot.botInfo && bot.botInfo.username) || null, brandName: BRAND_NAME, depositMode });
        }

        if (apiPath === '/api/auth/telegram-login' && req.method === 'POST') {
            const data = await readJsonBody(req);
            if (!verifyTelegramLoginData(data)) {
                return sendJson(res, 401, { error: 'invalid_login' });
            }
            const telegramId = parseInt(data.id, 10);
            await dbGetUser(telegramId, data.first_name, data.username);
            if (data.username) userLang[telegramId] = userLang[telegramId] || 'km';
            const token = createWebSession(telegramId);
            res.setHeader('Set-Cookie', `blessing_session=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(WEB_SESSION_TTL_MS / 1000)}; Path=/`);
            return sendJson(res, 200, { ok: true });
        }

        if (apiPath === '/api/auth/telegram-webapp' && req.method === 'POST') {
            // Silent login for the site opened via one of the bot's own
            // button.webApp(...) buttons — the Login Widget above shows
            // "Bot domain invalid" when rendered inside Telegram's own
            // in-app browser, so this uses the WebApp SDK's initData instead.
            const body = await readJsonBody(req);
            const user = verifyTelegramWebAppInitData(body.initData);
            if (!user) {
                return sendJson(res, 401, { error: 'invalid_init_data' });
            }
            const telegramId = parseInt(user.id, 10);
            await dbGetUser(telegramId, user.first_name, user.username);
            if (user.username) userLang[telegramId] = userLang[telegramId] || 'km';
            const token = createWebSession(telegramId);
            res.setHeader('Set-Cookie', `blessing_session=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(WEB_SESSION_TTL_MS / 1000)}; Path=/`);
            return sendJson(res, 200, { ok: true });
        }

        if (apiPath === '/api/auth/logout' && req.method === 'POST') {
            const cookies = parseCookies(req);
            if (cookies['blessing_session']) webSessions.delete(cookies['blessing_session']);
            res.setHeader('Set-Cookie', 'blessing_session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
            return sendJson(res, 200, { ok: true });
        }

        const sessionUserId = getSessionUserId(req);
        if (!sessionUserId) {
            return sendJson(res, 401, { error: 'not_logged_in' });
        }

        if (apiPath === '/api/me' && req.method === 'GET') {
            await dbGetUser(sessionUserId);
            const balance = getBalance(sessionUserId);
            const orderCount = getOrdersCount(sessionUserId);
            return sendJson(res, 200, {
                telegramId: sessionUserId,
                balance,
                orderCount,
                rank: getUserRank(orderCount),
                lang: getLang(sessionUserId),
                isReseller: isReseller(sessionUserId),
                resellerDiscountPercent: isReseller(sessionUserId) ? resellerDiscountPercent : 0
            });
        }

        if (apiPath === '/api/me/language' && req.method === 'POST') {
            // Website language toggle also updates the same preference the bot
            // itself reads (getLang/dbUpdateLanguage) — one account, one
            // language setting, consistent across both channels.
            const body = await readJsonBody(req);
            const lang = body.lang === 'en' ? 'en' : 'km';
            await dbUpdateLanguage(sessionUserId, lang);
            return sendJson(res, 200, { ok: true, lang });
        }

        if (apiPath === '/api/packages' && req.method === 'GET') {
            const withEffectivePrice = (list) => list.map(p => ({
                name: p.name,
                price: parseFloat(getEffectivePrice(p.price, sessionUserId).toFixed(2))
            }));
            return sendJson(res, 200, {
                likes: withEffectivePrice(dynamicPackagePrices.likes),
                views: withEffectivePrice(dynamicPackagePrices.views),
                followers: withEffectivePrice(dynamicPackagePrices.followers)
            });
        }

        if (apiPath === '/api/orders' && req.method === 'GET') {
            let orders = userOrdersCache[sessionUserId] || [];
            if (supabase) {
                try {
                    const { data } = await supabase
                        .from('orders')
                        .select('*')
                        .eq('telegram_id', sessionUserId)
                        .order('created_at', { ascending: false })
                        .limit(50);
                    if (data) orders = data;
                } catch (e) {}
            }
            return sendJson(res, 200, { orders });
        }

        if (apiPath === '/api/orders' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const { packageName, price, targetLink } = body;
            if (!packageName || !price || !targetLink) {
                return sendJson(res, 400, { error: 'missing_fields' });
            }
            if (!targetLink.toLowerCase().includes('http')) {
                return sendJson(res, 400, { error: 'invalid_link' });
            }
            const result = await finalizeOrder(sessionUserId, packageName, parseFloat(price), targetLink, null);
            if (!result.success) {
                return sendJson(res, 400, { error: result.error, currentBalance: result.currentBalance });
            }
            return sendJson(res, 200, { orderId: result.orderId, newBalance: result.newBalance });
        }

        if (apiPath === '/api/deposits' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const amount = parseFloat(body.amount);
            if (isNaN(amount) || amount <= 0) {
                return sendJson(res, 400, { error: 'invalid_amount' });
            }
            const bonusPercent = (isBonusPromoOn && amount >= bonusMinDeposit) ? bonusPercentage : 0;
            const bonusAmount = (amount * bonusPercent) / 100;
            const depositId = `DEP${Math.floor(100000 + Math.random() * 900000)}`;

            if (supabase) {
                try {
                    await supabase.from('deposits').insert([{
                        deposit_id: depositId, telegram_id: sessionUserId,
                        amount, bonus: bonusAmount, status: 'Pending'
                    }]);
                } catch (e) {}
            }

            // Mirror the bot's own deposit flow exactly: only Mode 2 (AUTO /
            // ACLEDA) and Mode 4 (BAKONG) are hands-off, background-polled by
            // the auto-payment engine. Mode 1 (MANUAL) and Mode 3 (PAYWAY)
            // require the customer to actively confirm payment, which then
            // notifies the admin for a 1-click Approve/Reject — same as the
            // "💳 I Have Paid" button in the bot chat. Registering these into
            // pendingAutoDeposits would just burn Bakong's scarce daily quota
            // checking transactions a human is going to settle anyway.
            const isAutoMode = depositMode === 'BAKONG' || depositMode === 'AUTO';

            let dynamicQrData = await fetchBakongApiKhqrString(bakongAccountId || 'lasa_leng@aclb', amount, depositId);
            if (!dynamicQrData) {
                dynamicQrData = generateDynamicKhqr(bakongAccountId || 'lasa_leng@aclb', BRAND_NAME, amount, depositId);
            }
            const md5Hash = require('crypto').createHash('md5').update(dynamicQrData).digest('hex');
            if (isAutoMode) {
                registerPendingAutoDeposit(depositId, sessionUserId, amount, bonusAmount, md5Hash, depositMode);
            }

            return sendJson(res, 200, {
                depositId, amount, bonusAmount,
                depositMode,
                requiresManualConfirm: !isAutoMode,
                qrString: dynamicQrData,
                qrImageUrl: `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(dynamicQrData)}`
            });
        }

        if (apiPath.startsWith('/api/deposits/') && apiPath.endsWith('/status') && req.method === 'GET') {
            const depositId = apiPath.split('/')[3];
            const pending = pendingAutoDeposits[depositId];
            return sendJson(res, 200, { status: pending ? 'pending' : 'paid_or_expired' });
        }

        // Customer clicks "✅ I Have Paid" on the website (Mode 1 / Mode 3
        // only — see requiresManualConfirm above). Sends the exact same
        // Approve/Reject admin notification as the bot's confirm_dep
        // handler, so approve_dep/reject_dep need no changes to handle it.
        if (apiPath.startsWith('/api/deposits/') && apiPath.endsWith('/confirm') && req.method === 'POST') {
            const depositId = apiPath.split('/')[3];
            const body = await readJsonBody(req);
            const amount = parseFloat(body.amount) || 0;
            const bonusAmount = parseFloat(body.bonusAmount) || 0;
            const totalCredit = amount + bonusAmount;

            if (processedDepositIds.has(depositId) || processedDepositIds.has(`cancel_${depositId}`)) {
                return sendJson(res, 409, { error: 'already_processed' });
            }
            processedDepositIds.add(depositId);

            let customerName = 'Website Customer';
            try {
                const chat = await bot.telegram.getChat(sessionUserId);
                customerName = chat.first_name || customerName;
            } catch (e) {}

            const isPayWayMode = depositMode === 'PAYWAY';
            const adminNotifyMsg =
                `💳 <b>NEW DEPOSIT SUBMITTED (${isPayWayMode ? 'Mode 3: ABA PayWay Link' : 'Mode 1: Admin Approval'} — via Website)</b>\n` +
                `----------------------------------------\n` +
                `🆔 <b>Deposit ID:</b> <code>#${depositId}</code>\n` +
                `📲 <b>User ID:</b> <code>${sessionUserId}</code>\n` +
                `👤 <b>Customer:</b> ${customerName}\n` +
                `💳 <b>Amount:</b> $${amount.toFixed(2)} USD\n` +
                `🎁 <b>Bonus:</b> +$${bonusAmount.toFixed(2)} USD\n` +
                `💰 <b>Total to Credit:</b> $${totalCredit.toFixed(2)} USD\n` +
                `⏳ <b>Status:</b> Pending Approval ⏳`;

            const adminApprovalKb = Markup.inlineKeyboard([
                [Markup.button.callback('✅ យល់ព្រម (Approve)', `approve_dep_${depositId}_${sessionUserId}_${amount}_${bonusAmount}`)],
                [Markup.button.callback('❌ បដិសេធ (Reject)', `reject_dep_${depositId}_${sessionUserId}`)]
            ]);

            try {
                await bot.telegram.sendMessage(TARGET_ADMIN_CHAT_ID, adminNotifyMsg, {
                    parse_mode: 'HTML',
                    ...adminApprovalKb
                });
            } catch (groupErr) {
                console.error('⚠️ Could not send website deposit confirmation to admin channel:', groupErr.message);
            }

            return sendJson(res, 200, { status: 'pending_admin_approval' });
        }

        return sendJson(res, 404, { error: 'not_found' });
    }

    if (req.url && (req.url.includes('/payway') || req.url.includes('/callback') || req.url.includes('/webhook'))) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            console.log('🔔 Received PayWay Webhook POST:', body);
            try {
                let data = {};
                try { data = JSON.parse(body); } catch (e) {
                    const params = new URLSearchParams(body);
                    for (const [key, value] of params.entries()) { data[key] = value; }
                }
                const depId = data.tran_id || data.bill_number || data.deposit_id;

                if (depId && pendingAutoDeposits[depId]) {
                    const item = pendingAutoDeposits[depId];
                    delete pendingAutoDeposits[depId];

                    const userId = item.userId;
                    const currentBal = getBalance(userId);
                    const newBal = currentBal + item.totalCredit;
                    await dbUpdateBalance(userId, newBal);

                    if (supabase) {
                        try {
                            await supabase.from('deposits').update({ status: 'Approved (PayWay Webhook)' }).eq('deposit_id', depId);
                        } catch (e) {}
                    }

                    // Send Auto-Credit Confirmation to Customer!
                    const uLang = getLang(userId);
                    const msg = uLang === 'en' ?
                        `🎉 <b>ABA PayWay Payment Successful!</b>\n----------------------------------------\n💳 Amount: $${item.amount.toFixed(2)} USD\n🎁 Bonus: +$${item.bonusAmount.toFixed(2)} USD\n💰 New Wallet Balance: <b>$${newBal.toFixed(2)} USD</b>\n\n⚡ Thank you for your payment!` :
                        `🎉 <b>ABA PayWay ទូទាត់ប្រាក់ជោគជ័យ!</b>\n----------------------------------------\n💳 ទឹកប្រាក់បញ្ចូល៖ $${item.amount.toFixed(2)} USD\n🎁 ថែម Bonus៖ +$${item.bonusAmount.toFixed(2)} USD\n💰 តុល្យភាពកាបូបលុយថ្មី៖ <b>$${newBal.toFixed(2)} USD</b>\n\n⚡ អរគុណសម្រាប់ការទូទាត់ប្រាក់!`;

                    await bot.telegram.sendMessage(userId, msg, { parse_mode: 'HTML' });

                    // Notify Admin Channel
                    const adminMsg = `⚡ <b>AUTO-DEPOSIT APPROVED (ABA PayWay Webhook)</b>\n----------------------------------------\n🆔 <b>Deposit ID:</b> <code>#${depId}</code>\n📲 <b>User ID:</b> <code>${userId}</code>\n💳 <b>Amount:</b> $${item.amount.toFixed(2)} USD\n🎁 <b>Bonus:</b> +$${item.bonusAmount.toFixed(2)} USD\n🟢 <b>Status:</b> Auto-Credited ⚡`;
                    await bot.telegram.sendMessage(TARGET_ADMIN_CHAT_ID, adminMsg, { parse_mode: 'HTML' });
                }
            } catch (err) {
                console.error('⚠️ PayWay webhook process error:', err.message);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'OK' }));
        });
        return;
    }

    // Serve Website Files (Supports both root directory and website/ subfolder)
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '/index.html') {
        const filePathSub = path.join(__dirname, 'website', 'index.html');
        const filePathRoot = path.join(__dirname, 'index.html');
        const targetPath = fs.existsSync(filePathSub) ? filePathSub : (fs.existsSync(filePathRoot) ? filePathRoot : null);
        if (targetPath) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(fs.readFileSync(targetPath));
        }
    } else if (reqPath === '/style.css') {
        const filePathSub = path.join(__dirname, 'website', 'style.css');
        const filePathRoot = path.join(__dirname, 'style.css');
        const targetPath = fs.existsSync(filePathSub) ? filePathSub : (fs.existsSync(filePathRoot) ? filePathRoot : null);
        if (targetPath) {
            res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
            return res.end(fs.readFileSync(targetPath));
        }
    } else if (reqPath === '/app.js') {
        const filePathSub = path.join(__dirname, 'website', 'app.js');
        const filePathRoot = path.join(__dirname, 'app.js');
        const targetPath = fs.existsSync(filePathSub) ? filePathSub : (fs.existsSync(filePathRoot) ? filePathRoot : null);
        if (targetPath) {
            res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
            return res.end(fs.readFileSync(targetPath));
        }
    } else if (reqPath === '/about' || reqPath === '/about.html') {
        // Standalone business landing page (About/Services/Contact/Terms/Privacy/Refund)
        // — used for bank/payment-provider API applications (e.g. ACLEDA), not linked
        // from the customer-facing bot/WebApp.
        const aboutPath = path.join(__dirname, 'business-site', 'about.html');
        if (fs.existsSync(aboutPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(fs.readFileSync(aboutPath));
        }
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('🤖 Telegram Bot & WebApp is running Live 24/7!');
}).listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 WebApp Portal & Telegram Bot server running on port ${PORT} on 0.0.0.0`);
});

// bot.stop() throws ("Bot is not running!") if launchBot() hasn't successfully
// started polling yet (e.g. still retrying after a 409 Conflict) — without a
// try/catch that throw would abort this handler before process.exit(0) runs,
// so Render would see a crash instead of a clean shutdown and restart the old
// container, which then keeps conflicting with the new one indefinitely.
function shutdown(signal) {
    isShuttingDown = true;
    try { bot.stop(signal); } catch (e) {}
    process.exit(0);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

// Global Bot Error Catcher to prevent crashes
bot.catch((err, ctx) => {
    console.error(`⚠️ Telegram Bot error for ${ctx.updateType}:`, err.message);
});

// Render Keep-Alive Self Ping (Prevents Render Free Instance Sleep)
setInterval(() => {
    http.get(`http://127.0.0.1:${PORT}`, () => {}).on('error', () => {});
}, 300000);

// Blessing.Kh SMM Web Portal — real backend, Login with Telegram
// Every action here calls the real API added to index.js (auth, packages,
// orders, deposits) — no local mock/demo state.

let appState = {
    me: null,
    lang: localStorage.getItem('blessing_lang') || 'km',
    packages: { likes: [], views: [], followers: [] },
    currentCategory: 'likes',
    selectedPackage: null,
    orders: [],
    activeDepositId: null,
    depositPollTimer: null,
    // Mirrors the bot's own Bot Settings > Deposit Mode ('BAKONG' / 'AUTO' =
    // hands-off auto-detected, 'MANUAL' / 'PAYWAY' = requires the customer to
    // tap "I Have Paid" so an admin can approve) — fetched fresh each time
    // the app loads so switching the mode in the bot immediately reflects on
    // the website too, with no separate website setting to keep in sync.
    depositMode: null,
    activeDepositAmount: 0,
    activeDepositBonus: 0
};

// ================= i18n =================
// Same bilingual approach as the Telegram bot itself (km/en) — kept in sync
// with the account's language preference via GET/POST /api/me(/language),
// so switching language on the website also affects the bot side.
const I18N = {
    km: {
        login_prompt: 'ចូលគណនីតាម Telegram ដើម្បីបញ្ជាទិញ និង គ្រប់គ្រងកាបូបលុយរបស់អ្នក',
        add_funds_btn: '+ ថែមលុយ',
        status_online: 'Online 24/7 (ស្វ័យប្រវត្តិ)',
        tab_order: 'បញ្ជាទិញសេវា',
        tab_deposit: 'បញ្ចូលលុយ KHQR',
        tab_history: 'ប្រវត្តិទិញ',
        tab_support: 'ជំនួយ & Admin',
        step1_title: '1. ជ្រើសរើសបណ្តាញសង្គម (Choose Platform)',
        step2_title: '2. ជ្រើសរើសប្រភេទសេវាកម្ម (Select Category)',
        step3_title: '3. ជ្រើសរើសកញ្ចប់តម្លៃ & លីង (Package & Link)',
        tiktok_sub: 'ខ្មែរសុទ្ធ 100%',
        coming_soon: 'Coming Soon',
        package_label: 'ជ្រើសរើសកញ្ចប់ (Package):',
        link_label: 'ដាក់លីង (Target Link):',
        link_hint: 'សូមប្រាកដថា Account ឬ Video របស់អ្នកកំណត់ជា Public',
        sum_package_label: 'កញ្ចប់ដែលជ្រើសរើស ៖',
        sum_price_label: 'តម្លៃសរុប (Total Price) ៖',
        sum_balance_label: 'តុល្យភាពរបស់អ្នក ៖',
        balance_warning: '⚠️ តុល្យភាពរបស់អ្នកមិនគ្រប់គ្រាន់ឡើយ! សូមចុច "បញ្ចូលលុយ KHQR" ដើម្បីបន្ត។',
        submit_order_btn: '⚡ បញ្ជាទិញឥឡូវនេះ (Submit Order)',
        deposit_title: '💳 បញ្ចូលលុយតាម Bakong KHQR (Auto-Paid)',
        deposit_desc: 'បញ្ចូលទឹកប្រាក់ចូលកាបូបលុយរបស់អ្នកភ្លាមៗ ដោយស្វ័យប្រវត្តិ ១០០% មិនបាច់រង់ចាំ!',
        custom_amount_label: 'ឬបញ្ចូលចំនួនទឹកប្រាក់ផ្សេងទៀត ($ USD):',
        generate_qr_btn: '✨ បង្កើត Bakong KHQR Code',
        generating_qr: '⏳ កំពុងបង្កើត QR...',
        qr_waiting: '⏳ ប្រព័ន្ធកំពុងត្រួតពិនិត្យការទូទាត់ស្វ័យប្រវត្តិ...',
        qr_paid: '🎉 ទូទាត់ជោគជ័យ! លុយចូលកាបូបលុយរួចរាល់!',
        qr_expired: '⌛ QR នេះផុតកំណត់ — សូមបង្កើតថ្មី។',
        qr_manual_hint: '⚠️ បន្ទាប់ពីវេរប្រាក់រួច សូមចុចប៊ូតុង [ 💳 ខ្ញុំបានទូទាត់រួចរាល់ ] ខាងក្រោម',
        qr_manual_pending: '⏳ កំពុងរង់ចាំ Admin ពិនិត្យ និង យល់ព្រម...',
        confirm_paid_btn: '💳 ខ្ញុំបានទូទាត់រួចរាល់ (I Have Paid)',
        confirming_paid: '⏳ កំពុងផ្ញើសំណើ...',
        toast_confirm_sent: '✅ បានផ្ញើសារស្នើសុំបញ្ជាក់ការទូទាត់ទៅកាន់ Admin រួចរាល់!',
        toast_confirm_failed: '⚠️ មិនអាចផ្ញើសំណើបានទេ — សូមសាកល្បងម្តងទៀត',
        history_title: '📅 ប្រវត្តិបញ្ជាទិញ (Order History)',
        history_empty: 'ពុំទាន់មានប្រវត្តិបញ្ជាទិញនៅឡើយទេ',
        support_title: 'ជំនួយ & ទំនាក់ទំនង Admin',
        support_desc: 'ប្រសិនបើមានចម្ងល់ ឬបញ្ហាក្នុងការបញ្ជាទិញ សូមទាក់ទងមកកាន់ Admin យើងខ្ញុំ 24/7 ៖',
        contact_admin_btn: '✈️ Contact Telegram Admin (@Blessing_Kh_Supports)',
        official_channel_btn: '📢 Official Telegram Channel',
        toast_no_link: '⚠️ សូមបញ្ចូល Link target របស់អ្នកជាមុនសិន!',
        toast_insufficient_balance: '⚠️ តុល្យភាពមិនគ្រប់គ្រាន់ឡើយ! សូមបញ្ចូលលុយជាមុនសិន',
        toast_order_failed: '⚠️ បញ្ជាទិញមិនជោគជ័យ — សូមសាកល្បងម្តងទៀត',
        toast_order_success: '🎉 បញ្ជាទិញជោគជ័យ!',
        toast_network_error: '⚠️ បញ្ហាបណ្តាញ — សូមសាកល្បងម្តងទៀត',
        toast_qr_failed: '⚠️ មិនអាចបង្កើត QR បានទេ — សូមសាកល្បងម្តងទៀត',
        toast_deposit_success: '🎉 ទូទាត់ជោគជ័យ! លុយចូលកាបូបលុយរបស់អ្នករួចរាល់!',
        toast_platform_wip: '🚧 សេវាកម្មនេះកំពុងរៀបចំឡើង។ សូមជ្រើសរើស TikTok ជាបណ្តោះអាសន្ន!',
        signing_in: 'កំពុងចូល... (Signing in...)',
        login_failed: '❌ Login failed — please try again.',
        login_unavailable: '⚠️ Login temporarily unavailable — please try again shortly.',
        server_unreachable: '⚠️ Could not reach server.',
        cat_likes: '❤️ Like & Views Khmer (ខ្មែរសុទ្ធ)',
        cat_views: '👀 Video Views Khmer',
        cat_followers: '👥 Followers Khmer',
        lang_toggle_btn: '🇬🇧 English',
        add_home_screen_btn: '📌 បន្ថែមទៅអេក្រង់ដើម (Add to Home Screen)',
        toast_home_screen_added: '🎉 បានបន្ថែមទៅអេក្រង់ដើមដោយជោគជ័យ!'
    },
    en: {
        login_prompt: 'Log in with Telegram to order services and manage your wallet',
        add_funds_btn: '+ Add Funds',
        status_online: 'Online 24/7 (Automated)',
        tab_order: 'Order Services',
        tab_deposit: 'Deposit KHQR',
        tab_history: 'Order History',
        tab_support: 'Support & Admin',
        step1_title: '1. Choose Platform',
        step2_title: '2. Select Category',
        step3_title: '3. Package & Link',
        tiktok_sub: '100% Real Khmer',
        coming_soon: 'Coming Soon',
        package_label: 'Select Package:',
        link_label: 'Target Link:',
        link_hint: 'Make sure the account or video is set to Public',
        sum_package_label: 'Selected Package:',
        sum_price_label: 'Total Price:',
        sum_balance_label: 'Your Balance:',
        balance_warning: '⚠️ Insufficient balance! Tap "Deposit KHQR" to top up first.',
        submit_order_btn: '⚡ Submit Order',
        deposit_title: '💳 Deposit via Bakong KHQR (Auto-Paid)',
        deposit_desc: 'Top up your wallet instantly — 100% automated, no waiting!',
        custom_amount_label: 'Or enter a custom amount ($ USD):',
        generate_qr_btn: '✨ Generate Bakong KHQR Code',
        generating_qr: '⏳ Generating QR...',
        qr_waiting: '⏳ Checking for your payment automatically...',
        qr_paid: '🎉 Payment successful! Your wallet has been credited!',
        qr_expired: '⌛ This QR has expired — please generate a new one.',
        qr_manual_hint: '⚠️ After transferring, please tap the [ 💳 I Have Paid ] button below',
        qr_manual_pending: '⏳ Waiting for Admin to review and approve...',
        confirm_paid_btn: '💳 I Have Paid (Confirm Payment)',
        confirming_paid: '⏳ Sending request...',
        toast_confirm_sent: '✅ Payment confirmation request sent to Admin!',
        toast_confirm_failed: '⚠️ Could not send request — please try again',
        history_title: '📅 Order History',
        history_empty: 'No orders yet.',
        support_title: 'Support & Contact Admin',
        support_desc: 'Have questions or issues with an order? Contact our Admin 24/7:',
        contact_admin_btn: '✈️ Contact Telegram Admin (@Blessing_Kh_Supports)',
        official_channel_btn: '📢 Official Telegram Channel',
        toast_no_link: '⚠️ Please enter the target link first!',
        toast_insufficient_balance: '⚠️ Insufficient balance! Please deposit first.',
        toast_order_failed: '⚠️ Order failed — please try again.',
        toast_order_success: '🎉 Order placed successfully!',
        toast_network_error: '⚠️ Network error — please try again.',
        toast_qr_failed: '⚠️ Could not generate QR — please try again.',
        toast_deposit_success: '🎉 Payment successful! Your wallet has been credited!',
        toast_platform_wip: '🚧 Service under construction. Please select TikTok for now!',
        signing_in: 'Signing in...',
        login_failed: '❌ Login failed — please try again.',
        login_unavailable: '⚠️ Login temporarily unavailable — please try again shortly.',
        server_unreachable: '⚠️ Could not reach server.',
        cat_likes: '❤️ Like & Views Khmer',
        cat_views: '👀 Video Views Khmer',
        cat_followers: '👥 Followers Khmer',
        lang_toggle_btn: '🇰🇭 ខ្មែរ',
        add_home_screen_btn: '📌 Add to Home Screen',
        toast_home_screen_added: '🎉 Added to Home Screen successfully!'
    }
};

function t(key) {
    return (I18N[appState.lang] && I18N[appState.lang][key]) || I18N.km[key] || key;
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.documentElement.lang = appState.lang;
    const loginToggle = document.getElementById('btnToggleLangLogin');
    if (loginToggle) loginToggle.textContent = t('lang_toggle_btn');
    const appToggle = document.getElementById('btnToggleLang');
    if (appToggle) appToggle.textContent = appState.lang === 'km' ? '🇰🇭 KM' : '🇬🇧 EN';
}

async function setLanguage(lang) {
    appState.lang = lang === 'en' ? 'en' : 'km';
    localStorage.setItem('blessing_lang', appState.lang);
    applyTranslations();
    renderCategories();
    renderPackages();
    if (appState.orders) renderOrderHistory();
    if (appState.me) {
        try {
            await fetch('/api/me/language', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lang: appState.lang })
            });
        } catch (e) {}
    }
}

const CATEGORY_LABEL_KEYS = { likes: 'cat_likes', views: 'cat_views', followers: 'cat_followers' };

document.addEventListener('DOMContentLoaded', init);

async function init() {
    applyTranslations();
    initNavigationTabs();
    initPlatformSelector();
    initOrderForm();
    initDepositSection();
    document.getElementById('btnLogout').addEventListener('click', logout);
    document.getElementById('btnToggleLang').addEventListener('click', () => {
        setLanguage(appState.lang === 'km' ? 'en' : 'km');
    });
    document.getElementById('btnToggleLangLogin').addEventListener('click', () => {
        setLanguage(appState.lang === 'km' ? 'en' : 'km');
    });
    document.getElementById('btnAddHomeScreen').addEventListener('click', () => {
        if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.addToHomeScreen === 'function') {
            window.Telegram.WebApp.addToHomeScreen();
        }
    });
    // Telegram fires this event if the user completes the add-to-home-screen
    // flow (or dismisses/fails it) — hide the button once it's actually added.
    if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.onEvent === 'function') {
        window.Telegram.WebApp.onEvent('homeScreenAdded', () => {
            document.getElementById('btnAddHomeScreen').classList.add('hidden');
            showToast(t('toast_home_screen_added'), 'success');
        });
    }

    // Already have a valid session? (returning visit — cookie still valid)
    const me = await fetchMe();
    if (me) {
        await enterApp(me);
        return;
    }

    // Opened from one of the bot's own buttons (Telegram's in-app browser) —
    // log in silently via WebApp initData instead of the Login Widget, which
    // Telegram doesn't support rendering inside its own WebView.
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
        window.Telegram.WebApp.ready();
        const meFromWebApp = await loginViaTelegramWebApp();
        if (meFromWebApp) {
            await enterApp(meFromWebApp);
            return;
        }
    }

    await showLoginGate();
}

async function loginViaTelegramWebApp() {
    try {
        const res = await fetch('/api/auth/telegram-webapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: window.Telegram.WebApp.initData })
        });
        if (!res.ok) return null;
        return await fetchMe();
    } catch (e) {
        return null;
    }
}

// ================= AUTH =================

async function showLoginGate() {
    try {
        const res = await fetch('/api/bot-info');
        const info = await res.json();
        document.getElementById('loginBrandName').textContent = info.brandName || 'Blessing.Kh';

        if (info.username) {
            const script = document.createElement('script');
            script.src = 'https://telegram.org/js/telegram-widget.js?22';
            script.setAttribute('data-telegram-login', info.username);
            script.setAttribute('data-size', 'large');
            script.setAttribute('data-onauth', 'onTelegramAuth(user)');
            script.setAttribute('data-request-access', 'write');
            document.getElementById('telegramLoginContainer').appendChild(script);
        } else {
            document.getElementById('loginHint').textContent = t('login_unavailable');
        }
    } catch (e) {
        document.getElementById('loginHint').textContent = t('server_unreachable');
    }
}

// Called by the Telegram Login Widget after the user authorizes
window.onTelegramAuth = async function (user) {
    document.getElementById('loginHint').textContent = t('signing_in');
    try {
        const res = await fetch('/api/auth/telegram-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        });
        if (!res.ok) {
            document.getElementById('loginHint').textContent = t('login_failed');
            return;
        }
        const me = await fetchMe();
        if (me) await enterApp(me);
    } catch (e) {
        document.getElementById('loginHint').textContent = t('login_failed');
    }
};

async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    location.reload();
}

async function fetchMe() {
    try {
        const res = await fetch('/api/me');
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

async function enterApp(me) {
    appState.me = me;
    // Account's saved language preference (bot side) wins on first login of
    // a session unless the visitor already picked a language on this device.
    if (!localStorage.getItem('blessing_lang') && me.lang) {
        appState.lang = me.lang;
        applyTranslations();
    }
    document.getElementById('loginGate').classList.add('hidden');
    document.getElementById('appLayout').classList.remove('hidden');

    updateUserUi();
    await loadPackages();
    await loadOrderHistory();
    await loadDepositMode();
    checkHomeScreenPrompt();
}

// Reads the bot's currently configured Deposit Mode (Bot Settings menu) so
// the website's deposit tab behaves identically to the Telegram chat —
// hands-off auto-checking in Bakong/ACLEDA modes, or an "I Have Paid" button
// that notifies Admin in Manual/PayWay modes. Public endpoint, no auth
// required, safe to call before/after login.
async function loadDepositMode() {
    try {
        const res = await fetch('/api/bot-info');
        const info = await res.json();
        appState.depositMode = info.depositMode || 'MANUAL';
    } catch (e) {
        appState.depositMode = 'MANUAL'; // safest assumption if unreachable
    }
}

// Telegram Mini App "Add to Home Screen" (Bot API 8.0+) — lets the user pin
// a shortcut that launches straight into this Mini App. Only relevant when
// opened from inside Telegram; older Telegram client versions don't have
// these WebApp methods at all, hence the feature-detection.
function checkHomeScreenPrompt() {
    const btn = document.getElementById('btnAddHomeScreen');
    if (!window.Telegram || !window.Telegram.WebApp || typeof window.Telegram.WebApp.checkHomeScreenStatus !== 'function') {
        return;
    }
    window.Telegram.WebApp.checkHomeScreenStatus((status) => {
        if (status === 'missed' || status === 'unknown') {
            btn.classList.remove('hidden');
        }
    });
}

// ================= PROFILE UI =================

function getRankEmoji(count) {
    if (count >= 50) return '👑 Master Supreme VIP';
    if (count >= 20) return '💎 Diamond Member';
    if (count >= 5) return '🥇 Gold Member';
    if (count >= 1) return '🥈 Silver Member';
    return '🥉 Bronze Member';
}

function updateUserUi() {
    const me = appState.me;
    if (!me) return;
    document.getElementById('userBalance').textContent = `$${me.balance.toFixed(2)}`;
    document.getElementById('sumBalance').textContent = `$${me.balance.toFixed(2)} USD`;
    document.getElementById('userId').textContent = me.telegramId;
    document.getElementById('userRank').textContent = me.rank || getRankEmoji(me.orderCount);

    const resellerBadge = document.getElementById('resellerBadge');
    if (me.isReseller) {
        resellerBadge.textContent = `🏅 Reseller — -${me.resellerDiscountPercent}% Wholesale`;
        resellerBadge.classList.remove('hidden');
    } else {
        resellerBadge.classList.add('hidden');
    }
}

// ================= NAVIGATION =================

function initNavigationTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(target).classList.add('active');
            if (target === 'tab-history') loadOrderHistory();
        });
    });

    document.getElementById('btnOpenDeposit').addEventListener('click', () => {
        document.querySelector('[data-tab="tab-deposit"]').click();
    });
}

function initPlatformSelector() {
    const cards = document.querySelectorAll('.platform-card');
    cards.forEach(card => {
        card.addEventListener('click', () => {
            const platform = card.getAttribute('data-platform');
            if (platform !== 'tiktok') {
                showToast(t('toast_platform_wip'), 'error');
                return;
            }
            cards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
        });
    });
}

// ================= PACKAGES / ORDERING =================

async function loadPackages() {
    try {
        const res = await fetch('/api/packages');
        if (!res.ok) return;
        appState.packages = await res.json();
        renderCategories();
        renderPackages();
    } catch (e) {}
}

function renderCategories() {
    const container = document.getElementById('categorySelector');
    container.innerHTML = '';
    Object.keys(CATEGORY_LABEL_KEYS).forEach(catId => {
        const btn = document.createElement('button');
        btn.className = `cat-btn ${catId === appState.currentCategory ? 'active' : ''}`;
        btn.textContent = t(CATEGORY_LABEL_KEYS[catId]);
        btn.addEventListener('click', () => {
            document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            appState.currentCategory = catId;
            renderPackages();
        });
        container.appendChild(btn);
    });
}

function renderPackages() {
    const select = document.getElementById('packageSelect');
    select.innerHTML = '';

    const packages = appState.packages[appState.currentCategory] || [];
    packages.forEach((pkg, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${pkg.name} - $${pkg.price.toFixed(2)}`;
        select.appendChild(opt);
    });

    if (packages.length > 0) {
        appState.selectedPackage = packages[0];
        updateOrderSummary();
    }

    select.onchange = () => {
        const idx = parseInt(select.value);
        appState.selectedPackage = packages[idx];
        updateOrderSummary();
    };
}

function updateOrderSummary() {
    if (!appState.selectedPackage || !appState.me) return;

    document.getElementById('sumPackageName').textContent = appState.selectedPackage.name;
    document.getElementById('sumPrice').textContent = `$${appState.selectedPackage.price.toFixed(2)} USD`;

    const warning = document.getElementById('balanceWarning');
    const submitBtn = document.getElementById('btnSubmitOrder');

    if (appState.me.balance < appState.selectedPackage.price) {
        warning.classList.remove('hidden');
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
    } else {
        warning.classList.add('hidden');
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
    }
}

function initOrderForm() {
    const btn = document.getElementById('btnSubmitOrder');
    btn.addEventListener('click', async () => {
        const link = document.getElementById('targetLinkInput').value.trim();
        if (!link) {
            showToast(t('toast_no_link'), 'error');
            return;
        }
        if (!appState.selectedPackage) return;

        btn.disabled = true;
        try {
            const res = await fetch('/api/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    packageName: appState.selectedPackage.name,
                    price: appState.selectedPackage.price,
                    targetLink: link
                })
            });
            const data = await res.json();

            if (!res.ok) {
                if (data.error === 'insufficient_balance') {
                    showToast(t('toast_insufficient_balance'), 'error');
                } else {
                    showToast(t('toast_order_failed'), 'error');
                }
                return;
            }

            appState.me.balance = data.newBalance;
            updateUserUi();
            updateOrderSummary();
            document.getElementById('targetLinkInput').value = '';
            await loadOrderHistory();
            showToast(`${t('toast_order_success')} ${data.orderId}`, 'success');
        } catch (e) {
            showToast(t('toast_network_error'), 'error');
        } finally {
            btn.disabled = false;
        }
    });
}

// ================= DEPOSIT (REAL KHQR) =================

function initDepositSection() {
    const amountBtns = document.querySelectorAll('.amount-btn');
    const customInput = document.getElementById('customAmountInput');

    amountBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            amountBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            customInput.value = btn.getAttribute('data-amount');
        });
    });

    document.getElementById('btnGenerateQr').addEventListener('click', async () => {
        const amount = parseFloat(customInput.value) || 1.99;
        await generateRealDeposit(amount);
    });

    document.getElementById('btnConfirmPaid').addEventListener('click', confirmManualDeposit);
}

async function generateRealDeposit(amount) {
    stopDepositPolling();

    const genBtn = document.getElementById('btnGenerateQr');
    genBtn.disabled = true;
    genBtn.textContent = t('generating_qr');

    try {
        const res = await fetch('/api/deposits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount })
        });
        if (!res.ok) {
            showToast(t('toast_qr_failed'), 'error');
            return;
        }
        const dep = await res.json();

        const card = document.getElementById('qrCard');
        const label = document.getElementById('qrAmountLabel');
        const qrImg = document.getElementById('qrImage');
        const statusText = document.getElementById('qrStatusText');
        const confirmBtn = document.getElementById('btnConfirmPaid');

        label.textContent = `$${dep.amount.toFixed(2)} USD`;
        card.classList.remove('hidden');

        // Server-generated QR image (same api.qrserver.com approach the Telegram
        // bot itself uses) — avoids relying on a third-party client-side JS
        // library that tracking-prevention browsers/extensions silently block.
        qrImg.src = dep.qrImageUrl;

        appState.activeDepositId = dep.depositId;
        appState.activeDepositAmount = dep.amount;
        appState.activeDepositBonus = dep.bonusAmount;

        if (dep.requiresManualConfirm) {
            // Mode 1 (Manual) / Mode 3 (PayWay) — same as the bot chat:
            // customer must tap "I Have Paid" themselves, no background
            // auto-detection is running for this deposit.
            statusText.textContent = t('qr_manual_hint');
            confirmBtn.classList.remove('hidden');
            confirmBtn.disabled = false;
            confirmBtn.textContent = t('confirm_paid_btn');
        } else {
            // Mode 2 (ACLEDA Auto) / Mode 4 (Bakong Auto) — hands-off,
            // background-polled exactly like the bot chat's auto modes.
            statusText.textContent = t('qr_waiting');
            confirmBtn.classList.add('hidden');
            const balanceBeforePay = appState.me.balance;
            pollDepositStatus(dep.depositId, balanceBeforePay);
        }
    } catch (e) {
        showToast(t('toast_network_error'), 'error');
    } finally {
        genBtn.disabled = false;
        genBtn.textContent = t('generate_qr_btn');
    }
}

// Customer taps "💳 I Have Paid" (Manual/PayWay modes only) — mirrors the
// bot chat's confirm_dep flow: notifies Admin with 1-click Approve/Reject
// buttons, no Bakong/ACLEDA API call involved.
async function confirmManualDeposit() {
    const depositId = appState.activeDepositId;
    if (!depositId) return;

    const confirmBtn = document.getElementById('btnConfirmPaid');
    const statusText = document.getElementById('qrStatusText');
    confirmBtn.disabled = true;
    confirmBtn.textContent = t('confirming_paid');

    try {
        const res = await fetch(`/api/deposits/${depositId}/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: appState.activeDepositAmount,
                bonusAmount: appState.activeDepositBonus
            })
        });
        if (!res.ok) {
            showToast(t('toast_confirm_failed'), 'error');
            confirmBtn.disabled = false;
            confirmBtn.textContent = t('confirm_paid_btn');
            return;
        }
        statusText.textContent = t('qr_manual_pending');
        confirmBtn.classList.add('hidden');
        showToast(t('toast_confirm_sent'), 'success');
    } catch (e) {
        showToast(t('toast_network_error'), 'error');
        confirmBtn.disabled = false;
        confirmBtn.textContent = t('confirm_paid_btn');
    }
}

function pollDepositStatus(depositId, balanceBeforePay) {
    appState.depositPollTimer = setInterval(async () => {
        try {
            const res = await fetch(`/api/deposits/${depositId}/status`);
            const data = await res.json();
            if (data.status === 'pending') return; // still waiting

            stopDepositPolling();

            const me = await fetchMe();
            if (me) {
                appState.me = me;
                updateUserUi();
                updateOrderSummary();
            }

            const statusText = document.getElementById('qrStatusText');
            if (me && me.balance > balanceBeforePay) {
                statusText.textContent = t('qr_paid');
                showToast(t('toast_deposit_success'), 'success');
            } else {
                statusText.textContent = t('qr_expired');
            }
        } catch (e) {}
    }, 4000);
}

function stopDepositPolling() {
    if (appState.depositPollTimer) {
        clearInterval(appState.depositPollTimer);
        appState.depositPollTimer = null;
    }
}

// ================= ORDER HISTORY =================

async function loadOrderHistory() {
    try {
        const res = await fetch('/api/orders');
        if (!res.ok) return;
        const data = await res.json();
        appState.orders = data.orders || [];
        renderOrderHistory();
    } catch (e) {}
}

function renderOrderHistory() {
    const list = document.getElementById('historyList');
    if (appState.orders.length === 0) {
        list.innerHTML = `
            <div class="history-card">
                <p style="text-align:center; color: var(--text-sub);">${t('history_empty')}</p>
            </div>
        `;
        return;
    }

    list.innerHTML = appState.orders.map(o => `
        <div class="history-card">
            <div class="history-header">
                <span class="order-id">${o.order_id}</span>
                <span class="order-status status-processing">🟡 ${o.status}</span>
            </div>
            <div class="history-body">
                <strong>${o.package_name}</strong>
            </div>
            <div class="history-footer">
                <span>$${parseFloat(o.price).toFixed(2)} USD</span>
                <span>${new Date(o.created_at).toLocaleString()}</span>
            </div>
        </div>
    `).join('');
}

// ================= TOAST =================

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Blessing.Kh SMM Web Portal — real backend, Login with Telegram
// Every action here calls the real API added to index.js (auth, packages,
// orders, deposits) — no local mock/demo state.

let appState = {
    me: null,
    packages: { likes: [], views: [], followers: [] },
    currentCategory: 'likes',
    selectedPackage: null,
    orders: [],
    activeDepositId: null,
    depositPollTimer: null
};

const CATEGORY_LABELS = {
    likes: '❤️ Like & Views Khmer (ខ្មែរសុទ្ធ)',
    views: '👀 Video Views Khmer',
    followers: '👥 Followers Khmer'
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
    initNavigationTabs();
    initPlatformSelector();
    initOrderForm();
    initDepositSection();
    document.getElementById('btnLogout').addEventListener('click', logout);

    // Already have a valid session? (returning visit — cookie still valid)
    const me = await fetchMe();
    if (me) {
        await enterApp(me);
        return;
    }

    await showLoginGate();
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
            document.getElementById('loginHint').textContent = '⚠️ Login temporarily unavailable — please try again shortly.';
        }
    } catch (e) {
        document.getElementById('loginHint').textContent = '⚠️ Could not reach server.';
    }
}

// Called by the Telegram Login Widget after the user authorizes
window.onTelegramAuth = async function (user) {
    document.getElementById('loginHint').textContent = 'កំពុងចូល... (Signing in...)';
    try {
        const res = await fetch('/api/auth/telegram-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        });
        if (!res.ok) {
            document.getElementById('loginHint').textContent = '❌ Login failed — please try again.';
            return;
        }
        const me = await fetchMe();
        if (me) await enterApp(me);
    } catch (e) {
        document.getElementById('loginHint').textContent = '❌ Login failed — please try again.';
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
    document.getElementById('loginGate').classList.add('hidden');
    document.getElementById('appLayout').classList.remove('hidden');

    updateUserUi();
    await loadPackages();
    await loadOrderHistory();
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
                showToast('🚧 Service under construction. Please select TikTok for now!', 'error');
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
    Object.keys(CATEGORY_LABELS).forEach(catId => {
        const btn = document.createElement('button');
        btn.className = `cat-btn ${catId === appState.currentCategory ? 'active' : ''}`;
        btn.textContent = CATEGORY_LABELS[catId];
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
            showToast('⚠️ សូមបញ្ចូល Link target របស់អ្នកជាមុនសិន!', 'error');
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
                    showToast('⚠️ តុល្យភាពមិនគ្រប់គ្រាន់ឡើយ! សូមបញ្ចូលលុយជាមុនសិន', 'error');
                } else {
                    showToast('⚠️ បញ្ជាទិញមិនជោគជ័យ — សូមសាកល្បងម្តងទៀត', 'error');
                }
                return;
            }

            appState.me.balance = data.newBalance;
            updateUserUi();
            updateOrderSummary();
            document.getElementById('targetLinkInput').value = '';
            await loadOrderHistory();
            showToast(`🎉 បញ្ជាទិញជោគជ័យ! ${data.orderId}`, 'success');
        } catch (e) {
            showToast('⚠️ បញ្ហាបណ្តាញ — សូមសាកល្បងម្តងទៀត', 'error');
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
}

async function generateRealDeposit(amount) {
    stopDepositPolling();

    const genBtn = document.getElementById('btnGenerateQr');
    genBtn.disabled = true;
    genBtn.textContent = '⏳ កំពុងបង្កើត QR...';

    try {
        const res = await fetch('/api/deposits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount })
        });
        if (!res.ok) {
            showToast('⚠️ មិនអាចបង្កើត QR បានទេ — សូមសាកល្បងម្តងទៀត', 'error');
            return;
        }
        const dep = await res.json();

        const card = document.getElementById('qrCard');
        const label = document.getElementById('qrAmountLabel');
        const canvas = document.getElementById('qrCanvas');
        const statusText = document.getElementById('qrStatusText');

        label.textContent = `$${dep.amount.toFixed(2)} USD`;
        statusText.textContent = '⏳ ប្រព័ន្ធកំពុងត្រួតពិនិត្យការទូទាត់ស្វ័យប្រវត្តិ...';
        card.classList.remove('hidden');

        if (window.QRCode) {
            QRCode.toCanvas(canvas, dep.qrString, { width: 220, margin: 1 }, (err) => {
                if (err) console.error(err);
            });
        }

        appState.activeDepositId = dep.depositId;
        const balanceBeforePay = appState.me.balance;
        pollDepositStatus(dep.depositId, balanceBeforePay);
    } catch (e) {
        showToast('⚠️ បញ្ហាបណ្តាញ — សូមសាកល្បងម្តងទៀត', 'error');
    } finally {
        genBtn.disabled = false;
        genBtn.textContent = '✨ បង្កើត Bakong KHQR Code';
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
                statusText.textContent = '🎉 ទូទាត់ជោគជ័យ! លុយចូលកាបូបលុយរួចរាល់!';
                showToast('🎉 ទូទាត់ជោគជ័យ! លុយចូលកាបូបលុយរបស់អ្នករួចរាល់!', 'success');
            } else {
                statusText.textContent = '⌛ QR នេះផុតកំណត់ — សូមបង្កើតថ្មី។';
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
                <p style="text-align:center; color: var(--text-sub);">ពុំទាន់មានប្រវត្តិបញ្ជាទិញនៅឡើយទេ</p>
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

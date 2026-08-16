// Blessing.Kh SMM Web Portal Logic

const SMM_DATA = {
    tiktok: {
        categories: [
            { id: 'tt_like_views', name: '❤️ Like & Views Khmer (ខ្មែរសុទ្ធ)' },
            { id: 'tt_video_views', name: '👀 Video Views Khmer' },
            { id: 'tt_followers', name: '👥 Followers Khmer' }
        ],
        packages: {
            tt_like_views: [
                { name: '❤️ 549 - 1.2K Likes + 👀 700 - 2.5K Views', price: 1.99 },
                { name: '❤️ 900 - 2.5K Likes + 👀 1.5K - 4.5K Views', price: 3.00 },
                { name: '❤️ 3K - 6.8K Likes + 👀 4.5K - 15.5K Views', price: 8.00 },
                { name: '❤️ 6.6K - 14.8K Likes + 👀 9.5K - 38.5K Views', price: 16.00 },
                { name: '❤️ 15K - 34K Likes + 👀 22.5K - 77K Views', price: 35.00 },
                { name: '❤️ 35.7K - 80K Likes + 👀 50.5K - 180K Views', price: 80.00 },
                { name: '❤️ 73.5K - 168K Likes + 👀 110K - 360K Views', price: 150.00 },
                { name: '❤️ 297K - 668K Likes + 👀 450K - 1.2M Views', price: 500.00 }
            ],
            tt_video_views: [
                { name: '👀 2.4K - 8.2K Views + Likes Random', price: 1.99 },
                { name: '👀 4.2K - 14.4K Views + Likes Random', price: 3.00 },
                { name: '👀 13.2K - 45.3K Views + Likes Random', price: 8.00 },
                { name: '👀 28.9K - 98.9K Views + Likes Random', price: 16.00 },
                { name: '👀 66.3K - 226.8K Views + Likes Random', price: 35.00 },
                { name: '👀 156.7K - 526.1K Views + Likes Random', price: 80.00 },
                { name: '👀 325.5K - 1.11M Views + Likes Random', price: 150.00 },
                { name: '👀 1.3M - 4.5M Views + Likes Random', price: 500.00 }
            ],
            tt_followers: [
                { name: '👥 18 - 90 Khmer Followers + Likes & Views', price: 1.99 },
                { name: '👥 32 - 160 Khmer Followers + Likes & Views', price: 3.00 },
                { name: '👥 100 - 500 Khmer Followers + Likes & Views', price: 8.00 },
                { name: '👥 210 - 659 Khmer Followers + Likes & Views', price: 16.00 },
                { name: '👥 501 - 992 Khmer Followers + Likes & Views', price: 35.00 },
                { name: '👥 1183 - 1624 Khmer Followers + Likes & Views', price: 80.00 },
                { name: '👥 2456 - 2897 Khmer Followers + Likes & Views', price: 150.00 },
                { name: '👥 9822 - 10263 Khmer Followers + Likes & Views', price: 500.00 }
            ]
        }
    },
    telegram: {
        categories: [
            { id: 'tg_subscribers', name: '✈️ Channel Members (សមាជិក)' },
            { id: 'tg_views', name: '👁️ Post Views & Reactions' }
        ],
        packages: {
            tg_subscribers: [
                { name: '✈️ 500 Telegram Channel Members', price: 2.50 },
                { name: '✈️ 1,000 Telegram Channel Members', price: 4.50 },
                { name: '✈️ 5,000 Telegram Channel Members', price: 20.00 },
                { name: '✈️ 10,000 Telegram Channel Members', price: 38.00 }
            ],
            tg_views: [
                { name: '👁️ 1,000 Post Views (5 Posts)', price: 1.50 },
                { name: '👁️ 5,000 Post Views (10 Posts)', price: 4.00 },
                { name: '👍 1,000 Custom Reactions', price: 3.00 }
            ]
        }
    },
    facebook: {
        categories: [
            { id: 'fb_followers', name: '📘 Page Likes & Followers' },
            { id: 'fb_reactions', name: '👍 Post Reactions & Shares' }
        ],
        packages: {
            fb_followers: [
                { name: '📘 1,000 Facebook Page Followers', price: 5.00 },
                { name: '📘 5,000 Facebook Page Followers', price: 22.00 },
                { name: '📘 10,000 Facebook Page Followers', price: 40.00 }
            ],
            fb_reactions: [
                { name: '👍 1,000 Post Like/Love Reactions', price: 2.00 },
                { name: '🔄 500 Post Shares', price: 3.50 }
            ]
        }
    }
};

// Application State
let appState = {
    user: {
        id: 'Guest-' + Math.floor(1000 + Math.random() * 9000),
        name: 'Guest Customer',
        balance: 10.00, // Starter balance for demo testing
        orderCount: 0
    },
    currentPlatform: 'tiktok',
    currentCategory: 'tt_like_views',
    selectedPackage: null,
    orders: [],
    lang: 'km'
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    initTelegramUser();
    initNavigationTabs();
    initPlatformSelector();
    renderCategories();
    renderPackages();
    initDepositSection();
    initOrderForm();
    updateUserUi();

    console.log('Blessing.Kh Web App Ready');
});

// Telegram WebApp Setup
function initTelegramUser() {
    if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.expand();
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            const u = tg.initDataUnsafe.user;
            appState.user.id = u.id;
            appState.user.name = (u.first_name + ' ' + (u.last_name || '')).trim();
            document.getElementById('statusText').textContent = 'Online (Telegram WebApp Connected)';
        }
    }
}

function getRank(count) {
    if (count >= 50) return '👑 Master Supreme VIP';
    if (count >= 20) return '💎 Diamond Member';
    if (count >= 5) return '🥇 Gold Member';
    if (count >= 1) return '🥈 Silver Member';
    return '🥉 Bronze Member';
}

function updateUserUi() {
    document.getElementById('userName').textContent = appState.user.name;
    document.getElementById('userId').textContent = appState.user.id;
    document.getElementById('userBalance').textContent = `$${appState.user.balance.toFixed(2)}`;
    document.getElementById('sumBalance').textContent = `$${appState.user.balance.toFixed(2)} USD`;
    document.getElementById('userRank').textContent = getRank(appState.user.orderCount);
}

// Navigation Tabs
function initNavigationTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const target = tab.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(target).classList.add('active');
        });
    });

    document.getElementById('btnOpenDeposit').addEventListener('click', () => {
        document.querySelector('[data-tab="tab-deposit"]').click();
    });
}

// Platform Selection
function initPlatformSelector() {
    const cards = document.querySelectorAll('.platform-card');
    cards.forEach(card => {
        card.addEventListener('click', () => {
            cards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            appState.currentPlatform = card.getAttribute('data-platform');
            appState.currentCategory = SMM_DATA[appState.currentPlatform].categories[0].id;
            
            renderCategories();
            renderPackages();
        });
    });
}

// Category Buttons
function renderCategories() {
    const container = document.getElementById('categorySelector');
    container.innerHTML = '';

    const categories = SMM_DATA[appState.currentPlatform].categories;
    categories.forEach((cat, index) => {
        const btn = document.createElement('button');
        btn.className = `cat-btn ${cat.id === appState.currentCategory ? 'active' : ''}`;
        btn.textContent = cat.name;
        btn.addEventListener('click', () => {
            document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            appState.currentCategory = cat.id;
            renderPackages();
        });
        container.appendChild(btn);
    });
}

// Package Select Dropdown
function renderPackages() {
    const select = document.getElementById('packageSelect');
    select.innerHTML = '';

    const packages = SMM_DATA[appState.currentPlatform].packages[appState.currentCategory] || [];
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
    if (!appState.selectedPackage) return;

    document.getElementById('sumPackageName').textContent = appState.selectedPackage.name;
    document.getElementById('sumPrice').textContent = `$${appState.selectedPackage.price.toFixed(2)} USD`;

    const warning = document.getElementById('balanceWarning');
    const submitBtn = document.getElementById('btnSubmitOrder');

    if (appState.user.balance < appState.selectedPackage.price) {
        warning.classList.remove('hidden');
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
    } else {
        warning.classList.add('hidden');
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
    }
}

// Order Form Submission
function initOrderForm() {
    const btn = document.getElementById('btnSubmitOrder');
    btn.addEventListener('click', () => {
        const link = document.getElementById('targetLinkInput').value.trim();
        if (!link) {
            showToast('⚠️ សូមបញ្ចូល Link target របស់អ្នកជាមុនសិន!', 'error');
            return;
        }

        if (appState.user.balance < appState.selectedPackage.price) {
            showToast('⚠️ តុល្យភាពមិនគ្រប់គ្រាន់ឡើយ! សូមបញ្ចូលលុយជាមុនសិន', 'error');
            return;
        }

        // Deduct Balance
        appState.user.balance -= appState.selectedPackage.price;
        appState.user.orderCount += 1;

        const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
        const newOrder = {
            id: orderId,
            package: appState.selectedPackage.name,
            price: appState.selectedPackage.price,
            link: link,
            status: 'Processing',
            date: new Date().toLocaleString()
        };

        appState.orders.unshift(newOrder);

        // Send data to Telegram WebApp if connected
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.sendData(JSON.stringify({
                action: 'create_order',
                orderId: orderId,
                package: appState.selectedPackage.name,
                price: appState.selectedPackage.price,
                link: link
            }));
        }

        updateUserUi();
        updateOrderSummary();
        renderOrderHistory();
        document.getElementById('targetLinkInput').value = '';

        showToast(`🎉 បញ្ជាទិញជោគជ័យ! #${orderId}`, 'success');
    });
}

// Deposit KHQR Generator
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

    document.getElementById('btnGenerateQr').addEventListener('click', () => {
        const amount = parseFloat(customInput.value) || 1.99;
        generateKhqrCode(amount);
    });

    document.getElementById('btnSimulatePay').addEventListener('click', () => {
        const amount = parseFloat(document.getElementById('qrAmountLabel').getAttribute('data-amt')) || 1.99;
        appState.user.balance += amount;
        updateUserUi();
        updateOrderSummary();

        document.getElementById('qrCard').classList.add('hidden');
        showToast(`🎉 ទទួលបាន $${amount.toFixed(2)} USD ចូលកាបូបលុយស្វ័យប្រវត្តិ!`, 'success');
    });
}

function generateKhqrCode(amount) {
    const card = document.getElementById('qrCard');
    const label = document.getElementById('qrAmountLabel');
    const canvas = document.getElementById('qrCanvas');

    label.textContent = `$${amount.toFixed(2)} USD`;
    label.setAttribute('data-amt', amount);
    card.classList.remove('hidden');

    // Dynamic payload simulation string matching Bakong EMVCo structure
    const payload = `00020101021229300015km.gov.nbc.bakong0121bun_bandithsophea@bkrt5204599953038405404${amount.toFixed(2)}5802KH5918Blessing.Kh SMM6010Phnom Penh620701031006304ABCD`;

    if (window.QRCode) {
        QRCode.toCanvas(canvas, payload, { width: 200, margin: 1 }, (err) => {
            if (err) console.error(err);
        });
    }
}

// Order History List
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
                <span class="order-id">#${o.id}</span>
                <span class="order-status status-processing">🟡 ${o.status}</span>
            </div>
            <div class="history-body">
                <strong>${o.package}</strong>
            </div>
            <div class="history-footer">
                <span>$${o.price.toFixed(2)} USD</span>
                <span>${o.date}</span>
            </div>
        </div>
    `).join('');
}

// Toast Notifications
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

let currentTab = 'fuel';
let currentPage = 1;
const ITEMS_PER_PAGE = 10;
let editingId = null;
let currentUser = null;
let localCache = { fuel: [], maint: [] };
let $summary, $list, $pagination, $modal, $form, $fields, $themeBtn, $addBtn;
let $loadingOverlay, $submitBtn;

document.addEventListener('DOMContentLoaded', async () => {
    $summary = document.getElementById('summary');
    $list = document.getElementById('list-container');
    $pagination = document.getElementById('pagination');
    $modal = document.getElementById('modal');
    $form = document.getElementById('record-form');
    $fields = document.getElementById('form-fields');
    $themeBtn = document.getElementById('theme-toggle');
    $addBtn = document.getElementById('add-btn');
    $loadingOverlay = document.getElementById('loading-overlay');
    $submitBtn = $form?.querySelector('button[type="submit"]');

    loadTheme();
    await waitForDb();
    setupAuthListener();
    setupUserMenu();
    await checkAuth();
    setupEvents();

    // 🛡️ BLOQUEAR RECARGAS AUTOMÁTICAS AL CAMBIAR PESTAÑA O IR A SEGUNDO PLANO
    document.addEventListener('visibilitychange', () => {
        hideLoading(); // Si el SO/navegador dejó el overlay trabado, liberarlo inmediatamente
    });
    window.addEventListener('pageshow', hideLoading);
});

function showLoading() {
    if ($loadingOverlay) $loadingOverlay.classList.add('active');
    if ($submitBtn) { $submitBtn.disabled = true; $submitBtn.textContent = '⏳ Procesando...'; }
}
function hideLoading() {
    if ($loadingOverlay) $loadingOverlay.classList.remove('active');
    if ($submitBtn) { $submitBtn.disabled = false; $submitBtn.textContent = 'Guardar'; }
}
function waitForDb(timeout = 5000) {
    return new Promise(resolve => {
        if (window.db) return resolve();
        const start = Date.now();
        const check = () => window.db || Date.now() - start > timeout ? resolve() : setTimeout(check, 100);
        check();
    });
}

async function checkAuth() {
    const saved = localStorage.getItem('mototrack_user');
    if (saved && window.db) {
        try {
            const user = await Promise.race([window.db.getCurrentUser(), new Promise(r => setTimeout(() => r(null), 3000))]);
            if (user) {
                currentUser = user;
                if ($addBtn) $addBtn.style.display = 'flex';
                await loadData(); // ✅ ÚNICA carga automática: al iniciar sesión
                return;
            }
        } catch (e) { console.warn('Auth check error:', e); }
    }
    if ($addBtn) $addBtn.style.display = 'none';
    const userBtn = document.getElementById('user-menu-btn');
    if (userBtn) userBtn.style.display = 'none';
    showLoginModal();
    renderAll();
}

function setupAuthListener() {
    if (!window.db || !window.db.supabase?.auth) return;
    window.db.supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
            currentUser = session.user;
            localStorage.setItem('mototrack_user', JSON.stringify({ id: currentUser.id, email: currentUser.email }));
            if ($modal?.open) $modal.close();
            const userBtn = document.getElementById('user-menu-btn');
            if (userBtn) userBtn.style.display = 'flex';
            if ($addBtn) $addBtn.style.display = 'flex';
            loadData(); // ✅ Cargar solo al entrar
        } else if (event === 'SIGNED_OUT') {
            currentUser = null;
            localCache = { fuel: [], maint: [] };
            localStorage.removeItem('mototrack_user');
            hideLoading();
            const userBtn = document.getElementById('user-menu-btn');
            if (userBtn) userBtn.style.display = 'none';
            if ($addBtn) $addBtn.style.display = 'none';
            renderAll();
            showLoginModal();
        }
    });
}

function setupUserMenu() {
    const $userMenuBtn = document.getElementById('user-menu-btn');
    const $drawer = document.getElementById('user-drawer');
    const $closeDrawer = document.getElementById('close-drawer');
    const $drawerOverlay = document.querySelector('.drawer-overlay');
    const $userEmailDisplay = document.getElementById('user-email-display');
    const $passForm = document.getElementById('change-pass-form');
    const $passMsg = document.getElementById('pass-msg');
    const $logoutBtn = document.getElementById('logout-btn');

    if (!$userMenuBtn) return;
    $userMenuBtn.addEventListener('click', () => {
        if (currentUser) {
            if ($userEmailDisplay) $userEmailDisplay.textContent = currentUser.email;
            const cp = document.getElementById('current-pass'), np = document.getElementById('new-pass'), cnp = document.getElementById('confirm-pass');
            if (cp) cp.value = ''; if (np) np.value = ''; if (cnp) cnp.value = '';
            if ($passMsg) { $passMsg.textContent = ''; $passMsg.className = 'msg'; }
            if ($drawer) $drawer.classList.add('open');
        }
    });
    const closeDrawer = () => $drawer?.classList.remove('open');
    $closeDrawer?.addEventListener('click', closeDrawer);
    $drawerOverlay?.addEventListener('click', closeDrawer);

    $passForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const currentPass = document.getElementById('current-pass')?.value;
        const newPass = document.getElementById('new-pass')?.value;
        const confirmPass = document.getElementById('confirm-pass')?.value;
        if ($passMsg) { $passMsg.textContent = '⏳ Verificando...'; $passMsg.className = 'msg'; }
        if (newPass !== confirmPass) { if ($passMsg) { $passMsg.textContent = '❌ No coinciden'; $passMsg.className = 'msg error'; } return; }
        if (currentPass === newPass) { if ($passMsg) { $passMsg.textContent = '❌ Debe ser diferente'; $passMsg.className = 'msg error'; } return; }

        showLoading();
        try {
            const { error: authError } = await window.db.supabase.auth.signInWithPassword({ email: currentUser.email, password: currentPass });
            if (authError) throw new Error('Contraseña actual incorrecta');
            const { error: updateError } = await window.db.supabase.auth.updateUser({ password: newPass });
            if (updateError) throw updateError;
            if ($passMsg) { $passMsg.textContent = '✅ Contraseña actualizada'; $passMsg.className = 'msg success'; }
            const cp = document.getElementById('current-pass'), np = document.getElementById('new-pass'), cnp = document.getElementById('confirm-pass');
            if (cp) cp.value = ''; if (np) np.value = ''; if (cnp) cnp.value = '';
        } catch (err) {
            if ($passMsg) { $passMsg.textContent = '❌ ' + (err.message || 'Error'); $passMsg.className = 'msg error'; }
        } finally { hideLoading(); }
    });
    $logoutBtn?.addEventListener('click', async () => {
        if (confirm('¿Cerrar sesión?')) { await window.db.signOut(); closeDrawer(); }
    });
}

// ✅ CARGA EXPLÍCITA: Solo se llama cuando el usuario interactúa o inicia sesión
async function loadData() {
    if (!window.db) { renderAll(); return; }
    showLoading();
    try {
        const [fuel, maint] = await Promise.all([
            window.db.fetchRecords('fuel'),
            window.db.fetchRecords('maintenance')
        ]);
        localCache.fuel = calculateMetrics(fuel, 'fuel');
        localCache.maint = calculateMetrics(maint, 'maint');
    } catch (e) {
        console.error('❌ Error cargando:', e);
    } finally {
        hideLoading(); // ✅ SIEMPRE se oculta, evita pantallas trabadas
        renderAll();
    }
}

function calculateMetrics(records, type) {
    if (!records?.length) return [];
    const sorted = [...records].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    sorted.forEach((rec, i) => {
        const prev = sorted[i - 1];
        const odom = parseFloat(rec.odometer) || 0;
        const prevOdom = prev ? parseFloat(prev.odometer) || 0 : 0;
        const diff = odom - prevOdom;
        if (type === 'fuel') {
            const liters = parseFloat(rec.liters) || 0;
            rec.consumption = prev && liters > 0 ? (diff / liters).toFixed(2) : 'PRIMER REGISTRO';
            rec.interval = prev ? diff.toFixed(2) : 'PRIMER REGISTRO';
        } else {
            rec.consumption = prev ? diff.toFixed(2) : 'PRIMER REGISTRO';
            rec.interval = rec.consumption;
        }
    });
    return records;
}

function setupEvents() {
    // ✅ TABS: Solo cambian vista y renderizan desde caché, SIN llamar a loadData()
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentTab = e.target.dataset.tab;
            currentPage = 1;
            renderAll();
        });
    });

    $addBtn?.addEventListener('click', () => currentUser ? openModal() : showLoginModal());
    document.getElementById('cancel-btn')?.addEventListener('click', () => { $modal?.close(); editingId = null; $form?.reset(); });
    $modal?.addEventListener('close', () => { editingId = null; $form?.reset(); });
    $form?.addEventListener('submit', saveRecord);

    $list?.addEventListener('click', (e) => {
        const card = e.target.closest('[data-id]');
        if (!card) return;
        const id = card.dataset.id;
        if (e.target.classList.contains('edit')) currentUser ? openModal(id) : showLoginModal();
        if (e.target.classList.contains('delete')) currentUser ? deleteRecord(id) : showLoginModal();
    });
    $themeBtn?.addEventListener('click', toggleTheme);
}

function getRecords() { return (localCache[currentTab] || []).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)); }

function renderAll() {
    const records = getRecords();
    renderSummary(records);
    renderList(records);
    renderPagination(records.length);
}

function renderSummary(records) {
    let totalMoney = 0, avgVal = 0;
    const valid = records.filter(r => r.consumption !== 'PRIMER REGISTRO' && !isNaN(parseFloat(r.consumption)));
    if (valid.length > 0) avgVal = valid.reduce((s, r) => s + parseFloat(r.consumption), 0) / valid.length;
    records.forEach(r => totalMoney += parseFloat(r.money || r.price || 0) || 0);

    const label = currentTab === 'fuel' ? 'Promedio General KM/L' : 'Promedio General KM/Mant.';
    const moneyLabel = currentTab === 'fuel' ? 'Dinero invertido (combustible)' : 'Dinero invertido (aceite)';
    if ($summary) $summary.innerHTML = `
        <div class="summary-stat"><span>${avgVal.toFixed(2)}</span>${label}</div>
        <div class="summary-stat"><span>$${totalMoney.toFixed(2)}</span>${moneyLabel}</div>`;
}

function renderList(records) {
    if (!$list) return;
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const pageData = records.slice(start, start + ITEMS_PER_PAGE);
    $list.innerHTML = '';
    if (!pageData.length) {
        $list.innerHTML = '<div class="empty-state">No hay registros aún. Toca + para agregar uno.</div>';
        return;
    }
    pageData.forEach(rec => {
        const priceL = rec.price_per_liter ?? rec.pricePerL ?? 0;
        const oilType = rec.oil_type ?? rec.oilType ?? rec.type ?? 'N/A';
        const dinero = currentTab === 'fuel' ? (parseFloat(rec.money) || (parseFloat(rec.liters) * parseFloat(priceL))).toFixed(2) : parseFloat(rec.price).toFixed(2);
        
        const fields = currentTab === 'fuel'
            ? `<div class="record-row"><span class="label">📅 Fecha:</span><span class="value">${formatDate(rec.date)}</span></div>
               <div class="record-row"><span class="label">🛣️ Odómetro:</span><span class="value">${rec.odometer} km</span></div>
               <div class="record-row"><span class="label">⛽ Litros:</span><span class="value">${rec.liters} L</span></div>
               <div class="record-row"><span class="label">💲 Precio/L:</span><span class="value">$${priceL}</span></div>
               <div class="record-row money-row"><span class="label">💰 Dinero gastado:</span><span class="value">$${dinero}</span></div>
               <div class="record-row"><span class="label">🔧 Intervalo:</span><span class="value">${rec.interval} KM</span></div>
               <div class="record-row"><span class="label">🏁 Consumo:</span><span class="value">${rec.consumption} KM/L</span></div>`
            : `<div class="record-row"><span class="label">📅 Fecha:</span><span class="value">${formatDate(rec.date)}</span></div>
               <div class="record-row"><span class="label">🛣️ Odómetro:</span><span class="value">${rec.odometer} km</span></div>
               <div class="record-row"><span class="label">🛢️ Aceite:</span><span class="value">${rec.brand} (${oilType} - ${rec.viscosity})</span></div>
               <div class="record-row"><span class="label">💲 Precio:</span><span class="value">$${rec.price}</span></div>
               <div class="record-row"><span class="label">🔧 Intervalo:</span><span class="value">${rec.consumption} KM</span></div>`;

        $list.insertAdjacentHTML('beforeend', `
            <article class="record-card" data-id="${rec.id}">
                ${fields}
                <div class="record-actions">
                    <button class="edit">Editar</button>
                    <button class="delete" style="background:#ef4444; color:white;">Eliminar</button>
                </div>
            </article>`);
    });
}

function renderPagination(total) {
    if (!$pagination) return;
    const pages = Math.ceil(total / ITEMS_PER_PAGE);
    $pagination.innerHTML = '';
    if (pages <= 1) return;
    for (let i = 1; i <= pages; i++) {
        const btn = document.createElement('button');
        btn.textContent = i;
        btn.style.fontWeight = i === currentPage ? 'bold' : 'normal';
        btn.addEventListener('click', () => { currentPage = i; renderAll(); });
        $pagination.appendChild(btn);
    }
}

function showLoginModal() {
    const modalActions = document.querySelector('.modal-actions');
    if (modalActions) modalActions.style.display = 'none';
    document.getElementById('modal-title').textContent = 'Iniciar Sesión';
    if ($fields) $fields.innerHTML = `
        <div style="margin-bottom:1rem;"><label style="display:block;font-weight:500;margin-bottom:0.3rem;">Email</label>
        <input type="email" id="auth-email" placeholder="tu@email.com" required style="width:100%;padding:0.6rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);"></div>
        <div style="margin-bottom:1rem;"><label style="display:block;font-weight:500;margin-bottom:0.3rem;">Contraseña (mín. 6)</label>
        <input type="password" id="auth-pass" placeholder="••••••••" minlength="6" required style="width:100%;padding:0.6rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);"></div>
        <div style="display:flex;gap:0.5rem;">
            <button type="button" id="auth-login" style="flex:1;padding:0.6rem;background:#dbeafe;color:#1d4ed8;border:none;border-radius:6px;cursor:pointer;font-weight:500;">Entrar</button>
            <button type="button" id="auth-signup" style="flex:1;padding:0.6rem;background:#fee2e2;color:#b91c1c;border:none;border-radius:6px;cursor:pointer;font-weight:500;">Registrarse</button>
        </div>
        <p id="auth-error" style="color:#ef4444;font-size:0.85rem;margin-top:0.5rem;display:none;"></p>`;
    $modal?.showModal();
    
    const $err = document.getElementById('auth-error');
    const $logBtn = document.getElementById('auth-login'), $regBtn = document.getElementById('auth-signup');
    const reset = () => { $logBtn.disabled=$regBtn.disabled=false; $regBtn.textContent='Registrarse'; };
    
    $logBtn.onclick = async () => {
        const e = document.getElementById('auth-email').value.trim(), p = document.getElementById('auth-pass').value;
        if (!e || !p) { $err.textContent='Ingresa email y contraseña'; $err.style.display='block'; return; }
        $err.style.display='none'; $logBtn.disabled=$regBtn.disabled=true; $logBtn.textContent='Entrando...';
        try {
            const res = await window.db.signIn(e, p);
            if (res?.data?.user) { $modal?.close(); } // El listener se encargará de loadData()
            else { reset(); $err.textContent = res?.error?.message || 'Error'; $err.style.display='block'; }
        } catch(err) { reset(); $err.textContent = err.message; $err.style.display='block'; }
    };
    $regBtn.onclick = async () => {
        const e = document.getElementById('auth-email').value.trim(), p = document.getElementById('auth-pass').value;
        if (!e || !p) { $err.textContent='Ingresa email y contraseña'; $err.style.display='block'; return; }
        if (p.length < 6) { $err.textContent='Mínimo 6 caracteres'; $err.style.display='block'; return; }
        $err.style.display='none'; $logBtn.disabled=$regBtn.disabled=true; $regBtn.textContent='Creando...';
        try {
            const res = await window.db.signUp(e, p);
            if (res?.data?.user) { $modal?.close(); } // El listener se encargará de loadData()
            else { reset(); $err.textContent = res?.error?.message || 'Error'; $err.style.display='block'; }
        } catch(err) { reset(); $err.textContent = err.message; $err.style.display='block'; }
    };
}

function openModal(id = null) {
    if (!currentUser) { showLoginModal(); return; }
    const modalActions = document.querySelector('.modal-actions');
    if (modalActions) modalActions.style.display = 'flex';
    editingId = id;
    const rec = id ? localCache[currentTab].find(r => r.id === id) : null;
    if(document.getElementById('modal-title')) document.getElementById('modal-title').textContent = id ? 'Editar Registro' : 'Nuevo Registro';
    
    const now = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    if($fields) $fields.innerHTML = '';
    const safePriceL = rec?.price_per_liter ?? rec?.pricePerL ?? '';
    const safeOilType = rec?.oil_type ?? rec?.oilType ?? rec?.type ?? 'Sintético';
    const fieldsConfig = currentTab === 'fuel'
        ? [
            { id: 'date', label: 'Fecha y hora', type: 'datetime-local', val: rec?.date?.slice(0,16) || now },
            { id: 'odometer', label: 'Odómetro (km)', type: 'number', val: rec?.odometer || '' },
            { id: 'liters', label: 'Litros', type: 'number', step: '0.01', val: rec?.liters || '' },
            { id: 'pricePerL', label: 'Precio por litro ($)', type: 'number', step: '0.01', val: safePriceL }
          ]
        : [
            { id: 'date', label: 'Fecha y hora', type: 'datetime-local', val: rec?.date?.slice(0,16) || now },
            { id: 'odometer', label: 'Odómetro (km)', type: 'number', val: rec?.odometer || '' },
            { id: 'brand', label: 'Marca del aceite', type: 'text', val: rec?.brand || '' },
            { id: 'type', label: 'Tipo', type: 'select', opts: ['Sintético', 'Natural'], val: safeOilType },
            { id: 'viscosity', label: 'Viscosidad (ej: 10W40)', type: 'text', val: rec?.viscosity || '' },
            { id: 'price', label: 'Precio del aceite ($)', type: 'number', step: '0.01', val: rec?.price || '' }
          ];
    fieldsConfig.forEach(f => {
        const wrap = document.createElement('div');
        wrap.style.marginBottom = '0.75rem';
        wrap.innerHTML = `<label style="display:block; margin-bottom:0.3rem; font-weight:500;">${f.label}</label>`;
        if (f.type === 'select') {
            const sel = document.createElement('select');
            sel.id = f.id; sel.required = true; sel.style.cssText = 'width:100%; padding:0.5rem; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text);';
            f.opts.forEach(o => { const opt = document.createElement('option'); opt.value = o; opt.textContent = o; if(o===f.val) opt.selected=true; sel.appendChild(opt); });
            wrap.appendChild(sel);
        } else {
            const inp = document.createElement('input');
            inp.type = f.type; inp.id = f.id; inp.step = f.step || 'any'; inp.value = f.val; inp.required = true;
            inp.style.cssText = 'width:100%; padding:0.5rem; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text);';
            wrap.appendChild(inp);
        }
        $fields?.appendChild(wrap);
    });
    $modal?.showModal();
}

async function saveRecord(e) {
    e.preventDefault();
    if (!currentUser) return showLoginModal();
    const data = {};
    $fields?.querySelectorAll('input, select').forEach(el => data[el.id] = el.value);
    if (data.date) data.date = new Date(data.date).toISOString();
    
    showLoading();
    try {
        if (currentTab === 'fuel') {
            data.id = editingId || 'new';
            data.money = (parseFloat(data.liters)*parseFloat(data.pricePerL)).toFixed(2);
        } else {
            data.id = editingId || 'new';
            data.money = parseFloat(data.price).toFixed(2);
        }
        await window.db.saveRecord(currentTab === 'fuel' ? 'fuel' : 'maintenance', data);
        $modal?.close();
        await loadData(); // ✅ Solo recargar tras guardar explícitamente
    } catch (err) {
        alert('Error: ' + err.message);
        console.error(err);
    } finally { hideLoading(); }
}

async function deleteRecord(id) {
    if (!confirm('¿Eliminar este registro?')) return;
    if (!currentUser) return showLoginModal();
    showLoading();
    try {
        await window.db.deleteRecord(currentTab === 'fuel' ? 'fuel' : 'maintenance', id);
        await loadData(); // ✅ Solo recargar tras eliminar explícitamente
    } catch (err) {
        alert('Error: ' + err.message);
        console.error(err);
    } finally { hideLoading(); }
}

function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('es-CU', {
        timeZone: 'America/Havana',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
    }).replace(',', ' -');
}
function loadTheme() { document.body.className = localStorage.getItem('mototrack_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function toggleTheme() { document.body.className = document.body.className === 'dark' ? 'light' : 'dark'; localStorage.setItem('mototrack_theme', document.body.className); }
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
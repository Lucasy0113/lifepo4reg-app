let currentTab = 'dashboard';
let currentPage = 1;
const ITEMS_PER_PAGE = 10;
let editingId = null;
let currentUser = null;
let batteriesCache = [];
let readingsCache = [];
let selectedBatteryId = null;
let filterValue = 'all';

let $list, $pagination, $modal, $form, $fields, $themeBtn, $addBtn, $loadingOverlay, $submitBtn;
let $batteryFilter, $drawer, $drawerOverlay, $modalActions;

document.addEventListener('DOMContentLoaded', async () => {
  // Referencias DOM
  $list = document.getElementById('list-container');
  $pagination = document.getElementById('pagination');
  $modal = document.getElementById('modal');
  $form = document.getElementById('record-form');
  $fields = document.getElementById('form-fields');
  $themeBtn = document.getElementById('theme-toggle');
  $addBtn = document.getElementById('add-btn');
  $loadingOverlay = document.getElementById('loading-overlay');
  $submitBtn = document.getElementById('submit-btn');
  $batteryFilter = document.getElementById('battery-filter');
  $modalActions = document.querySelector('.modal-actions');
  
  // Drawer
  $drawer = document.getElementById('user-drawer');
  $drawerOverlay = document.getElementById('drawer-overlay');

  loadTheme();
  await waitForDb();
  setupAuthListener();
  setupUserMenu();
  
  // Bloqueo inicial: no renderizar nada hasta verificar auth
  $list.innerHTML = '<div class="loading-overlay active" style="position:relative;background:transparent;"><div class="loading-spinner"></div></div>';
  await checkAuth();
  setupEvents();
});

function showLoading() {
  if ($loadingOverlay) $loadingOverlay.classList.add('active');
  if ($submitBtn) { $submitBtn.disabled = true; $submitBtn.textContent = '⏳ Guardando...'; }
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

function getCubaNowISO() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Havana' }).replace(' ', 'T').slice(0, 16);
}

// 🔐 AUTENTICACIÓN CORREGIDA
async function checkAuth() {
  const saved = localStorage.getItem('lifepo4_user');
  let verified = false;

  if (saved && window.db) {
    try {
      const user = await window.db.getCurrentUser();
      if (user) {
        currentUser = user;
        verified = true;
        if($addBtn) $addBtn.style.display = 'flex';
        document.getElementById('user-menu-btn').style.display = 'flex';
        await loadData();
        renderAll();
      }
    } catch (e) { console.warn('Auth check error:', e); }
  }

  if (!verified) {
    currentUser = null;
    if($addBtn) $addBtn.style.display = 'none';
    document.getElementById('user-menu-btn').style.display = 'none';
    $list.innerHTML = '';
    $pagination.innerHTML = '';
    showLoginModal(); // Muestra login OBLIGATORIAMENTE
  }
}

function setupAuthListener() {
  if (!window.db || !window.db.supabase?.auth) return;
  window.db.supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      currentUser = session.user;
      localStorage.setItem('lifepo4_user', JSON.stringify({ id: currentUser.id, email: currentUser.email }));
      if ($modal?.open) $modal.close();
      document.getElementById('user-menu-btn').style.display = 'flex';
      if($addBtn) $addBtn.style.display = 'flex';
      loadData().then(() => renderAll()).catch(console.warn);
    } else if (event === 'SIGNED_OUT') {
      currentUser = null; batteriesCache = []; readingsCache = [];
      localStorage.removeItem('lifepo4_user');
      document.getElementById('user-menu-btn').style.display = 'none';
      if($addBtn) $addBtn.style.display = 'none';
      renderAll(); showLoginModal();
    }
  });
}

function setupUserMenu() {
  const $userMenuBtn = document.getElementById('user-menu-btn');
  const $closeDrawer = document.getElementById('close-drawer');
  const $passForm = document.getElementById('change-pass-form');
  const $passMsg = document.getElementById('pass-msg');
  const $logoutBtn = document.getElementById('logout-btn');

  if (!$userMenuBtn) return;
  
  // ✅ CORRECCIÓN: Usa IDs específicos en lugar de querySelector('.drawer')
  $userMenuBtn.addEventListener('click', () => {
    if (currentUser) {
      document.getElementById('user-email-display').textContent = currentUser.email;
      $passForm?.reset(); $passMsg.textContent = ''; $passMsg.className = 'msg';
      $drawer?.classList.add('open');
      $drawerOverlay?.classList.add('open');
    }
  });

  const closeDrawer = () => {
    $drawer?.classList.remove('open');
    $drawerOverlay?.classList.remove('open');
  };

  $closeDrawer?.addEventListener('click', closeDrawer);
  $drawerOverlay?.addEventListener('click', closeDrawer);

  $passForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cp = document.getElementById('current-pass').value;
    const np = document.getElementById('new-pass').value;
    const cnp = document.getElementById('confirm-pass').value;
    if (np !== cnp) { $passMsg.textContent = '❌ No coinciden'; $passMsg.className = 'msg error'; return; }
    if (cp === np) { $passMsg.textContent = '❌ Debe ser diferente'; $passMsg.className = 'msg error'; return; }
    showLoading();
    try {
      const { error: authError } = await window.db.supabase.auth.signInWithPassword({ email: currentUser.email, password: cp });
      if (authError) throw authError;
      const { error: updateError } = await window.db.supabase.auth.updateUser({ password: np });
      if (updateError) throw updateError;
      $passMsg.textContent = '✅ Actualizada'; $passMsg.className = 'msg success';
    } catch (err) { $passMsg.textContent = '❌ ' + (err.message || 'Error'); $passMsg.className = 'msg error'; }
    finally { hideLoading(); }
  });

  $logoutBtn?.addEventListener('click', async () => {
    if (confirm('¿Cerrar sesión?')) { await window.db.signOut(); closeDrawer(); }
  });
}

async function loadData() {
  if (!window.db) return renderAll();
  try {
    batteriesCache = await window.db.fetchBatteries();
    updateFilterDropdown();
    renderAll();
  } catch (e) { console.error('❌ Error cargando:', e); renderAll(); }
}

function updateFilterDropdown() {
  $batteryFilter.innerHTML = '<option value="all">Todas las baterías</option>';
  batteriesCache.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.name + (b.model ? ` (${b.model})` : '');
    $batteryFilter.appendChild(opt);
  });
  if (selectedBatteryId && batteriesCache.some(b=>b.id===selectedBatteryId)) $batteryFilter.value = selectedBatteryId;
}

function setupEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.target.dataset.tab;
      if (tab === 'dashboard') { selectedBatteryId = null; currentTab = 'dashboard'; currentPage=1; }
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      e.target.classList.add('active');
      renderAll();
    });
  });

  $batteryFilter.addEventListener('change', (e) => {
    filterValue = e.target.value;
    selectedBatteryId = filterValue === 'all' ? null : filterValue;
    currentTab = 'dashboard'; currentPage = 1;
    document.querySelector('.tab-btn[data-tab="dashboard"]').classList.add('active');
    document.querySelector('.tab-btn[data-tab="readings"]').classList.remove('active');
    document.querySelector('.tab-btn[data-tab="readings"]').style.display = 'none';
    renderAll();
  });

  $addBtn?.addEventListener('click', () => currentUser ? openBatteryModal() : showLoginModal());
  document.getElementById('cancel-btn')?.addEventListener('click', () => { $modal?.close(); editingId = null; $form?.reset(); });
  $modal?.addEventListener('close', () => { editingId = null; $form?.reset(); });
  $form?.addEventListener('submit', saveRecord);
  
  $list?.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target || !currentUser) return;
    const card = target.closest('.battery-card, .reading-card');
    const id = card?.dataset.id;
    if (target.classList.contains('btn-readings')) openReadingsView(id);
    if (target.classList.contains('btn-edit')) openBatteryModal(id);
    if (target.classList.contains('btn-delete')) deleteBattery(id);
    if (target.classList.contains('reading-edit')) openReadingModal(id);
    if (target.classList.contains('reading-delete')) deleteReading(id);
  });
  
  $themeBtn?.addEventListener('click', toggleTheme);
}

function renderAll() {
  $list.innerHTML = '';
  $pagination.innerHTML = '';
  if (!currentUser) return;
  if (currentTab === 'dashboard') renderDashboard();
  else renderReadingsList();
}

function renderDashboard() {
  const filtered = filterValue === 'all' ? batteriesCache : batteriesCache.filter(b=>b.id===filterValue);
  if (!filtered.length) { $list.innerHTML = '<div class="empty-state">No hay baterías. Toca + para agregar una.</div>'; return; }
  filtered.forEach(b => {
    const readings = readingsCache.filter(r => r.battery_id === b.id);
    $list.innerHTML += renderBatteryCard(b, readings);
  });
}

// ... [MANTÉN TU FUNCIÓN renderBatteryCard, renderCells, renderStats IGUAL QUE ANTES] ...
// Para ahorrar espacio, asumo que estas funciones ya están en tu app.js y funcionan bien visualmente.

function openReadingsView(batId) {
  selectedBatteryId = batId;
  currentTab = 'readings';
  currentPage = 1;
  document.querySelector('.tab-btn[data-tab="readings"]').style.display = 'block';
  document.querySelector('.tab-btn[data-tab="readings"]').classList.add('active');
  document.querySelector('.tab-btn[data-tab="dashboard"]').classList.remove('active');
  loadDataReadings().then(renderAll);
}

async function loadDataReadings() {
  if(!selectedBatteryId) return;
  readingsCache = await window.db.fetchReadings(selectedBatteryId);
}

function renderReadingsList() {
  const bat = batteriesCache.find(b=>b.id===selectedBatteryId);
  if (!bat) return $list.innerHTML = '<div class="empty-state">Batería no encontrada.</div>';
  const sorted = [...readingsCache].sort((a,b)=>new Date(b.recorded_at)-new Date(a.recorded_at));
  const pageData = sorted.slice((currentPage-1)*ITEMS_PER_PAGE, currentPage*ITEMS_PER_PAGE);
  const totalPages = Math.ceil(sorted.length/ITEMS_PER_PAGE);

  let html = `<div class="reading-header">🔋 ${bat.name} ${bat.model?`(${bat.model})`:''}</div>
              <button onclick="currentTab='dashboard'; selectedBatteryId=null; document.querySelector('.tab-btn[data-tab=dashboard]').click(); renderAll();" style="margin-bottom:1rem; padding:0.4rem 0.8rem; background:var(--card); border:1px solid var(--border); border-radius:6px; cursor:pointer;">← Volver</button>`;
  
  pageData.forEach(r => {
    html += `<article class="battery-card reading-card" data-id="${r.id}">
      <div style="text-align:center; font-size:0.85rem; color:var(--text-sec); margin-bottom:0.5rem;">${formatDate(r.recorded_at)}</div>
      ${renderCellsGrid(r.voltages, 'latest')}
      ${renderStats(r.voltages)}
      <div class="charger-info">Cargador V: ${parseChargerVal(r.charger_v)} | Cargador A: ${parseChargerVal(r.charger_a)}</div>
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem;">
        <button class="btn-readings reading-edit" style="flex:1;">Editar</button>
        <button class="btn-delete reading-delete" style="flex:1;">Eliminar</button>
      </div>
    </article>`;
  });

  if(!pageData.length) html += '<div class="empty-state">Sin lecturas registradas.</div>';
  html += `<button onclick="openReadingModal()" style="margin-top:1rem; width:100%; padding:0.7rem; background:var(--primary); color:white; border:none; border-radius:6px; cursor:pointer;">+ Nueva Lectura</button>`;
  html += renderPaginationControls(totalPages);
  $list.innerHTML = html;
}

function renderCellsGrid(voltages, type) {
  if (!voltages) return '<div class="empty-state">N/D</div>';
  const vals = voltages.map(v => parseFloat(v));
  const max = Math.max(...vals), min = Math.min(...vals);
  let html = `<div class="cell-grid">`;
  vals.forEach((v, i) => {
    let cls = '';
    if(type==='latest'){ if(v===max) cls='cell-high'; else if(v===min) cls='cell-low'; }
    html += `<div class="cell-box ${cls}"><div class="cell-label">Cel ${i+1}</div><div class="cell-value">${v.toFixed(3)}V</div></div>`;
  });
  html += `</div>`; return html;
}

function renderPaginationControls(totalPages) {
  if(totalPages<=1) return '';
  let html = '<div class="pagination">';
  for(let i=1; i<=totalPages; i++) {
    html += `<button onclick="currentPage=${i}; renderAll();" ${i===currentPage?'style="font-weight:bold;background:var(--primary);color:white;"':''}>${i}</button>`;
  }
  html += '</div>'; return html;
}

// 🔧 MODALES CORREGIDOS
function openBatteryModal(id=null) {
  // ✅ CORRECCIÓN: Mostrar botones que Login ocultó
  if ($modalActions) $modalActions.style.display = 'flex';
  
  editingId = id;
  const bat = id ? batteriesCache.find(b=>b.id===id) : null;
  document.getElementById('modal-title').textContent = id ? 'Editar Batería' : 'Nueva Batería';
  $fields.innerHTML = '';
  const now = getCubaNowISO();
  const config = [
    {id:'created_at', label:'Fecha/Hora Compra', type:'datetime-local', val: bat?.created_at?.slice(0,16) || now},
    {id:'name', label:'Nombre', type:'text', val: bat?.name || ''},
    {id:'model', label:'Modelo (Opcional)', type:'text', val: bat?.model || ''},
    {id:'total_voltage', label:'Voltaje Total (V)', type:'number', step:'0.01', val: bat?.total_voltage || ''},
    {id:'amperage', label:'Capacidad (Ah)', type:'number', step:'0.01', val: bat?.amperage || ''},
    {id:'cell_count', label:'Cantidad de Celdas', type:'number', step:'1', min:'1', val: bat?.cell_count || ''}
  ];
  config.forEach(f => appendField(f, 'text'));
  if(bat?.cell_count) appendCellFields(bat.cell_count, bat.voltages_initial || []);
  
  $modal?.showModal();

  $fields.querySelector('#cell_count')?.addEventListener('input', (e) => {
    const count = parseInt(e.target.value) || 0;
    const container = document.getElementById('cells-container');
    if(container) container.innerHTML = '';
    if(count>0) appendCellFields(count, []);
  });
}

function appendField(f) {
  const wrap = document.createElement('div'); wrap.style.marginBottom='0.6rem';
  wrap.innerHTML = `<label style="display:block; margin-bottom:0.2rem; font-size:0.9rem; font-weight:500;">${f.label}</label>
    <input type="${f.type}" id="${f.id}" value="${f.val}" ${f.step?`step="${f.step}"`:''} ${f.min?`min="${f.min}"`:''} required>`;
  $fields?.appendChild(wrap);
}

function appendCellFields(count, initialVals=[]) {
  let html = '<div id="cells-container" style="margin-top:0.5rem; border-top:1px solid var(--border); padding-top:0.5rem;">';
  html += '<label style="display:block; margin-bottom:0.3rem; font-weight:500;">Voltaje Inicial por Celda (2.500 - 3.650 V)</label>';
  for(let i=0; i<count; i++) {
    html += `<input type="number" step="0.001" id="cell_${i}" placeholder="Cel ${i+1} (V)" value="${initialVals[i]||''}" required style="margin-bottom:0.3rem;">`;
  }
  html += '</div>';
  $fields.insertAdjacentHTML('beforeend', html);
}

function openReadingModal(id=null) {
  if ($modalActions) $modalActions.style.display = 'flex'; // ✅ Mostrar botones
  editingId = id;
  const bat = batteriesCache.find(b=>b.id===selectedBatteryId);
  const read = id ? readingsCache.find(r=>r.id===id) : null;
  document.getElementById('modal-title').textContent = id ? 'Editar Lectura' : 'Nueva Lectura';
  $fields.innerHTML = '';
  const now = getCubaNowISO();
  appendField({id:'recorded_at', label:'Fecha/Hora Lectura', type:'datetime-local', val: read?.recorded_at?.slice(0,16) || now});
  
  let html = `<div id="cells-container"><label style="display:block; margin-bottom:0.3rem; font-weight:500;">Voltaje por Celda (2.500 - 3.650 V)</label>`;
  for(let i=0; i<bat.cell_count; i++) {
    const val = read?.voltages ? (read.voltages[i]||'') : '';
    html += `<input type="number" step="0.001" id="cell_${i}" placeholder="Cel ${i+1} (V)" value="${val}" required style="margin-bottom:0.3rem;">`;
  }
  html += `</div>
    <div style="margin-top:0.5rem;">
      <label style="display:block; margin-bottom:0.2rem; font-weight:500;">Cargador V</label>
      <input type="text" id="charger_v" value="${read?.charger_v || 'MPPT'}" style="margin-bottom:0.5rem;">
      <label style="display:block; margin-bottom:0.2rem; font-weight:500;">Cargador A</label>
      <input type="text" id="charger_a" value="${read?.charger_a || 'MPPT'}">
    </div>`;
  $fields.insertAdjacentHTML('beforeend', html);
  $modal?.showModal();
}

async function saveRecord(e) {
  e.preventDefault();
  if(!currentUser) return showLoginModal();
  showLoading();
  try {
    if(currentTab==='dashboard') {
      const data = { id: editingId || 'new', created_at: new Date(document.getElementById('created_at').value).toISOString() };
      ['name','model','total_voltage','amperage','cell_count'].forEach(k => data[k] = document.getElementById(k).value);
      data.cell_count = parseInt(data.cell_count);
      const voltages = [];
      for(let i=0; i<data.cell_count; i++) {
        const v = parseFloat(document.getElementById(`cell_${i}`).value);
        if(isNaN(v) || v<2.5 || v>3.65) throw new Error(`Cel ${i+1} fuera de rango (2.500-3.650V)`);
        voltages.push(v);
      }
      data.voltages_initial = voltages; 
      await window.db.saveBattery(data);
      await window.db.saveReading({ battery_id: editingId || 'new', recorded_at: data.created_at, voltages, charger_v: 'MPPT', charger_a: 'MPPT' });
    } else {
      const bat = batteriesCache.find(b=>b.id===selectedBatteryId);
      const voltages = [];
      for(let i=0; i<bat.cell_count; i++) {
        const v = parseFloat(document.getElementById(`cell_${i}`).value);
        if(isNaN(v) || v<2.5 || v>3.65) throw new Error(`Cel ${i+1} fuera de rango`);
        voltages.push(v);
      }
      const data = { id: editingId || 'new', battery_id: selectedBatteryId, recorded_at: new Date(document.getElementById('recorded_at').value).toISOString(), voltages, charger_v: document.getElementById('charger_v').value || 'MPPT', charger_a: document.getElementById('charger_a').value || 'MPPT' };
      await window.db.saveReading(data);
    }
    $modal?.close(); await loadData(); if(currentTab==='readings') await loadDataReadings(); renderAll();
  } catch(err) { alert('Error: '+err.message); } finally { hideLoading(); }
}

async function deleteBattery(id) {
  if(!confirm('¿Eliminar esta batería y todas sus lecturas?')) return;
  showLoading();
  try { await window.db.deleteRecord('batteries', id); await loadData(); renderAll(); } catch(err){ alert(err.message); } finally { hideLoading(); }
}

async function deleteReading(id) {
  if(!confirm('¿Eliminar esta lectura?')) return;
  showLoading();
  try { await window.db.deleteRecord('cell_readings', id); await loadDataReadings(); renderAll(); } catch(err){ alert(err.message); } finally { hideLoading(); }
}

function formatDate(iso) { if (!iso) return 'N/D'; return new Date(iso).toLocaleString('es-CU', { timeZone: 'America/Havana', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).replace(',', ' -'); }
function parseChargerVal(val) { if (!val || val === 'MPPT') return 'MPPT'; const n = parseFloat(val); return isNaN(n) ? 'MPPT' : n.toFixed(2); }
function loadTheme() { document.body.className = localStorage.getItem('lifepo4_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function toggleTheme() { document.body.className = document.body.className === 'dark' ? 'light' : 'dark'; localStorage.setItem('lifepo4_theme', document.body.className); }
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));

function showLoginModal() { 
  if ($modalActions) $modalActions.style.display = 'none'; // Ocultar botones en login
  document.getElementById('modal-title').textContent = 'Iniciar Sesión';
  $fields.innerHTML = `<div style="margin-bottom:1rem"><label>Email</label><input type="email" id="auth-email" required></div>
    <div style="margin-bottom:1rem"><label>Contraseña</label><input type="password" id="auth-pass" minlength="6" required></div>
    <div style="display:flex;gap:0.5rem"><button type="button" id="auth-login" style="flex:1;padding:0.6rem;background:#dbeafe;color:#1d4ed8;border:none;border-radius:6px;">Entrar</button>
    <button type="button" id="auth-signup" style="flex:1;padding:0.6rem;background:#fee2e2;color:#b91c1c;border:none;border-radius:6px;">Registrarse</button></div>
    <p id="auth-error" style="color:#ef4444;font-size:0.85rem;margin-top:0.5rem;display:none;"></p>`;
  $modal?.showModal();
  document.getElementById('auth-login').onclick = async () => handleAuth('login');
  document.getElementById('auth-signup').onclick = async () => handleAuth('signup');
}
async function handleAuth(type) {
  const e = document.getElementById('auth-email').value, p = document.getElementById('auth-pass').value;
  const err = document.getElementById('auth-error');
  if(!e||!p) { err.textContent='Completa los campos'; err.style.display='block'; return; }
  showLoading(); err.style.display='none';
  try {
    const res = type==='login' ? await window.db.signIn(e,p) : await window.db.signUp(e,p);
    if(res?.data?.user) { $modal.close(); } else { err.textContent=res?.error?.message; err.style.display='block'; }
  } catch(ex) { err.textContent=ex.message; err.style.display='block'; }
  finally { hideLoading(); }
}
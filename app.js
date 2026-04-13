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
  $drawer = document.getElementById('user-drawer');
  $drawerOverlay = document.getElementById('drawer-overlay');

  // 🔒 RESET INICIAL
  if($modal?.open) $modal.close();
  $drawer?.classList.remove('open');
  $drawerOverlay?.classList.remove('open');
  hideLoading();
  
  loadTheme();
  await waitForDb();
  setupAuthListener();
  setupUserMenu();
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

// ✅ FUNCIONES AUXILIARES (ANTES FALTABAN)
function getAge(date) {
  if (!date) return 'N/D';
  const start = new Date(date);
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Havana' }));
  let y = now.getFullYear() - start.getFullYear();
  let m = now.getMonth() - start.getMonth();
  let d = now.getDate() - start.getDate();
  if (d < 0) { m--; d += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
  if (m < 0) { y--; m += 12; }
  return `${y}a ${m}m ${d}d`;
}

function parseChargerVal(val) { if (!val || val === 'MPPT') return 'MPPT'; const n = parseFloat(val); return isNaN(n) ? 'MPPT' : n.toFixed(2); }
function formatDate(iso) { if (!iso) return 'N/D'; return new Date(iso).toLocaleString('es-CU', { timeZone: 'America/Havana', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).replace(',', ' -'); }

// ✅ RENDERIZADO DE CELDAS Y ESTADÍSTICAS
function renderCells(voltages, type) {
  if (!voltages) return '<div class="empty-state">N/D</div>';
  const vals = voltages.map(v => parseFloat(v));
  const max = Math.max(...vals), min = Math.min(...vals);
  let html = `<div class="cell-grid">`;
  vals.forEach((v, i) => {
    let cls = '';
    if (type === 'peak' || type === 'latest') {
      if (v === max) cls = 'cell-high';
      else if (v === min) cls = 'cell-low';
    } else if (type === 'diff') {
      // Lógica invertida para Valor Estimado
      if (v === max) cls = 'cell-low'; // mayor diferencia = verde
      else if (v === min) cls = 'cell-high'; // menor diferencia = rojo
    }
    html += `<div class="cell-box ${cls}"><div class="cell-label">Cel ${i+1}</div><div class="cell-value">${v.toFixed(3)}V</div></div>`;
  });
  html += `</div>`; return html;
}

function renderStats(voltages) {
  if (!voltages) return `<div class="stats-row"><div class="stats-item">Máx: N/D</div><div class="stats-item">Mín: N/D</div><div class="stats-item">Prom: N/D</div><div class="stats-item">Δ: N/D</div></div>`;
  const vals = voltages.map(v => parseFloat(v));
  const max = Math.max(...vals), min = Math.min(...vals);
  const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
  return `<div class="stats-row">
    <div class="stats-item">Máx: <span>${max.toFixed(3)}V</span></div>
    <div class="stats-item">Mín: <span>${min.toFixed(3)}V</span></div>
    <div class="stats-item">Prom: <span>${avg.toFixed(3)}V</span></div>
    <div class="stats-item">Δ: <span>${(max-min).toFixed(3)}V</span></div>
  </div>`;
}

// ✅ FUNCIÓN PRINCIPAL QUE FALTABA
function renderBatteryCard(b, readings) {
  const age = getAge(b.created_at);
  // Calcular picos históricos
  const peakCells = readings.length ? readings.map(r => r.voltages).reduce((acc, curr) => acc.map((v,i) => Math.max(v, parseFloat(curr[i])||0)), Array(b.cell_count).fill(0)) : null;
  const latest = readings[0] || null;

  let html = `<article class="battery-card" data-id="${b.id}">
    <h3>${b.name} ${b.model?`(${b.model})`:''}</h3>
    <p style="color:var(--text-sec); font-size:0.9rem;">${b.total_voltage}V / ${b.amperage}Ah • Vida: ${age}</p>
    
    <div class="section-title">Valor Tope Histórico</div>
    ${renderCells(peakCells, 'peak')}${renderStats(peakCells)}
    <div class="charger-info">Cargador V: ${latest?.charger_v || 'N/D'} | Cargador A: ${latest?.charger_a || 'N/D'}</div>
    <div class="separator-blue"></div>

    <div class="section-title">Valor Último</div>
    ${renderCells(latest?.voltages, 'latest')}${renderStats(latest?.voltages)}
    <div class="charger-info">Cargador V: ${parseChargerVal(latest?.charger_v)} | Cargador A: ${parseChargerVal(latest?.charger_a)}</div>
    <div class="separator-gray"></div>

    <div class="section-title">Valor Estimado (Δ Histórico vs Último)</div>`;

  if (peakCells && latest) {
    const diffs = peakCells.map((v,i) => v - parseFloat(latest.voltages[i]||0));
    html += renderCells(diffs, 'diff');
    const maxD = Math.max(...diffs), minD = Math.min(...diffs);
    const avgD = diffs.reduce((a,b)=>a+b,0)/diffs.length;
    html += `<div class="stats-row">
      <div class="stats-item">Δ Máx: <span>${maxD.toFixed(3)}V</span></div>
      <div class="stats-item">Δ Mín: <span>${minD.toFixed(3)}V</span></div>
      <div class="stats-item">Δ Prom: <span>${avgD.toFixed(3)}V</span></div>
      <div class="stats-item">Δ Total: <span>${(maxD-minD).toFixed(3)}V</span></div>
    </div>`;
  } else {
    html += `<div class="empty-state">N/D</div>`;
  }

  html += `<div class="card-actions">
    <button class="btn-readings">📊 Lecturas</button>
    <button class="btn-edit">✏️ Editar</button>
    <button class="btn-delete">🗑️ Eliminar</button>
  </div></article>`;
  return html;
}

// ✅ AUTH
async function checkAuth() {
  const saved = localStorage.getItem('lifepo4_user');
  let verified = false;
  if (saved && window.db) {
    try {
      const user = await window.db.getCurrentUser();
      if (user) { currentUser = user; verified = true; if($addBtn) $addBtn.style.display = 'flex'; document.getElementById('user-menu-btn').style.display = 'flex'; await loadData(); renderAll(); }
    } catch (e) { console.warn('Auth check error:', e); }
  }
  if (!verified) {
    currentUser = null; if($addBtn) $addBtn.style.display = 'none';
    document.getElementById('user-menu-btn').style.display = 'none';
    $list.innerHTML = '<div class="empty-state">Autenticación requerida</div>';
    $pagination.innerHTML = ''; showLoginModal();
  }
}

function setupAuthListener() {
  if (!window.db || !window.db.supabase?.auth) return;
  window.db.supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      currentUser = session.user; localStorage.setItem('lifepo4_user', JSON.stringify({ id: currentUser.id, email: currentUser.email }));
      hideLoading(); if ($modal?.open) $modal.close(); document.getElementById('user-menu-btn').style.display = 'flex'; if($addBtn) $addBtn.style.display = 'flex'; loadData().then(() => renderAll()).catch(console.warn);
    } else if (event === 'SIGNED_OUT') {
      currentUser = null; batteriesCache = []; readingsCache = []; localStorage.removeItem('lifepo4_user'); hideLoading();
      document.getElementById('user-menu-btn').style.display = 'none'; if($addBtn) $addBtn.style.display = 'none'; renderAll(); showLoginModal();
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
  $userMenuBtn.addEventListener('click', () => {
    if (currentUser) { document.getElementById('user-email-display').textContent = currentUser.email; $passForm?.reset(); $passMsg.textContent = ''; $passMsg.className = 'msg'; $drawer?.classList.add('open'); $drawerOverlay?.classList.add('open'); }
  });
  const closeDrawer = () => { $drawer?.classList.remove('open'); $drawerOverlay?.classList.remove('open'); };
  $closeDrawer?.addEventListener('click', closeDrawer); $drawerOverlay?.addEventListener('click', closeDrawer);
  $passForm?.addEventListener('submit', async (e) => {
    e.preventDefault(); const cp = document.getElementById('current-pass').value, np = document.getElementById('new-pass').value, cnp = document.getElementById('confirm-pass').value;
    if (np !== cnp) { $passMsg.textContent = '❌ No coinciden'; $passMsg.className = 'msg error'; return; }
    if (cp === np) { $passMsg.textContent = '❌ Debe ser diferente'; $passMsg.className = 'msg error'; return; }
    showLoading(); try { const { error: authError } = await window.db.supabase.auth.signInWithPassword({ email: currentUser.email, password: cp }); if (authError) throw authError; const { error: updateError } = await window.db.supabase.auth.updateUser({ password: np }); if (updateError) throw updateError; $passMsg.textContent = '✅ Actualizada'; $passMsg.className = 'msg success'; } catch (err) { $passMsg.textContent = '❌ ' + (err.message || 'Error'); $passMsg.className = 'msg error'; } finally { hideLoading(); }
  });
  $logoutBtn?.addEventListener('click', async () => { if (confirm('¿Cerrar sesión?')) { await window.db.signOut(); closeDrawer(); } });
}

async function loadData() {
  if (!window.db) return renderAll();
  try {
    batteriesCache = await window.db.fetchBatteries();
    // Cargar lecturas de todas las baterías visibles para el dashboard
    readingsCache = [];
    for (const b of batteriesCache) readingsCache.push(...(await window.db.fetchReadings(b.id)));
    updateFilterDropdown(); renderAll();
  } catch (e) { console.error('❌ Error cargando:', e); renderAll(); }
}
function updateFilterDropdown() {
  $batteryFilter.innerHTML = '<option value="all">Todas las baterías</option>';
  batteriesCache.forEach(b => { const opt = document.createElement('option'); opt.value = b.id; opt.textContent = b.name + (b.model ? ` (${b.model})` : ''); $batteryFilter.appendChild(opt); });
  if (selectedBatteryId && batteriesCache.some(b=>b.id===selectedBatteryId)) $batteryFilter.value = selectedBatteryId;
}

function setupEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn => { btn.addEventListener('click', (e) => { const tab = e.target.dataset.tab; if (tab === 'dashboard') { selectedBatteryId = null; currentTab = 'dashboard'; currentPage=1; } document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active')); e.target.classList.add('active'); renderAll(); }); });
  $batteryFilter.addEventListener('change', (e) => { filterValue = e.target.value; selectedBatteryId = filterValue === 'all' ? null : filterValue; currentTab = 'dashboard'; currentPage = 1; document.querySelector('.tab-btn[data-tab="dashboard"]').classList.add('active'); document.querySelector('.tab-btn[data-tab="readings"]').classList.remove('active'); document.querySelector('.tab-btn[data-tab="readings"]').style.display = 'none'; renderAll(); });
  $addBtn?.addEventListener('click', () => currentUser ? openBatteryModal() : showLoginModal());
  document.getElementById('cancel-btn')?.addEventListener('click', () => { $modal?.close(); editingId = null; $form?.reset(); });
  $modal?.addEventListener('close', () => { editingId = null; $form?.reset(); });
  $form?.addEventListener('submit', saveRecord);
  $list?.addEventListener('click', (e) => { const target = e.target.closest('button'); if (!target || !currentUser) return; const card = target.closest('.battery-card, .reading-card'); const id = card?.dataset.id; if (target.classList.contains('btn-readings')) openReadingsView(id); if (target.classList.contains('btn-edit')) openBatteryModal(id); if (target.classList.contains('btn-delete')) deleteBattery(id); if (target.classList.contains('reading-edit')) openReadingModal(id); if (target.classList.contains('reading-delete')) deleteReading(id); });
  $themeBtn?.addEventListener('click', toggleTheme);
}

function renderAll() { $list.innerHTML = ''; $pagination.innerHTML = ''; if (!currentUser) return; if (currentTab === 'dashboard') renderDashboard(); else renderReadingsList(); }
function renderDashboard() {
  const filtered = filterValue === 'all' ? batteriesCache : batteriesCache.filter(b=>b.id===filterValue);
  if (!filtered.length) { $list.innerHTML = '<div class="empty-state">No hay baterías. Toca + para agregar una.</div>'; return; }
  filtered.forEach(b => { const readings = readingsCache.filter(r => r.battery_id === b.id); $list.innerHTML += renderBatteryCard(b, readings); });
}

function openReadingsView(batId) { selectedBatteryId = batId; currentTab = 'readings'; currentPage = 1; document.querySelector('.tab-btn[data-tab="readings"]').style.display = 'block'; document.querySelector('.tab-btn[data-tab="readings"]').classList.add('active'); document.querySelector('.tab-btn[data-tab="dashboard"]').classList.remove('active'); loadDataReadings().then(renderAll); }
async function loadDataReadings() { if(!selectedBatteryId) return; readingsCache = await window.db.fetchReadings(selectedBatteryId); }

function renderReadingsList() {
  const bat = batteriesCache.find(b=>b.id===selectedBatteryId);
  if (!bat) return $list.innerHTML = '<div class="empty-state">Batería no encontrada.</div>';
  const sorted = [...readingsCache].sort((a,b)=>new Date(b.recorded_at)-new Date(a.recorded_at));
  const pageData = sorted.slice((currentPage-1)*ITEMS_PER_PAGE, currentPage*ITEMS_PER_PAGE);
  const totalPages = Math.ceil(sorted.length/ITEMS_PER_PAGE);
  let html = `<div class="reading-header">🔋 ${bat.name} ${bat.model?`(${bat.model})`:''}</div>
              <button onclick="currentTab='dashboard'; selectedBatteryId=null; document.querySelector('.tab-btn[data-tab=dashboard]').click(); renderAll();" style="margin-bottom:1rem; padding:0.4rem 0.8rem; background:var(--card); border:1px solid var(--border); border-radius:6px; cursor:pointer;">← Volver</button>`;
  pageData.forEach(r => { html += `<article class="battery-card reading-card" data-id="${r.id}"><div style="text-align:center; font-size:0.85rem; color:var(--text-sec); margin-bottom:0.5rem;">${formatDate(r.recorded_at)}</div>${renderCells(r.voltages, 'latest')} ${renderStats(r.voltages)}<div class="charger-info">Cargador V: ${parseChargerVal(r.charger_v)} | Cargador A: ${parseChargerVal(r.charger_a)}</div><div style="margin-top:0.5rem; display:flex; gap:0.5rem;"><button class="btn-readings reading-edit" style="flex:1;">Editar</button><button class="btn-delete reading-delete" style="flex:1;">Eliminar</button></div></article>`; });
  if(!pageData.length) html += '<div class="empty-state">Sin lecturas registradas.</div>';
  html += `<button onclick="openReadingModal()" style="margin-top:1rem; width:100%; padding:0.7rem; background:var(--primary); color:white; border:none; border-radius:6px; cursor:pointer;">+ Nueva Lectura</button>`;
  html += renderPaginationControls(totalPages); $list.innerHTML = html;
}

function renderPaginationControls(totalPages) { if(totalPages<=1) return ''; let html = '<div class="pagination">'; for(let i=1; i<=totalPages; i++) html += `<button onclick="currentPage=${i}; renderAll();" ${i===currentPage?'style="font-weight:bold;background:var(--primary);color:white;"':''}>${i}</button>`; html += '</div>'; return html; }

// ✅ MODALES
function openBatteryModal(id=null) {
  if ($modalActions) $modalActions.style.display = 'flex'; editingId = id; const bat = id ? batteriesCache.find(b=>b.id===id) : null;
  document.getElementById('modal-title').textContent = id ? 'Editar Batería' : 'Nueva Batería'; $fields.innerHTML = ''; const now = getCubaNowISO();
  const config = [
    {id:'created_at', label:'Fecha/Hora Compra', type:'datetime-local', val: bat?.created_at?.slice(0,16) || now},
    {id:'name', label:'Nombre', type:'text', val: bat?.name || ''},
    {id:'model', label:'Modelo (Opcional)', type:'text', val: bat?.model || ''},
    {id:'total_voltage', label:'Voltaje Total (V)', type:'number', step:'0.01', val: bat?.total_voltage || ''},
    {id:'amperage', label:'Capacidad (Ah)', type:'number', step:'0.01', val: bat?.amperage || ''},
    {id:'cell_count', label:'Cantidad de Celdas', type:'number', step:'1', min:'1', val: bat?.cell_count || ''}
  ];
  config.forEach(f => appendField(f)); if(bat?.cell_count) appendCellFields(bat.cell_count, []); $modal?.showModal();
  $fields.querySelector('#cell_count')?.addEventListener('input', (e) => { const count = parseInt(e.target.value) || 0; document.getElementById('cells-container')?.remove(); if(count>0) appendCellFields(count, []); });
}
function appendField(f) { const wrap = document.createElement('div'); wrap.style.marginBottom='0.6rem'; wrap.innerHTML = `<label style="display:block; margin-bottom:0.2rem; font-size:0.9rem; font-weight:500;">${f.label}</label><input type="${f.type}" id="${f.id}" value="${f.val}" ${f.step?`step="${f.step}"`:''} ${f.min?`min="${f.min}"`:''} required>`; $fields?.appendChild(wrap); }
function appendCellFields(count, initialVals=[]) { let html = '<div id="cells-container" style="margin-top:0.5rem; border-top:1px solid var(--border); padding-top:0.5rem;">'; html += '<label style="display:block; margin-bottom:0.3rem; font-weight:500;">Voltaje Inicial por Celda (2.500 - 3.650 V)</label>'; for(let i=0; i<count; i++) html += `<input type="number" step="0.001" id="cell_${i}" placeholder="Cel ${i+1} (V)" value="${initialVals[i]||''}" required style="margin-bottom:0.3rem;">`; html += '</div>'; $fields.insertAdjacentHTML('beforeend', html); }

function openReadingModal(id=null) {
  if ($modalActions) $modalActions.style.display = 'flex'; editingId = id; const bat = batteriesCache.find(b=>b.id===selectedBatteryId); const read = id ? readingsCache.find(r=>r.id===id) : null;
  document.getElementById('modal-title').textContent = id ? 'Editar Lectura' : 'Nueva Lectura'; $fields.innerHTML = ''; const now = getCubaNowISO();
  appendField({id:'recorded_at', label:'Fecha/Hora Lectura', type:'datetime-local', val: read?.recorded_at?.slice(0,16) || now});
  let html = `<div id="cells-container"><label style="display:block; margin-bottom:0.3rem; font-weight:500;">Voltaje por Celda (2.500 - 3.650 V)</label>`;
  for(let i=0; i<bat.cell_count; i++) { const val = read?.voltages ? (read.voltages[i]||'') : ''; html += `<input type="number" step="0.001" id="cell_${i}" placeholder="Cel ${i+1} (V)" value="${val}" required style="margin-bottom:0.3rem;">`; }
  html += `</div><div style="margin-top:0.5rem;"><label style="display:block; margin-bottom:0.2rem; font-weight:500;">Cargador V</label><input type="text" id="charger_v" value="${read?.charger_v || 'MPPT'}" style="margin-bottom:0.5rem;"><label style="display:block; margin-bottom:0.2rem; font-weight:500;">Cargador A</label><input type="text" id="charger_a" value="${read?.charger_a || 'MPPT'}"></div>`;
  $fields.insertAdjacentHTML('beforeend', html); $modal?.showModal();
}

// ✅ GUARDADO
async function saveRecord(e) {
  e.preventDefault(); if(!currentUser) return showLoginModal(); showLoading();
  try {
    if(currentTab==='dashboard') {
      const newId = editingId || crypto.randomUUID();
      const data = { id: newId, created_at: new Date(document.getElementById('created_at').value).toISOString() };
      ['name','model','total_voltage','amperage','cell_count'].forEach(k => data[k] = document.getElementById(k).value);
      data.cell_count = parseInt(data.cell_count); const voltages = [];
      for(let i=0; i<data.cell_count; i++) { const v = parseFloat(document.getElementById(`cell_${i}`).value); if(isNaN(v) || v<2.5 || v>3.65) throw new Error(`Cel ${i+1} fuera de rango (2.500-3.650V)`); voltages.push(v); }
      await window.db.saveBattery(data); await window.db.saveReading({ battery_id: newId, recorded_at: data.created_at, voltages, charger_v: 'MPPT', charger_a: 'MPPT' });
    } else {
      const bat = batteriesCache.find(b=>b.id===selectedBatteryId); const voltages = []; for(let i=0; i<bat.cell_count; i++) { const v = parseFloat(document.getElementById(`cell_${i}`).value); if(isNaN(v) || v<2.5 || v>3.65) throw new Error(`Cel ${i+1} fuera de rango`); voltages.push(v); }
      const newId = editingId || crypto.randomUUID(); const data = { id: newId, battery_id: selectedBatteryId, recorded_at: new Date(document.getElementById('recorded_at').value).toISOString(), voltages, charger_v: document.getElementById('charger_v').value || 'MPPT', charger_a: document.getElementById('charger_a').value || 'MPPT' };
      await window.db.saveReading(data);
    }
    $modal?.close(); await loadData(); if(currentTab==='readings') await loadDataReadings(); renderAll();
  } catch(err) { alert('Error: '+err.message); } finally { hideLoading(); }
}

async function deleteBattery(id) { if(!confirm('¿Eliminar batería y lecturas?')) return; showLoading(); try { await window.db.deleteRecord('batteries', id); await loadData(); renderAll(); } catch(err){ alert(err.message); } finally { hideLoading(); } }
async function deleteReading(id) { if(!confirm('¿Eliminar lectura?')) return; showLoading(); try { await window.db.deleteRecord('cell_readings', id); await loadDataReadings(); renderAll(); } catch(err){ alert(err.message); } finally { hideLoading(); } }

function loadTheme() { document.body.className = localStorage.getItem('lifepo4_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function toggleTheme() { document.body.className = document.body.className === 'dark' ? 'light' : 'dark'; localStorage.setItem('lifepo4_theme', document.body.className); }
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));

function showLoginModal() { 
  if ($modalActions) $modalActions.style.display = 'none';
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
  try { const res = type==='login' ? await window.db.signIn(e,p) : await window.db.signUp(e,p); hideLoading(); if(res?.data?.user) { if($modal?.open) $modal.close(); } else { err.textContent=res?.error?.message || 'Error'; err.style.display='block'; } } 
  catch(ex) { hideLoading(); err.textContent=ex.message; err.style.display='block'; }
}
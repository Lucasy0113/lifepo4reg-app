(function() {
'use strict';
const SUPABASE_URL = 'https://dgfdtwmvyalofmszbnab.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_AzdP6R-UiBe4oecm1emSjQ_AtPRXSkV';
if (window._dbLoaded) return;
window._dbLoaded = true;

let supabaseClient = null;
if (window.supabase && typeof window.supabase.createClient === 'function') {
  try { supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); console.log('✅ Supabase listo'); }
  catch (e) { console.warn('⚠️ Error Supabase:', e.message); }
}

let offlineQueue = JSON.parse(localStorage.getItem('lifepo4_offline') || '[]');
let isOnline = navigator.onLine;
window.addEventListener('online', () => { isOnline = true; syncQueue(); });
window.addEventListener('offline', () => { isOnline = false; });

async function getUser() {
  if (!supabaseClient) return null;
  try { const { data } = await supabaseClient.auth.getUser(); return data?.user || null; }
  catch { return null; }
}

async function fetchBatteries() {
  if (!supabaseClient) return [];
  const user = await getUser(); if (!user) return [];
  try { 
    const { data, error } = await supabaseClient.from('batteries').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    if (error) throw error;
    return data || []; 
  } catch (e) { console.warn('Error fetchBatteries:', e); return []; }
}

async function fetchReadings(batteryId) {
  if (!supabaseClient || !batteryId) return [];
  const user = await getUser(); if (!user) return [];
  try { 
    const { data, error } = await supabaseClient.from('cell_readings').select('*').eq('user_id', user.id).eq('battery_id', batteryId).order('recorded_at', { ascending: false });
    if (error) throw error;
    return data || []; 
  } catch (e) { console.warn('Error fetchReadings:', e); return []; }
}

function validateVoltages(arr) { return arr.every(v => v >= 2.5 && v <= 3.65); }

// ✅ CORREGIDO: Detecta "nuevo" ANTES de asignar UUID
async function saveBattery(data) {
  const user = await getUser(); if (!user) throw new Error('No autenticado');
  const { voltages_initial, ...payload } = data;
  payload.user_id = user.id;
  payload.total_voltage = parseFloat(payload.total_voltage) || 0;
  payload.amperage = parseFloat(payload.amperage) || 0;
  payload.cell_count = parseInt(payload.cell_count) || 1;

  // ✅ CORRECCIÓN: Detecta "nuevo" por el marcador 'new', no por existencia de ID
  const isNew = !payload.id || payload.id === 'new';
  if (isNew) payload.id = crypto.randomUUID();

  if (isOnline && supabaseClient) {
    if (isNew) {
      const { error } = await supabaseClient.from('batteries').insert([payload]);
      if (error) throw error;
    } else {
      const { error } = await supabaseClient.from('batteries').update(payload).eq('id', payload.id).eq('user_id', user.id);
      if (error) throw error;
    }
  } else {
    offlineQueue.push({ type: 'save', table: 'batteries', payload });
    localStorage.setItem('lifepo4_offline', JSON.stringify(offlineQueue));
  }
  return payload.id; // ✅ Retorna el ID para encadenar la lectura
}

async function saveReading(data) {
  const user = await getUser(); if (!user) throw new Error('No autenticado');
  if (!validateVoltages(data.voltages)) throw new Error('Voltajes fuera de rango (2.500 - 3.650 V)');
  const payload = { user_id: user.id, ...data };
  
  // ✅ CORRECCIÓN CRÍTICA: Detecta creación por el string 'new'
  const isNew = !payload.id || payload.id === 'new';
  if (isNew) payload.id = crypto.randomUUID();

  if (isOnline && supabaseClient) {
    if (isNew) {
      const { error } = await supabaseClient.from('cell_readings').insert([payload]);
      if (error) throw error;
    } else {
      const { error } = await supabaseClient.from('cell_readings').update(payload).eq('id', payload.id).eq('user_id', user.id);
      if (error) throw error;
    }
  } else {
    offlineQueue.push({ type: 'save', table: 'cell_readings', payload });
    localStorage.setItem('lifepo4_offline', JSON.stringify(offlineQueue));
  }
}

async function deleteRecord(table, id) {
  const user = await getUser(); if (!user) throw new Error('No autenticado');
  if (isOnline && supabaseClient) {
    const { error } = await supabaseClient.from(table).delete().eq('id', id).eq('user_id', user.id);
    if (error) throw error;
  } else {
    offlineQueue.push({ type: 'delete', table, id });
    localStorage.setItem('lifepo4_offline', JSON.stringify(offlineQueue));
  }
}

async function syncQueue() {
  if (!supabaseClient || offlineQueue.length === 0) return;
  const queue = [...offlineQueue]; offlineQueue = [];
  for (const item of queue) {
    try {
      if (item.type === 'save') {
        if (item.table === 'batteries') await saveBattery(item.payload);
        else await saveReading(item.payload);
      } else if (item.type === 'delete') await deleteRecord(item.table, item.id);
    } catch (e) { console.warn('Error sync:', e.message); offlineQueue.push(item); }
  }
  localStorage.setItem('lifepo4_offline', JSON.stringify(offlineQueue));
}

window.db = {
  supabase: supabaseClient,
  signUp: async (e, p) => supabaseClient ? await supabaseClient.auth.signUp({ email: e, password: p }) : null,
  signIn: async (e, p) => supabaseClient ? await supabaseClient.auth.signInWithPassword({ email: e, password: p }) : null,
  signOut: async () => { if (supabaseClient) await supabaseClient.auth.signOut(); localStorage.removeItem('lifepo4_user'); },
  getCurrentUser: getUser,
  fetchBatteries, fetchReadings, saveBattery, saveReading, deleteRecord, syncOfflineQueue: syncQueue, isOnline: () => isOnline
};
console.log('✅ db.js cargado');
})();
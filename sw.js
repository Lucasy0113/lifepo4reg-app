// sw.js - Service Worker para LiFePO4 Battery Manager
const CACHE_NAME = 'lifepo4-battery-v1';

// Assets estáticos propios de la app
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './manifest.json'
];

// Instalación: precargar assets
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

// Activación: limpiar cachés antiguas y tomar control de las pestañas abiertas
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
  ));
  self.clients.claim();
});

// Intercepción de peticiones
self.addEventListener('fetch', e => {
  const url = e.request.url;
  
  // 🔹 Bypass caché para Supabase y CDN externos (auth y API siempre deben estar frescos)
  if (url.includes('supabase.co') || url.includes('cdn.jsdelivr.net')) {
    e.respondWith(fetch(e.request));
    return;
  }
  
  // 🔹 Estrategia Cache-First para assets estáticos de la app
  e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});
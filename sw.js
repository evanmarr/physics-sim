/* Kinetic service worker.
 * BUMP `VERSION` whenever the precache list or caching logic changes (the
 * browser only re-installs the worker when this file's bytes change; a new
 * version also makes old caches get deleted on activate). Static files are
 * revalidated at runtime, so ordinary content edits reach users anyway. */
const VERSION = 'kinetic-v1';
const CACHE = VERSION;

// Hand-maintained; tests/pwa.test.js fails if a src/*.js module or
// particle-physics page is missing. Precaching is best-effort per URL.
const PRECACHE = [
  '/', '/index.html', '/style.css', '/offline.html', '/manifest.webmanifest', '/favicon.svg',
  '/icons/icon-32.png', '/icons/icon-192.png', '/icons/icon-512.png',
  '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png', '/icons/kinetic-logo-transparent.png',
  "/src/achievements.js",
  "/src/aiTutor.js",
  "/src/assignmentVariation.js",
  "/src/astronomy.js",
  "/src/astronomyData.js",
  "/src/atomViewer.js",
  "/src/auth.js",
  "/src/challengeTiers.js",
  "/src/challenges.js",
  "/src/chemistry.js",
  "/src/chemistryChallenges.js",
  "/src/chemistryData.js",
  "/src/classroom.js",
  "/src/customItems.js",
  "/src/cyberChallenges.js",
  "/src/cyberPhishData.js",
  "/src/cyberSimulators.js",
  "/src/cybersecurity.js",
  "/src/cybersecurityData.js",
  "/src/daily.js",
  "/src/dailyAnim.js",
  "/src/dailyConcepts.js",
  "/src/dailyLogic.js",
  "/src/dashboard.js",
  "/src/deviceMode.js",
  "/src/deweyData.js",
  "/src/economics.js",
  "/src/pwa.js",
  "/src/feedback.js",
  "/src/experienceLevel.js",
  "/src/foodWebMath.js",
  "/src/genetics.js",
  "/src/geneticsMath.js",
  "/src/graphs.js",
  "/src/history.js",
  "/src/historyChallenges.js",
  "/src/historyData.js",
  "/src/lightOptics.js",
  "/src/loading.js",
  "/src/main.js",
  "/src/materials.js",
  "/src/mathExpr.js",
  "/src/mathematics.js",
  "/src/measureMath.js",
  "/src/measureTools.js",
  "/src/modelInfo.js",
  "/src/notebook.js",
  "/src/notifications.js",
  "/src/objectTypes.js",
  "/src/onboarding.js",
  "/src/palette.js",
  "/src/panel.js",
  "/src/paramSweep.js",
  "/src/physics.js",
  "/src/physicsEdu.js",
  "/src/physicsGraphPanel.js",
  "/src/physicsPresets.js",
  "/src/plans.js",
  "/src/popup.js",
  "/src/quiz.js",
  "/src/render.js",
  "/src/rocketSim.js",
  "/src/search.js",
  "/src/snapshot.js",
  "/src/sound.js",
  "/src/storage.js",
  "/src/structures.js",
  "/src/sustainability.js",
  "/src/sweepMath.js",
  "/src/tutorial.js",
  "/src/units.js",
  "/src/war.js",
  "/src/warCampaign.js",
  "/src/whiteboard.js",
  "/src/wordcloud.js",
  "/src/world.js",
  "/src/worldShare.js",
  "/src/zoology.js",
  "/src/zoologyData.js",
  "/particle-physics/disjoint-graph.html",
  "/particle-physics/flocking.html",
  "/particle-physics/force-lattice.html",
  "/particle-physics/gravity-wells.html",
  "/particle-physics/magnetic-charges.html",
  "/particle-physics/pointer-field.html",
  "/particle-physics/radial-tree.html",
  "/particle-physics/swarm-box.html",
  // Pinned CDN libraries (cross-origin, cached as opaque responses).
  'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
  'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js',
  'https://cdn.jsdelivr.net/npm/matter-js@0.19.0/build/matter.min.js',
  'https://cdn.jsdelivr.net/npm/poly-decomp@0.3.0/build/decomp.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js',
];

const isCdn = (u) => u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const req = url.startsWith('http') ? new Request(url, { mode: 'no-cors' }) : new Request(url, { cache: 'reload' });
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') await cache.put(url, res);
      } catch { /* offline or missing: runtime caching fills the gap */ }
    }));
    // No skipWaiting here: a waiting worker lets the page offer a "Reload" toast.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('kinetic-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) self.skipWaiting();
});

const offlineJson = () => new Response(JSON.stringify({ error: 'offline' }), {
  status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' },
});

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req, { ignoreSearch: false });
  const network = fetch(req).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(network); return cached; }
  const res = await network;
  return res || (await cache.match(req, { ignoreSearch: true })) || Response.error();
}

async function navigate(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  } catch {
    const cache = await caches.open(CACHE);
    return (await cache.match(req, { ignoreSearch: true }))
      || (await cache.match('/index.html'))
      || (await cache.match('/offline.html'))
      || new Response('Offline', { status: 503 });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // never touch POST/PUT/etc.
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return; // chrome-extension:, etc.
  if (req.headers.has('range')) return;                   // let the network serve media ranges
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req).catch(offlineJson));     // network only, never cached
    return;
  }
  if (req.mode === 'navigate') {
    if (url.origin !== self.location.origin) return;
    event.respondWith(navigate(req));
    return;
  }
  if (url.origin === self.location.origin || isCdn(url)) {
    event.respondWith(staleWhileRevalidate(event, req));
  }
});

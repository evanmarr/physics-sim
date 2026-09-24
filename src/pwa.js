// PWA glue: service worker registration, install prompt, update toast,
// online/offline notifications. The integrator calls initPWA({ showToast }).
// showToast(message, { actionLabel, onAction }) is expected; extra args are harmless.

let deferredPrompt = null;
let installed = false;
let started = false;
const installListeners = new Set();
const onlineListeners = new Set();

export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

export const IOS_INSTALL_TEXT = 'Tap Share, then "Add to Home Screen".';

/** { canInstall, installed, ios, iosInstructions } — canInstall is true when a native prompt is ready. */
export function getInstallState() {
  const inst = installed || isStandalone();
  return {
    canInstall: !!deferredPrompt && !inst,
    installed: inst,
    ios: isIOS() && !inst,
    iosInstructions: isIOS() && !inst ? IOS_INSTALL_TEXT : '',
  };
}

export function onInstallStateChange(cb) {
  installListeners.add(cb);
  return () => installListeners.delete(cb);
}
const emitInstall = () => installListeners.forEach((cb) => { try { cb(getInstallState()); } catch { /* ignore */ } });

/** Shows the native install prompt. Resolves 'accepted' | 'dismissed' | 'unavailable'. */
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  const p = deferredPrompt;
  deferredPrompt = null;
  try {
    await p.prompt();
    const { outcome } = await p.userChoice;
    emitInstall();
    return outcome;
  } catch {
    emitInstall();
    return 'unavailable';
  }
}

/** cb(isOnline) on every change. Returns an unsubscribe fn. */
export function onOnlineChange(cb) {
  onlineListeners.add(cb);
  return () => onlineListeners.delete(cb);
}

function swAllowed() {
  if (!('serviceWorker' in navigator)) return false;
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') {
    try {
      if (/[?&]nosw\b/.test(location.search)) return false;
      return localStorage.getItem('kineticSw') === '1';
    } catch { return false; }
  }
  return true;
}

function watchUpdates(reg, showToast) {
  let shown = false;
  const offer = (worker) => {
    if (shown || !worker) return;
    shown = true;
    const reload = () => worker.postMessage('SKIP_WAITING');
    if (typeof showToast === 'function') showToast('A new version of Kinetic is available.', { actionLabel: 'Reload', onAction: reload });
  };
  if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (!w) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
    });
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !shown) return; // first-ever install also fires this; don't reload then
    reloading = true;
    location.reload();
  });
}

export function initPWA({ showToast } = {}) {
  if (started) return;
  started = true;

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; emitInstall(); });
  window.addEventListener('appinstalled', () => { installed = true; deferredPrompt = null; emitInstall(); });
  const notify = () => onlineListeners.forEach((cb) => { try { cb(navigator.onLine); } catch { /* ignore */ } });
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);

  if (!swAllowed()) return;
  const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then((reg) => watchUpdates(reg, showToast))
    .catch((err) => console.warn('Service worker registration failed:', err));
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

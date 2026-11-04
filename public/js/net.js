// Server connection: wake-up check, config, script loading and one shared Socket.IO connection.

export function apiBase() {
  const m = typeof document !== 'undefined' && document.querySelector('meta[name="sts-api"]');
  return (m?.content || '').replace(/\/$/, '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function timeoutSignal(ms, outer) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  outer?.addEventListener('abort', () => c.abort(), { once: true });
  c.signal.addEventListener('abort', () => clearTimeout(t), { once: true });
  return { signal: c.signal, done: () => clearTimeout(t) };
}

// Calls /health until it answers. A sleeping Render server can take up to a minute.
// onProgress({ attempt, elapsed, timeoutMs }) runs before every attempt.
// Resolves when reachable, rejects with Error('timeout') or Error('aborted').
export async function waitForServer({ base = apiBase(), onProgress, signal, fetchFn = globalThis.fetch, timeoutMs = 90000, attemptMs = 8000, now = Date.now, wait = sleep } = {}) {
  const start = now();
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw new Error('aborted');
    onProgress?.({ attempt, elapsed: now() - start, timeoutMs });
    const t = timeoutSignal(attemptMs, signal);
    try {
      const res = await fetchFn(base + '/health', { cache: 'no-store', signal: t.signal });
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.status === 'ok') { t.done(); return { attempts: attempt, ms: now() - start }; }
      }
    } catch (e) { /* network error or attempt timeout: try again */ }
    t.done();
    if (signal?.aborted) throw new Error('aborted');
    if (now() - start >= timeoutMs) throw new Error('timeout');
    await wait(Math.min(1500 + attempt * 500, 5000));
  }
}

export async function fetchConfig(base = apiBase(), fetchFn = globalThis.fetch) {
  const res = await fetchFn(base + '/config', { cache: 'no-store' });
  if (!res.ok) throw new Error('config ' + res.status);
  return res.json();
}

const loaded = new Map();
export function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = () => { loaded.delete(src); reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
}

// One Socket.IO connection for the whole page. `on` keeps a single handler per event,
// so re-binding can never create duplicate listeners.
export function createConnection({ base = apiBase(), io = globalThis.io } = {}) {
  const opts = { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000, timeout: 10000 };
  const socket = base ? io(base, opts) : io(opts);
  const handlers = new Map();
  return {
    socket,
    get id() { return socket.id; },
    get connected() { return socket.connected; },
    on(event, fn) {
      if (handlers.has(event)) socket.off(event, handlers.get(event));
      handlers.set(event, fn); socket.on(event, fn);
    },
    emit(event, payload) { if (socket.connected) socket.emit(event, payload); },
    emitAck(event, payload = {}, ms = 10000) {
      return new Promise((resolve, reject) => {
        if (!socket.connected) return reject(new Error('offline'));
        const t = setTimeout(() => reject(new Error('timeout')), ms);
        socket.emit(event, payload, (res) => { clearTimeout(t); resolve(res); });
      });
    },
    close() { socket.disconnect(); },
  };
}

// Resolves on the first 'connect', rejects after `ms`.
export function whenConnected(conn, ms = 20000) {
  return new Promise((resolve, reject) => {
    if (conn.connected) return resolve();
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    conn.socket.once('connect', () => { clearTimeout(t); resolve(); });
  });
}

// Small shared UI helpers (used by the call page and the translator page).
export const $ = (id) => document.getElementById(id);

export function toast(msg, ms = 3000) {
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), ms);
}

// Modals: focus moves in, Escape closes, focus returns to the opener.
let opener = null;
export function openModal(id) {
  const m = $(id); if (!m) return;
  opener = document.activeElement;
  m.classList.add('open');
  m.querySelector('button, [href], input, select')?.focus();
}
export function closeModal(id) {
  $(id)?.classList.remove('open');
  opener?.focus?.(); opener = null;
}
export const anyModalOpen = () => !!document.querySelector('.ov.open');
export function closeTopModal() { const m = document.querySelector('.ov.open'); if (m) closeModal(m.id); return !!m; }
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTopModal(); });
  // Inline onclick="..." handlers in the HTML need these on window.
  window.openModal = openModal; window.closeModal = closeModal;
}

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export const initials = (n) => String(n).split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const COLORS = ['#6573F2', '#9B6BF2', '#2FAE86', '#E0626B', '#D98F2B', '#2A9DB8'];
export function colorOf(name) {
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}
export const setIcon = (btn, name) => $(btn)?.querySelector('use')?.setAttribute('href', '#i-' + name);

// localStorage can throw (private mode, blocked storage). Never let it break the app.
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};

// Avatar circle: Google photo if we have one, otherwise coloured initials.
export function avatar(name, photoURL, size = 26) {
  const a = el('div', 'av');
  a.style.width = a.style.height = size + 'px';
  if (photoURL) {
    const img = new Image(); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.src = photoURL;
    img.onerror = () => { img.remove(); a.style.background = colorOf(name); a.textContent = initials(name); };
    a.appendChild(img);
  } else { a.style.background = colorOf(name); a.textContent = initials(name); }
  return a;
}

'use strict';
const crypto = require('node:crypto');
const { isObj, clean, normalizeRoomId, isDescription, cleanCandidate, cleanWords } = require('./validate');
const { createLimiter, DEFAULT_RULES } = require('./rateLimit');
const { publicUser } = require('./auth');
const { publicParticipant } = require('./rooms');

// All Socket.IO events for one connection. `io` and `socket` are only used through
// on/emit/to/join/leave, so tests can drive this with a fake.
function registerHandlers(io, socket, { store, authenticate, refine, log = console, rules = DEFAULT_RULES, now = Date.now }) {
  const allow = createLimiter(rules, now);
  const reply = (cb, v) => { if (typeof cb === 'function') cb(v); };
  const notice = (message) => socket.emit('notice', { message });
  const signedIn = () => !!socket.data.user;

  // Wraps a handler so one bad payload can never crash the server.
  const on = (event, fn) => socket.on(event, async (...args) => {
    try { await fn(...args); } catch (e) { log.error(`[socket ${event}] ${e.stack || e.message}`); }
  });

  // Gate for every room operation.
  function needAuth(cb) {
    if (signedIn()) return true;
    reply(cb, { error: 'Please sign in first', code: 'auth' });
    return false;
  }
  function limited(kind, cb, text = 'You are doing that too quickly. Please wait a moment.') {
    if (allow(kind)) return false;
    if (cb) reply(cb, { error: text, code: 'rate' }); else notice(text);
    return true;
  }

  function leaveCurrent() {
    const r = store.leave(socket.id);
    if (!r) return;
    socket.leave(r.roomId);
    if (!r.closed) {
      io.to(r.roomId).emit('participant-left', { id: socket.id });
      io.to(r.roomId).emit('room-state', store.state(r.roomId));
    }
  }

  const author = () => store.participant(socket.id);

  // ---- Authentication ----
  on('authenticate', async (payload, cb) => {
    if (limited('auth', cb, 'Too many sign-in attempts. Please wait a moment.')) return;
    const res = await authenticate(payload);
    if (res.error) return reply(cb, res);
    if (socket.data.user && socket.data.user.uid !== res.user.uid) leaveCurrent();
    socket.data.user = res.user;
    reply(cb, { user: publicUser(res.user) });
  });

  on('sign-out', (_, cb) => {
    leaveCurrent();
    socket.data.user = null;
    reply(cb, { ok: true });
  });

  // ---- Rooms ----
  on('create-room', (payload, cb) => {
    if (!needAuth(cb) || limited('room', cb)) return;
    leaveCurrent();
    const room = store.create(socket.id, socket.data.user, clean(payload?.roomName, 60) || 'Untitled room');
    socket.join(room.id);
    reply(cb, { roomId: room.id, you: publicParticipant(author()), roomState: store.state(room.id) });
  });

  on('join-room', (payload, cb) => {
    if (!needAuth(cb) || limited('room', cb)) return;
    const roomId = normalizeRoomId(payload?.roomId);
    if (!roomId) return reply(cb, { error: 'Enter a valid 8-character room code', code: 'bad-code' });
    if (store.roomIdOf(socket.id) && store.roomIdOf(socket.id) !== roomId) leaveCurrent();
    const res = store.join(roomId, socket.id, socket.data.user);
    if (res.error) return reply(cb, res);
    socket.join(roomId);
    const you = publicParticipant(author());
    reply(cb, { roomId, you, roomState: store.state(roomId) });
    socket.to(roomId).emit('participant-joined', you);
    io.to(roomId).emit('room-state', store.state(roomId));
  });

  on('leave-room', (_, cb) => { leaveCurrent(); reply(cb, { ok: true }); });

  on('media-state', (payload) => {
    if (!signedIn() || !isObj(payload) || limited('media')) return;
    const p = store.setMedia(socket.id, payload);
    if (p) io.to(store.roomIdOf(socket.id)).emit('media-state', { id: socket.id, mic: p.mic, cam: p.cam });
  });

  // ---- WebRTC signaling: only between two members of the same room ----
  function relay(event, build) {
    on(event, (payload) => {
      if (!signedIn() || !isObj(payload) || typeof payload.to !== 'string') return;
      if (!store.sameRoom(socket.id, payload.to)) return;
      if (!allow('signal')) return;
      const body = build(payload);
      if (body) io.to(payload.to).emit(event, { from: socket.id, ...body });
    });
  }
  relay('offer', (p) => (isDescription(p.description, 'offer') ? { description: { type: 'offer', sdp: p.description.sdp } } : null));
  relay('answer', (p) => (isDescription(p.description, 'answer') ? { description: { type: 'answer', sdp: p.description.sdp } } : null));
  relay('ice-candidate', (p) => {
    const candidate = cleanCandidate(p.candidate);
    return candidate ? { candidate } : null;
  });

  // ---- Chat and captions (must be inside a room) ----
  function inRoom() {
    const me = author();
    return me ? { me, roomId: store.roomIdOf(socket.id) } : null;
  }
  const caption = (roomId, me, extra) =>
    io.to(roomId).emit('caption', { id: crypto.randomUUID(), from: me.displayName, fromId: socket.id, ts: Date.now(), ...extra });

  on('chat-message', (payload) => {
    const ctx = inRoom(); const text = clean(payload?.text, 500);
    if (!ctx || !text || limited('chat')) return;
    io.to(ctx.roomId).emit('chat-message', { id: crypto.randomUUID(), from: ctx.me.displayName, fromId: socket.id, text, ts: Date.now() });
  });

  on('say', (payload) => {
    const ctx = inRoom(); const text = clean(payload?.text, 200);
    if (!ctx || !text || limited('say')) return;
    caption(ctx.roomId, ctx.me, { text, source: 'phrase', final: true });
  });

  on('speech-caption', (payload) => {
    const ctx = inRoom(); const text = clean(payload?.text, 300);
    if (!ctx || !text || limited('speech')) return;
    caption(ctx.roomId, ctx.me, { text, source: 'speech', final: true });
  });

  // Sign keywords: show them at once, then replace with the polished sentence.
  on('sign-words', async (payload) => {
    const ctx = inRoom(); const words = cleanWords(payload?.words);
    if (!ctx || !words.length || limited('sign')) return;
    const id = crypto.randomUUID();
    const raw = words.join(' ').toLowerCase();
    io.to(ctx.roomId).emit('caption', {
      id, from: ctx.me.displayName, fromId: socket.id, ts: Date.now(),
      text: raw.charAt(0).toUpperCase() + raw.slice(1) + '.', source: 'sign', final: false,
    });
    const result = await refine(words, payload?.lang === 'hi' ? 'Hindi' : 'English');
    io.to(ctx.roomId).emit('caption-update', { id, text: result.text, ai: !!result.ai });
  });

  socket.on('disconnect', () => {
    try { leaveCurrent(); } catch (e) { log.error(`[disconnect] ${e.message}`); }
  });
}

module.exports = { registerHandlers };

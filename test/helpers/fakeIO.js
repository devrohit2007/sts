'use strict';
// In-memory stand-in for Socket.IO's server API, just enough to drive lib/handlers.js.
// Used by the unit tests and by the browser end-to-end test.

class FakeSocket {
  constructor(io, id) {
    this.io = io; this.id = id; this.data = {}; this.handlers = new Map();
    this.received = []; this.onReceive = null; this.rooms = new Set();
    this.join(id); // like Socket.IO: every socket is in a room named after its id
  }
  on(ev, fn) { this.handlers.set(ev, fn); return this; }
  join(room) { this.rooms.add(room); this.io._join(room, this.id); }
  leave(room) { this.rooms.delete(room); this.io._leave(room, this.id); }
  to(room) { return { emit: (ev, payload) => this.io._emitTo(room, ev, payload, this.id) }; }
  emit(ev, payload) { this._receive(ev, payload); }
  _receive(ev, payload) { this.received.push({ ev, payload }); this.onReceive?.(ev, payload); }

  // ---- client side ----
  // Sends an event as the client would. Resolves with the ack value (or undefined if none).
  async send(ev, payload) {
    const h = this.handlers.get(ev);
    if (!h) throw new Error(`no handler for ${ev}`);
    let ackValue; let acked = false;
    await h(payload, (v) => { acked = true; ackValue = v; });
    return acked ? ackValue : undefined;
  }
  got(ev) { return this.received.filter((r) => r.ev === ev).map((r) => r.payload); }
  clear() { this.received.length = 0; }
  async disconnect() {
    await this.handlers.get('disconnect')?.('client disconnect');
    for (const r of [...this.rooms]) this.io._leave(r, this.id);
    this.io.sockets.delete(this.id);
  }
}

class FakeIO {
  constructor() { this.sockets = new Map(); this.rooms = new Map(); this.n = 0; }
  connect(id = `s${++this.n}`) { const s = new FakeSocket(this, id); this.sockets.set(id, s); return s; }
  _join(room, id) { if (!this.rooms.has(room)) this.rooms.set(room, new Set()); this.rooms.get(room).add(id); }
  _leave(room, id) { const r = this.rooms.get(room); if (r) { r.delete(id); if (!r.size) this.rooms.delete(room); } }
  _emitTo(room, ev, payload, exceptId) {
    for (const id of [...(this.rooms.get(room) || [])]) if (id !== exceptId) this.sockets.get(id)?._receive(ev, payload);
  }
  to(room) { return { emit: (ev, payload) => this._emitTo(room, ev, payload, null) }; }
}

module.exports = { FakeIO, FakeSocket };

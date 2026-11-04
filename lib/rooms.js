'use strict';
const crypto = require('node:crypto');

// No 0/O/1/I so codes are easy to read aloud and type.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newRoomId() {
  let s = '';
  for (const b of crypto.randomBytes(8)) s += ALPHABET[b % ALPHABET.length];
  return s;
}

// What other people are allowed to see about a participant (no uid, no email).
function publicParticipant(p) {
  return { id: p.id, displayName: p.displayName, photoURL: p.photoURL, isGuest: p.isGuest, mic: p.mic, cam: p.cam, joinedAt: p.joinedAt };
}

class RoomStore {
  constructor({ maxParticipants = 8, newId = newRoomId, now = Date.now } = {}) {
    this.max = maxParticipants;
    this.newId = newId;
    this.now = now;
    this.rooms = new Map();    // roomId -> { id, name, participants: Map<clientId, participant> }
    this.byClient = new Map(); // clientId -> roomId
  }

  _add(room, clientId, user) {
    room.participants.set(clientId, {
      id: clientId, uid: user.uid, displayName: user.name, photoURL: user.photoURL || null,
      isGuest: !!user.isGuest, mic: true, cam: true, joinedAt: this.now(),
    });
    this.byClient.set(clientId, room.id);
  }

  create(clientId, user, name) {
    let id;
    do { id = this.newId(); } while (this.rooms.has(id));
    const room = { id, name, participants: new Map() };
    this.rooms.set(id, room);
    this._add(room, clientId, user);
    return room;
  }

  join(roomId, clientId, user) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found', code: 'not-found' };
    if (this.byClient.get(clientId) === roomId) return { room };
    if (this.byClient.has(clientId)) return { error: 'Leave your current room first', code: 'busy' };
    if (room.participants.size >= this.max) return { error: `Room is full (max ${this.max})`, code: 'full' };
    this._add(room, clientId, user);
    return { room };
  }

  // Returns null if the client was not in a room.
  leave(clientId) {
    const roomId = this.byClient.get(clientId);
    if (!roomId) return null;
    this.byClient.delete(clientId);
    const room = this.rooms.get(roomId);
    room?.participants.delete(clientId);
    if (!room || !room.participants.size) { this.rooms.delete(roomId); return { roomId, closed: true }; }
    return { roomId, closed: false };
  }

  roomIdOf(clientId) { return this.byClient.get(clientId) || null; }

  participant(clientId) {
    const room = this.rooms.get(this.byClient.get(clientId));
    return room?.participants.get(clientId) || null;
  }

  // True only if both clients are different members of the same room.
  sameRoom(a, b) {
    const r = this.byClient.get(a);
    return !!r && a !== b && r === this.byClient.get(b);
  }

  setMedia(clientId, { mic, cam }) {
    const p = this.participant(clientId);
    if (!p) return null;
    if (typeof mic === 'boolean') p.mic = mic;
    if (typeof cam === 'boolean') p.cam = cam;
    return p;
  }

  state(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return { id: room.id, name: room.name, max: this.max, participants: [...room.participants.values()].map(publicParticipant) };
  }

  get size() { return this.rooms.size; }
}

module.exports = { RoomStore, publicParticipant, newRoomId };

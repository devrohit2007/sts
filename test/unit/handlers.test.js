'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { FakeIO } = require('../helpers/fakeIO');
const { registerHandlers } = require('../../lib/handlers');
const { RoomStore } = require('../../lib/rooms');
const { createAuthenticator } = require('../../lib/auth');

const quiet = { log() {}, warn() {}, error() {} };
const SDP = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n';

function setup({ refine, rules, verify } = {}) {
  const io = new FakeIO();
  const store = new RoomStore();
  const authenticate = createAuthenticator({
    verifyIdToken: verify === undefined
      ? async (t) => { if (t !== 'GOOD') throw new Error('bad'); return { uid: 'g1', name: 'Google User', picture: 'https://lh3.googleusercontent.com/p' }; }
      : verify,
    log: quiet,
  });
  const refiner = refine || (async (words) => ({ text: `AI:${words.join(' ')}`, ai: true }));
  const client = async (guestName) => {
    const s = io.connect();
    registerHandlers(io, s, { store, authenticate, refine: refiner, log: quiet, rules });
    if (guestName) await s.send('authenticate', { guestName });
    return s;
  };
  return { io, store, client };
}
const quick = { auth: { burst: 100, perSec: 100 }, room: { burst: 100, perSec: 100 }, signal: { burst: 100, perSec: 100 }, media: { burst: 100, perSec: 100 }, chat: { burst: 100, perSec: 100 }, say: { burst: 100, perSec: 100 }, speech: { burst: 100, perSec: 100 }, sign: { burst: 100, perSec: 100 } };

test('room operations need authentication', async () => {
  const { client } = setup();
  const s = await client();
  for (const ev of ['create-room', 'join-room']) {
    const r = await s.send(ev, { roomId: 'ABCD2345', roomName: 'x' });
    assert.equal(r.code, 'auth', ev);
  }
});

test('guest and google sign-in both work, bad tokens are rejected', async () => {
  const { client } = setup();
  const g = await client();
  const r1 = await g.send('authenticate', { guestName: 'Asha' });
  assert.equal(r1.user.name, 'Asha'); assert.equal(r1.user.isGuest, true);
  const goog = await client();
  const r2 = await goog.send('authenticate', { idToken: 'GOOD' });
  assert.equal(r2.user.name, 'Google User'); assert.equal(r2.user.isGuest, false);
  assert.ok(r2.user.photoURL.startsWith('https://'));
  const bad = await client();
  assert.equal((await bad.send('authenticate', { idToken: 'EVIL' })).code, 'invalid-token');
  assert.equal((await bad.send('create-room', {})).code, 'auth', 'failed sign-in does not authenticate the socket');
});

test('google sign-in is unavailable without a verifier but guests still work', async () => {
  const { client } = setup({ verify: null });
  const s = await client();
  assert.equal((await s.send('authenticate', { idToken: 'GOOD' })).code, 'auth-unavailable');
  assert.ok((await s.send('authenticate', { guestName: 'Ok' })).user);
});

test('create, join, leave and invalid room codes', async () => {
  const { client, store } = setup({ rules: quick });
  const a = await client('Alice'); const b = await client('Bob');
  const created = await a.send('create-room', { roomName: 'Clinic' });
  assert.match(created.roomId, /^[A-Z2-9]{8}$/);
  assert.equal(created.roomState.name, 'Clinic');

  assert.equal((await b.send('join-room', { roomId: 'zzz' })).code, 'bad-code');
  assert.equal((await b.send('join-room', { roomId: 'ABCDEFGH' })).code, 'not-found');

  const joined = await b.send('join-room', { roomId: created.roomId.toLowerCase() });
  assert.equal(joined.roomState.participants.length, 2);
  assert.equal(a.got('participant-joined')[0].displayName, 'Bob');
  assert.equal(a.got('room-state').at(-1).participants.length, 2);
  assert.ok(!JSON.stringify(joined).includes('guest_'), 'uids are never sent to clients');

  await b.send('leave-room', {});
  assert.equal(a.got('participant-left')[0].id, b.id);
  assert.equal(store.state(created.roomId).participants.length, 1);
  await a.send('leave-room', {});
  assert.equal(store.size, 0, 'room is deleted when empty');
});

test('a room holds at most 8 people', async () => {
  const { client } = setup({ rules: quick });
  const host = await client('Host');
  const { roomId } = await host.send('create-room', {});
  for (let i = 0; i < 7; i++) assert.ok(!(await (await client(`G${i}`)).send('join-room', { roomId })).error);
  const ninth = await client('Ninth');
  const r = await ninth.send('join-room', { roomId });
  assert.equal(r.code, 'full');
});

test('disconnect cleans up the room and notifies others', async () => {
  const { client, store } = setup({ rules: quick });
  const a = await client('A'); const b = await client('B');
  const { roomId } = await a.send('create-room', {});
  await b.send('join-room', { roomId });
  a.clear();
  await b.disconnect();
  assert.equal(a.got('participant-left')[0].id, b.id);
  assert.equal(store.state(roomId).participants.length, 1);
  await a.disconnect();
  assert.equal(store.size, 0);
});

test('creating a new room leaves the previous one', async () => {
  const { client, store } = setup({ rules: quick });
  const a = await client('A'); const b = await client('B');
  const r1 = await a.send('create-room', {});
  await b.send('join-room', { roomId: r1.roomId });
  const r2 = await b.send('create-room', {});
  assert.equal(store.state(r1.roomId).participants.length, 1);
  assert.equal(store.roomIdOf(b.id), r2.roomId);
});

test('signaling only reaches members of the same room', async () => {
  const { client } = setup({ rules: quick });
  const a = await client('A'); const b = await client('B'); const outsider = await client('Out');
  const { roomId } = await a.send('create-room', {});
  await b.send('join-room', { roomId });
  await outsider.send('create-room', {});
  const description = { type: 'offer', sdp: SDP };

  await a.send('offer', { to: b.id, description });
  assert.equal(b.got('offer').length, 1);
  assert.equal(b.got('offer')[0].from, a.id);

  await a.send('offer', { to: outsider.id, description });
  await outsider.send('offer', { to: a.id, description });
  await outsider.send('ice-candidate', { to: b.id, candidate: { candidate: 'candidate:1' } });
  assert.equal(outsider.got('offer').length, 0, 'cannot signal into another room');
  assert.equal(a.got('offer').length, 0);
  assert.equal(b.got('ice-candidate').length, 0);

  await a.send('offer', { to: a.id, description });
  assert.equal(a.got('offer').length, 0, 'cannot signal yourself');
});

test('signaling payloads are validated and sanitised', async () => {
  const { client } = setup({ rules: quick });
  const a = await client('A'); const b = await client('B');
  const { roomId } = await a.send('create-room', {});
  await b.send('join-room', { roomId });

  await a.send('offer', { to: b.id, description: { type: 'answer', sdp: SDP } });
  await a.send('answer', { to: b.id, description: { type: 'offer', sdp: SDP } });
  await a.send('offer', { to: b.id, description: { type: 'offer', sdp: 5 } });
  await a.send('offer', { to: 42, description: { type: 'offer', sdp: SDP } });
  await a.send('offer', 'junk');
  assert.equal(b.got('offer').length + b.got('answer').length, 0);

  await a.send('answer', { to: b.id, description: { type: 'answer', sdp: SDP, extra: 'x' } });
  assert.deepEqual(b.got('answer')[0].description, { type: 'answer', sdp: SDP });

  await a.send('ice-candidate', { to: b.id, candidate: { candidate: 'candidate:1 1 udp', sdpMid: '0', sdpMLineIndex: 0, hack: 1 } });
  await a.send('ice-candidate', { to: b.id, candidate: 'bad' });
  assert.equal(b.got('ice-candidate').length, 1);
  assert.equal(b.got('ice-candidate')[0].candidate.hack, undefined);
});

test('chat, quick phrases and speech captions reach the room', async () => {
  const { client } = setup({ rules: quick });
  const a = await client('Alice'); const b = await client('Bob');
  const { roomId } = await a.send('create-room', {});
  await b.send('join-room', { roomId });

  await a.send('chat-message', { text: '  hello <b>there</b>  ' });
  assert.equal(b.got('chat-message')[0].text, 'hello <b>there</b>', 'stored as plain text; the client renders it as text');
  assert.equal(b.got('chat-message')[0].from, 'Alice');
  await a.send('chat-message', { text: '   ' });
  assert.equal(b.got('chat-message').length, 1);

  await a.send('say', { text: 'I need help' });
  const phrase = b.got('caption')[0];
  assert.equal(phrase.source, 'phrase'); assert.equal(phrase.final, true); assert.equal(phrase.from, 'Alice');

  await b.send('speech-caption', { text: 'How can I help?' });
  const speech = a.got('caption').find((c) => c.source === 'speech');
  assert.equal(speech.text, 'How can I help?'); assert.equal(speech.fromId, b.id);
});

test('people outside a room cannot chat or caption', async () => {
  const { client } = setup({ rules: quick });
  const lone = await client('Lone'); const other = await client('Other');
  await other.send('create-room', {});
  await lone.send('chat-message', { text: 'hi' });
  await lone.send('say', { text: 'hi' });
  await lone.send('speech-caption', { text: 'hi' });
  await lone.send('sign-words', { words: ['hi'] });
  assert.equal(other.received.filter((r) => ['chat-message', 'caption'].includes(r.ev)).length, 0);
});

test('sign words are shown immediately, then replaced by the AI sentence', async () => {
  const { client } = setup({ rules: quick });
  const a = await client('Alice'); const b = await client('Bob');
  const { roomId } = await a.send('create-room', {});
  await b.send('join-room', { roomId });

  await a.send('sign-words', { words: ['I', 'WATER', 'want'], lang: 'en' });
  const raw = b.got('caption')[0];
  assert.equal(raw.text, 'I water want.'); assert.equal(raw.final, false); assert.equal(raw.source, 'sign');
  const upd = b.got('caption-update')[0];
  assert.equal(upd.id, raw.id); assert.equal(upd.text, 'AI:I WATER want'); assert.equal(upd.ai, true);
});

test('sign words fall back to plain text when the AI is unavailable', async () => {
  const { client } = setup({ rules: quick, refine: async (w) => ({ text: 'Plain.', ai: false, reason: 'no-key' }) });
  const a = await client('Alice');
  await a.send('create-room', {});
  await a.send('sign-words', { words: ['hello'] });
  assert.deepEqual(a.got('caption-update')[0], { id: a.got('caption')[0].id, text: 'Plain.', ai: false });
});

test('sign words pass the requested language to the AI and ignore junk', async () => {
  const langs = [];
  const { client } = setup({ rules: quick, refine: async (w, l) => { langs.push(l); return { text: 'x', ai: true }; } });
  const a = await client('A');
  await a.send('create-room', {});
  await a.send('sign-words', { words: ['hi'], lang: 'hi' });
  await a.send('sign-words', { words: ['hi'], lang: 'zz' });
  await a.send('sign-words', { words: 'not-an-array' });
  await a.send('sign-words', { words: [] });
  assert.deepEqual(langs, ['Hindi', 'English']);
});

test('one noisy event type never starves the others (captions are not dropped)', async () => {
  const { client } = setup(); // default rules
  const a = await client('Alice'); const b = await client('Bob');
  const { roomId } = await a.send('create-room', {});
  await b.send('join-room', { roomId });
  for (let i = 0; i < 20; i++) await a.send('sign-words', { words: ['hi'] });   // exhausts the sign bucket
  b.clear();
  for (let i = 0; i < 8; i++) await a.send('speech-caption', { text: `line ${i}` });
  assert.equal(b.got('caption').length, 8, 'all speech captions delivered');
});

test('rate limited events tell the user instead of failing silently', async () => {
  const { client } = setup({ rules: { chat: { burst: 1, perSec: 0.001 }, auth: quick.auth, room: quick.room } });
  const a = await client('Alice');
  await a.send('create-room', {});
  await a.send('chat-message', { text: 'one' });
  await a.send('chat-message', { text: 'two' });
  assert.equal(a.got('notice').length, 1);
  assert.equal(a.got('chat-message').length, 1);
});

test('media state is stored and broadcast', async () => {
  const { client } = setup({ rules: quick });
  const a = await client('A'); const b = await client('B');
  const { roomId } = await a.send('create-room', {});
  await b.send('join-room', { roomId });
  await a.send('media-state', { mic: false, cam: false });
  assert.deepEqual(b.got('media-state')[0], { id: a.id, mic: false, cam: false });
  await a.send('media-state', 'junk');
});

test('sign-out ends the session and leaves the room', async () => {
  const { client, store } = setup({ rules: quick });
  const a = await client('A');
  await a.send('create-room', {});
  await a.send('sign-out', {});
  assert.equal(store.size, 0);
  assert.equal((await a.send('create-room', {})).code, 'auth');
});

test('repeated failed sign-ins are rate limited', async () => {
  const { client } = setup();
  const s = await client();
  let last;
  for (let i = 0; i < 8; i++) last = await s.send('authenticate', { idToken: 'EVIL' });
  assert.equal(last.code, 'rate');
});

test('a handler that throws does not crash the server', async () => {
  const { client } = setup({ rules: quick, refine: async () => { throw new Error('boom'); } });
  const a = await client('A');
  await a.send('create-room', {});
  await a.send('sign-words', { words: ['hi'] }); // refine throws; the wrapper catches it
  assert.equal((await a.send('chat-message', { text: 'still works' })), undefined);
  assert.equal(a.got('chat-message').length, 1);
});

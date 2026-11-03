'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const v = require('../../lib/validate');
const { createLimiter } = require('../../lib/rateLimit');
const { RoomStore } = require('../../lib/rooms');
const { createAuthenticator } = require('../../lib/auth');
const { createRefiner, extractSentence, plainSentence } = require('../../lib/ai');
const { publicConfig, buildIceServers, firebaseWebConfig, DEFAULT_FIREBASE_WEB } = require('../../lib/config');

const quiet = { log() {}, warn() {}, error() {} };

// ---------- validate ----------
test('clean strips control characters, collapses spaces and caps length', () => {
  assert.equal(v.clean('  a\u0000b \n c  ', 10), 'a b c');
  assert.equal(v.clean('x'.repeat(100), 5), 'xxxxx');
  assert.equal(v.clean(null, 5), '');
});

test('normalizeRoomId accepts 8 chars and rejects the rest', () => {
  assert.equal(v.normalizeRoomId(' abcd2345 '), 'ABCD2345');
  assert.equal(v.normalizeRoomId('short'), null);
  assert.equal(v.normalizeRoomId('ABCD-234'), null);
  assert.equal(v.normalizeRoomId({}), null);
});

test('isDescription checks type and sdp', () => {
  assert.ok(v.isDescription({ type: 'offer', sdp: 'v=0' }, 'offer'));
  assert.ok(!v.isDescription({ type: 'answer', sdp: 'v=0' }, 'offer'));
  assert.ok(!v.isDescription({ type: 'offer', sdp: '' }, 'offer'));
  assert.ok(!v.isDescription({ type: 'offer', sdp: 'x'.repeat(60001) }, 'offer'));
  assert.ok(!v.isDescription('offer', 'offer'));
});

test('cleanCandidate keeps only known fields', () => {
  const c = v.cleanCandidate({ candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0, evil: 'x', usernameFragment: 'abc' });
  assert.deepEqual(c, { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'abc' });
  assert.equal(v.cleanCandidate({ candidate: 5 }), undefined);
  assert.equal(v.cleanCandidate(null), undefined);
  assert.equal(v.cleanCandidate({ candidate: 'x'.repeat(2001) }), undefined);
});

test('safeHttpsUrl only allows https', () => {
  assert.ok(v.safeHttpsUrl('https://lh3.googleusercontent.com/a/x'));
  assert.equal(v.safeHttpsUrl('http://x.com/a'), null);
  assert.equal(v.safeHttpsUrl('javascript:alert(1)'), null);
  assert.equal(v.safeHttpsUrl(42), null);
});

test('cleanWords limits count and length', () => {
  assert.deepEqual(v.cleanWords(['a', ' ', 'b'.repeat(50)]), ['a', 'b'.repeat(20)]);
  assert.equal(v.cleanWords(Array(30).fill('x')).length, 12);
  assert.deepEqual(v.cleanWords('nope'), []);
});

// ---------- rate limiter ----------
test('limiter has independent buckets and refills over time', () => {
  let t = 0;
  const allow = createLimiter({ a: { burst: 2, perSec: 1 }, b: { burst: 1, perSec: 1 } }, () => t);
  assert.ok(allow('a')); assert.ok(allow('a')); assert.ok(!allow('a'));
  assert.ok(allow('b'), 'bucket b is not affected by bucket a');
  t = 1000;
  assert.ok(allow('a'), 'refilled after one second');
  assert.ok(allow('unknown-kind'));
});

// ---------- rooms ----------
test('RoomStore create, join, capacity and cleanup', () => {
  const s = new RoomStore({ maxParticipants: 3 });
  const u = (n) => ({ uid: n, name: n, isGuest: true });
  const room = s.create('c1', u('A'), 'Test');
  assert.match(room.id, /^[A-Z2-9]{8}$/);
  assert.ok(s.join(room.id, 'c2', u('B')).room);
  assert.ok(s.join(room.id, 'c3', u('C')).room);
  assert.equal(s.join(room.id, 'c4', u('D')).code, 'full');
  assert.equal(s.join('NOPE0000', 'c4', u('D')).code, 'not-found');
  assert.equal(s.join(room.id, 'c2', u('B')).room.id, room.id, 'joining twice is harmless');
  assert.ok(s.sameRoom('c1', 'c2'));
  assert.ok(!s.sameRoom('c1', 'c1'));
  assert.ok(!s.sameRoom('c1', 'nobody'));
  assert.deepEqual(s.leave('c2'), { roomId: room.id, closed: false });
  assert.equal(s.leave('c2'), null);
  s.leave('c1'); s.leave('c3');
  assert.equal(s.size, 0, 'empty rooms are deleted');
});

test('RoomStore public state hides uid and tracks media', () => {
  const s = new RoomStore();
  const room = s.create('c1', { uid: 'secret-uid', name: 'A', isGuest: false, photoURL: 'https://x/y.png' }, 'R');
  s.setMedia('c1', { mic: false, cam: true });
  const st = s.state(room.id);
  assert.equal(st.participants[0].mic, false);
  assert.ok(!('uid' in st.participants[0]));
  assert.equal(st.max, 8);
});

test('RoomStore refuses a second room without leaving', () => {
  const s = new RoomStore();
  const a = s.create('c1', { uid: 'a', name: 'A' }, 'R1');
  const b = s.create('c2', { uid: 'b', name: 'B' }, 'R2');
  assert.equal(s.join(b.id, 'c1', { uid: 'a', name: 'A' }).code, 'busy');
  assert.ok(a.id !== b.id);
});

// ---------- auth ----------
test('guest sign-in creates a temporary identity', async () => {
  const auth = createAuthenticator({ verifyIdToken: null, log: quiet });
  const r = await auth({ guestName: '  Asha  ' });
  assert.equal(r.user.name, 'Asha');
  assert.ok(r.user.isGuest && r.user.uid.startsWith('guest_'));
  const r2 = await auth({});
  assert.match(r2.user.name, /^Guest \d{4}$/);
  assert.notEqual(r.user.uid, (await auth({ guestName: 'Asha' })).user.uid);
});

test('google sign-in verifies the token and uses the profile', async () => {
  const auth = createAuthenticator({
    verifyIdToken: async (t) => {
      if (t !== 'good') throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
      return { uid: 'u1', name: 'Rohit K', picture: 'https://lh3.googleusercontent.com/a/p', email: 'r@x.com' };
    },
    log: quiet,
  });
  const ok = await auth({ idToken: 'good' });
  assert.deepEqual(ok.user, { uid: 'u1', name: 'Rohit K', photoURL: 'https://lh3.googleusercontent.com/a/p', isGuest: false });
  assert.equal((await auth({ idToken: 'bad' })).code, 'invalid-token');
  assert.equal((await auth({ idToken: '' })).code, 'invalid-token');
  assert.equal((await auth({ idToken: 123 })).code, 'invalid-token');
});

test('google sign-in is refused (not trusted) when the verifier is missing', async () => {
  const auth = createAuthenticator({ verifyIdToken: null, log: quiet });
  assert.equal((await auth({ idToken: 'anything' })).code, 'auth-unavailable');
  assert.equal((await auth('string')).code, 'bad-request');
});

test('google profile falls back to email name and drops non-https avatars', async () => {
  const auth = createAuthenticator({ verifyIdToken: async () => ({ uid: 'u', email: 'meena@x.com', picture: 'http://x/y' }), log: quiet });
  const r = await auth({ idToken: 't' });
  assert.equal(r.user.name, 'meena');
  assert.equal(r.user.photoURL, null);
});

// ---------- AI ----------
const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const chat = (content) => ({ choices: [{ message: { content } }] });

test('extractSentence cleans model output and rejects bad output', () => {
  assert.equal(extractSentence('"I need water."'), 'I need water.');
  assert.equal(extractSentence('<think>hmm</think>\nI need water.'), 'I need water.');
  assert.equal(extractSentence('<think>never closed'), null);
  assert.equal(extractSentence('Here is the sentence:'), null);
  assert.equal(extractSentence('x'.repeat(300)), null);
  assert.equal(extractSentence(null), null);
  assert.equal(extractSentence('   '), null);
});

test('refiner without an API key returns the plain words', async () => {
  const r = await createRefiner({ apiKey: '', log: quiet })(['I', 'WATER', 'WANT']);
  assert.deepEqual(r, { text: 'I water want.', ai: false, reason: 'no-key' });
});

test('refiner returns the AI sentence on success and sends the key', async () => {
  let seen;
  const refine = createRefiner({
    apiKey: 'k', model: 'm', log: quiet,
    fetchFn: async (url, opts) => { seen = { url, opts }; return jsonRes(chat('I want some water.')); },
  });
  const r = await refine(['I', 'water', 'want'], 'English');
  assert.deepEqual(r, { text: 'I want some water.', ai: true });
  assert.equal(seen.opts.headers.Authorization, 'Bearer k');
  const body = JSON.parse(seen.opts.body);
  assert.equal(body.model, 'm');
  assert.equal(body.messages[1].content, 'I water want');
});

test('refiner falls back on HTTP errors, bad JSON shape, network errors and timeouts', async () => {
  const mk = (fetchFn) => createRefiner({ apiKey: 'k', model: 'm', log: quiet, fetchFn });
  assert.equal((await mk(async () => jsonRes({}, 500))(['a'])).reason, 'http-500');
  assert.equal((await mk(async () => jsonRes({ nothing: 1 }))(['a'])).reason, 'invalid-response');
  assert.equal((await mk(async () => jsonRes(chat(null)))(['a'])).reason, 'invalid-response');
  assert.equal((await mk(async () => { throw new Error('offline'); })(['a'])).reason, 'error');
  const timeout = await mk(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); })(['a']);
  assert.equal(timeout.reason, 'timeout');
  assert.equal(timeout.text, 'A.');
});

test('refiner retries once without chat_template_kwargs when the endpoint answers 400', async () => {
  const bodies = [];
  const refine = createRefiner({
    apiKey: 'k', model: 'm', log: quiet,
    fetchFn: async (u, o) => {
      const b = JSON.parse(o.body); bodies.push(b);
      return b.chat_template_kwargs ? jsonRes({ error: 'unknown field' }, 400) : jsonRes(chat('Hello there.'));
    },
  });
  assert.deepEqual(await refine(['hello']), { text: 'Hello there.', ai: true });
  assert.equal(bodies.length, 2);
  assert.ok(!bodies[1].chat_template_kwargs);
});

test('refiner limits concurrent AI calls', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const refine = createRefiner({ apiKey: 'k', model: 'm', maxInflight: 1, log: quiet, fetchFn: async () => { await gate; return jsonRes(chat('Ok.')); } });
  const first = refine(['a']);
  const second = await refine(['b']);
  assert.equal(second.reason, 'busy');
  release();
  assert.equal((await first).ai, true);
});

test('plainSentence capitalises and ends with a full stop', () => {
  assert.equal(plainSentence(['HELLO', 'FRIEND']), 'Hello friend.');
});

// ---------- config ----------
test('ICE servers are configurable from environment variables', () => {
  assert.equal(buildIceServers({ STUN_URLS: 'stun:a:1, stun:b:2', TURN_URLS: 'turn:t:3', TURN_USERNAME: 'u', TURN_CREDENTIAL: 'p' }).length, 2);
  const s = buildIceServers({ STUN_URLS: 'stun:a:1', TURN_URLS: 'turn:t:3,turns:t:4', TURN_USERNAME: 'u', TURN_CREDENTIAL: 'p' });
  assert.deepEqual(s[0].urls, ['stun:a:1']);
  assert.deepEqual(s[1], { urls: ['turn:t:3', 'turns:t:4'], username: 'u', credential: 'p' });
  assert.equal(buildIceServers({ PUBLIC_TURN: 'off' }).length, 1, 'public relay can be switched off');
  assert.equal(buildIceServers({}).length, 2, 'default has STUN plus the public relay');
});

test('firebase web config comes from env, falling back to the built-in project', () => {
  assert.equal(firebaseWebConfig({}), DEFAULT_FIREBASE_WEB);
  assert.equal(firebaseWebConfig({ FIREBASE_WEB_CONFIG: 'not json' }), DEFAULT_FIREBASE_WEB);
  assert.equal(firebaseWebConfig({ FIREBASE_WEB_CONFIG: '{"apiKey":"k","projectId":"p"}' }).projectId, 'p');
  const c = publicConfig({}, { googleSignIn: true });
  assert.equal(c.maxRoom, 8); assert.equal(c.googleSignIn, true);
  assert.ok(!JSON.stringify(c).includes('NVIDIA'));
});

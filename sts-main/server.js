/**
 * STS (Sign To Speech) - server
 * Express serves the web app. Socket.IO handles rooms, WebRTC signaling, chat and captions.
 * Event logic lives in lib/handlers.js so it can be tested without a network.
 */
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const { RoomStore } = require('./lib/rooms');
const { createAuthenticator } = require('./lib/auth');
const { createVerifier } = require('./lib/firebaseAdmin');
const { createRefiner } = require('./lib/ai');
const { publicConfig } = require('./lib/config');
const { registerHandlers } = require('./lib/handlers');

const env = process.env;
const verifyIdToken = createVerifier(env);
const authenticate = createAuthenticator({ verifyIdToken });
const refine = createRefiner({
  apiKey: env.NVIDIA_API_KEY,
  model: env.NVIDIA_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b',
});
const store = new RoomStore({ maxParticipants: 8 });
const config = publicConfig(env, { googleSignIn: !!verifyIdToken });

const app = express();
const origins = (env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
  });
  next();
});

// CORS for the Vercel frontend's requests to Express.
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    if (origin && !origins.includes(origin)) return res.sendStatus(403);
    return res.sendStatus(204);
  }

  next();
});

// Cheap on purpose: no AI, no Firebase, no database. Clients call this to detect a sleeping server.
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});
app.get('/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(config);
});
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

const io = new Server(server, {
  cors: origins.length ? { origin: origins } : undefined, // same-origin only unless CORS_ORIGIN is set
  pingInterval: 10000,
  pingTimeout: 15000,
  maxHttpBufferSize: 1e5,
});

io.on('connection', (socket) => {
  registerHandlers(io, socket, { store, authenticate, refine });
});

const PORT = env.PORT || 3000;
server.listen(PORT, () => console.log(`STS listening on :${PORT}`));

// Render sends SIGTERM on redeploy.
process.on('SIGTERM', () => {
  console.log('SIGTERM: shutting down');
  io.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
});

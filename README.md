# STS - Sign To Speech

Video calls where a signer's hand signs become live captions and voice, and a hearing person's speech becomes captions for the signer.

- `/` video calls: Google or guest sign-in, rooms of up to 8 people, live captions, quick phrases, chat, transcript
- `/translate.html` sign translator: camera, hand landmarks, editable text, speech

## Honest status

| Feature | Status |
|---|---|
| Video/audio calls (WebRTC mesh, max 8) | Implemented, browser-tested with 3 people (see Testing) |
| Google sign-in (Firebase) and guest access | Implemented. Google sign-in has NOT been tested against real Firebase |
| Live captions from speech (browser speech recognition) | Implemented. Not tested in a real browser |
| Quick phrases, chat, transcript, adjustable caption size | Implemented, browser-tested |
| Sign keywords to sentence with NVIDIA Nemotron | Implemented. Tested with a mocked API only. Falls back to plain words |
| Sign detection | **Demo only**: 7 generic hand shapes from MediaPipe, mapped to words. Not real ISL or ASL |
| Trained ISL / ASL model | **Not implemented.** See `model-research/README.md` |
| Continuous sign recognition | **Not implemented** |

## Run locally

```
npm install
npm start          # http://localhost:3000
```

Camera access needs HTTPS or `localhost`.

## Firebase (Google sign-in)

The project is `secret-keeper-8`; its public web config is built in. To use another project set `FIREBASE_WEB_CONFIG`.

1. Firebase console, Authentication, Sign-in method: enable **Google**.
2. Authentication, Settings, **Authorized domains**: add your Render domain, e.g. `sts.onrender.com`. Without this Google sign-in shows "This website is not authorised in Firebase yet".
3. Nothing else is needed on the server. Verifying ID tokens only needs the project id. `FIREBASE_SERVICE_ACCOUNT` is optional.

The server verifies every Google ID token with the Firebase Admin SDK before a socket may create or join rooms. Guests get a random temporary id; nothing is stored.

## Deploy on Render

1. Push this folder to GitHub.
2. Render, New, **Web Service**, pick the repo.
3. Settings: Runtime **Node**, Build `npm install`, Start `npm start`, Health Check Path `/health`.
4. Add environment variables (below), then deploy. Later pushes redeploy automatically.

| Variable | Required | Purpose |
|---|---|---|
| `NVIDIA_API_KEY` | for AI sentences | Key from build.nvidia.com. Without it captions show the plain keywords |
| `NVIDIA_MODEL` | no | Default `nvidia/nemotron-3-ultra-550b-a55b` |
| `FIREBASE_PROJECT_ID` | no | Default `secret-keeper-8` |
| `FIREBASE_WEB_CONFIG` | no | JSON of a Firebase web config, to use a different project |
| `FIREBASE_SERVICE_ACCOUNT` | no | Service account JSON (optional) |
| `STUN_URLS` | no | Comma list, default Google STUN |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | recommended | Your own TURN server for calls across strict networks |
| `PUBLIC_TURN` | no | Set `off` to disable the free public TURN relay (used only when `TURN_URLS` is empty; best effort) |
| `CORS_ORIGIN` | no | Only if the frontend is hosted on another domain |

TURN credentials are sent to every browser by design; use a TURN account meant for that. Never put the NVIDIA key or a service account in frontend code: they are only read by the server.

### Cold starts

`/health` is called as soon as the page opens, before any sign-in, and retried until the server answers (up to 90 s). While it waits a "Starting the server" screen shows. Everything else (config, Socket.IO, Firebase) starts only after the server is reachable, and the same Socket.IO connection is reused for sign-in and all rooms. `/health` does not touch NVIDIA or Firebase.

Because the web app and server are one Render service, Render itself shows its own waiting page before STS loads on a cold start. The STS wake screen covers restarts and dropped servers while the page is open. To host the frontend elsewhere, set `<meta name="sts-api" content="https://your-server.onrender.com">` in `public/index.html` and `CORS_ORIGIN` on the server.

## Testing

```
npm test            # 58 unit tests, no network
npm run test:e2e    # 21 browser tests (needs: npm i -g playwright && npx playwright install chromium)
```

Unit tests cover: input validation, rate limits, room store and the 8-person limit, guest and Google authentication (with a fake verifier), every Socket.IO event, signaling isolation between rooms, AI validation and fallback, ICE/env configuration, cold-start polling, speech-caption restarts, sign hold logic.

The end-to-end test drives real Chromium with real WebRTC between separate browser contexts, running the real client code and the real server event handlers. It covers: cold start screen, guest and Google flow, invalid room codes, create/join/leave/rejoin, video both ways, 3-person group call, mic/camera state, quick phrases, sign captions, AI replacement, chat, caption size, back button, network drop and automatic rejoin, translator page, mobile layout, no console errors.

**Not tested** (stand-ins were used, or it needs real services):
- Real Socket.IO networking and `server.js` itself (packages could not be installed in the build sandbox, so the first deploy is the first run of that file)
- Real Google sign-in and Firebase token verification
- Real NVIDIA responses (mocked)
- Render cold starts
- Real MediaPipe model and real cameras on phones
- Browser speech recognition and speech synthesis
- Calls across different networks (TURN)
- Camera flip on a real phone

## Known limitations

- Sign detection is a 7-gesture demo, not ISL/ASL.
- Mesh calls get heavy past about 4-5 people on phones.
- On some Android browsers, speech-to-text captions may compete with the call microphone.
- Google ID tokens are verified when you sign in, not again during a long session.
- Free Render sleeps when idle and keeps rooms in memory: a restart ends all rooms.

## Layout

```
server.js            Express + Socket.IO wiring
lib/                 handlers, rooms, auth, AI, config, validation, rate limits
public/index.html    call app           public/js/call/   call modules
public/translate.html translator        public/js/        shared modules
model-research/      model and licence research
test/                unit and end-to-end tests
```

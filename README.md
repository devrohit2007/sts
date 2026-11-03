# STS --- Sign To Speech

**STS (Sign To Speech)** is a real-time communication web app prototype
designed to make conversations easier between people who communicate
through gestures, speech, and text.

> **Prototype note:** The current gesture feature recognizes a limited
> set of supported gestures. It is not a complete Indian Sign Language
> (ISL) or American Sign Language (ASL) translation system.

## Live Demo

-   **Web app:** https://sts-virid-phi.vercel.app
-   **Backend:** https://sts-server-w1ps.onrender.com
-   **Health check:** https://sts-server-w1ps.onrender.com/health

The backend may take extra time to respond after inactivity when using a
free hosting instance.

## Features

-   Create and join communication rooms.
-   Browser-based audio/video calls using WebRTC.
-   Gesture-recognition demo for a limited set of implemented gestures.
-   Speech-to-text captions where supported by the browser.
-   Text-to-speech using browser speech synthesis.
-   Live text chat and quick phrases.
-   Optional AI-assisted text refinement through the configured NVIDIA
    API.
-   Google sign-in and guest access, depending on the enabled
    authentication configuration.
-   Responsive interface for supported desktop and mobile browsers.

Feature availability varies by browser, device permissions, lighting,
and network quality.

## How It Works

  -----------------------------------------------------------------------
  Component               Service                 Responsibility
  ----------------------- ----------------------- -----------------------
  Frontend                Vercel                  Hosts the static web
                                                  interface

  Backend                 Render                  Runs the
                                                  Node.js/Express server
                                                  and Socket.IO signaling

  Authentication          Firebase Authentication Handles Google
                                                  authentication

  AI text refinement      NVIDIA API              Optional
                                                  text-refinement
                                                  capability

  Real-time media         WebRTC                  Carries audio/video
                                                  when network conditions
                                                  allow
  -----------------------------------------------------------------------

Socket.IO handles room communication and WebRTC signaling. Audio/video
media is handled by WebRTC; depending on network conditions, media may
travel peer-to-peer or through a configured TURN relay.

## Tech Stack

-   HTML, CSS, JavaScript
-   Node.js and Express
-   Socket.IO
-   WebRTC
-   Firebase Authentication and Firebase Admin token verification
-   NVIDIA API (optional AI text refinement)
-   Browser camera, microphone, speech-recognition, and speech-synthesis
    APIs
-   Gesture-recognition components included in the project

## Run Locally

### Requirements

-   Node.js and npm
-   A Firebase project to test Google sign-in
-   An NVIDIA API key to use AI text refinement

### 1. Clone the repository

``` bash
git clone https://github.com/devrohit2007/sts.git
cd sts
```

### 2. Install dependencies

``` bash
npm install
```

### 3. Configure environment variables

Set environment variables in your local environment or hosting
dashboard. Create a local `.env` file only if the current project setup
loads it.

  -----------------------------------------------------------------------
  Variable                            Purpose
  ----------------------------------- -----------------------------------
  `PORT`                              Server port; hosting providers
                                      usually supply this automatically

  `CORS_ORIGIN`                       Comma-separated list of trusted
                                      frontend origins

  `NVIDIA_API_KEY`                    Secret key for the optional NVIDIA
                                      integration

  `NVIDIA_MODEL`                      Optional model identifier; the
                                      server has a default

  Firebase Admin settings             Credentials/configuration used by
                                      `lib/firebaseAdmin.js`

  Firebase public settings            Browser configuration defined by
                                      `lib/config.js`
  -----------------------------------------------------------------------

Check `lib/config.js` and `lib/firebaseAdmin.js` for the exact Firebase
variable names expected by this version. Do not guess variable names or
commit credentials.

The frontend backend URL is configured in `public/index.html` using the
`sts-api` meta tag. The current production value is:

``` html
<meta name="sts-api" content="https://sts-server-w1ps.onrender.com">
```

### 4. Start the server

Check `package.json` for the available scripts. If a `start` script
exists, run:

``` bash
npm start
```

Otherwise, start the entry point directly:

``` bash
node server.js
```

Open the local address printed by the server, commonly
`http://localhost:3000`.

Camera and microphone access generally require HTTPS or localhost, plus
browser permission.

## Deployment

### Backend --- Render

1.  Connect this GitHub repository to a Render Web Service.
2.  Select the `main` branch and Node environment.
3.  Set the build command to `npm install`.
4.  Set the start command to the script in `package.json` (commonly
    `npm start`).
5.  Add the required environment variables in Render's Environment
    settings.
6.  Set `CORS_ORIGIN` to the exact frontend origin:

``` text
https://sts-virid-phi.vercel.app
```

For multiple trusted frontend domains, separate origins with commas. Do
not add a trailing slash.

7.  Deploy and verify:

``` text
https://sts-server-w1ps.onrender.com/health
```

### Frontend --- Vercel

1.  Import the same GitHub repository into Vercel.
2.  Use the `Other` framework preset if no framework is detected.
3.  Set the output directory to `public`.
4.  Ensure the `sts-api` meta tag points to the Render backend.
5.  Add the Vercel domain to Firebase Authentication → Settings →
    Authorized domains.
6.  Deploy the frontend.

If the frontend domain changes, update both Firebase Authorized domains
and Render's `CORS_ORIGIN` allowlist.

## ASL Recognition (50 to 100 signs)

**Status: the engine is built and tested; no trained ASL model is included.** Until you train and add one, the Translator runs in demo mode (7 basic hand shapes, not real ASL).

-   Target vocabulary: 50 core + 50 extended ASL signs (`public/js/recognition/aslVocabulary.js`).
-   Pipeline: MediaPipe hand landmarks, then a small sequence model (ONNX) run in the browser with ONNX Runtime Web.
-   The Translator shows camera preview, hand status, recognised sign, English meaning, confidence, and "Unknown or unsupported sign". Signs below 70% confidence, or too close to the runner-up, are never translated. A cooldown stops repeated words.
-   Training code: `training/` (signer-disjoint split, test set used once). Read `training/README.md`, including the dataset licence warning.
-   Accuracy is shown only from a real `metrics.json` produced by that training run.

## Security Notes

-   Never commit `.env` files, API keys, Firebase service-account JSON
    files, private keys, or TURN passwords.
-   Keep `NVIDIA_API_KEY` and Firebase Admin credentials in Render's
    Environment settings.
-   Do not expose permanent TURN credentials in a public configuration
    endpoint. Prefer a TURN provider that issues short-lived
    credentials.
-   A Firebase browser API key and project ID are client configuration;
    they do not replace Firebase Security Rules or authentication.
-   Restrict database rules to the access the application actually
    needs.
-   Configure CORS with only trusted frontend origins. CORS is not an
    authentication mechanism.
-   If a secret has been exposed publicly, rotate it with its provider.
    Removing it from source code alone is not enough.

## Browser and Network Notes

-   Users must grant camera and microphone permissions.
-   Speech recognition and speech synthesis support differs between
    browsers.
-   WebRTC calls require a stable network and may need correctly
    configured STUN/TURN servers on restrictive networks.
-   A free Render instance may sleep after inactivity, so the first
    backend request can take longer while the service wakes up.
-   Vercel can serve the frontend while Render is waking, but
    backend-dependent features must wait for the backend.

## Current Scope and Limitations

STS is a hackathon prototype, not a certified accessibility or
sign-language interpretation product.

-   Without a trained model, gesture recognition covers only 7 basic demo
    shapes. A trained ASL model must be added (see ASL Recognition).
-   Accuracy can vary with lighting, camera quality, hand position, and
    movement.
-   Browser speech features are not supported identically across
    browsers and languages.
-   Call quality depends on device capability, network conditions, and
    relay configuration.
-   Do not rely on this prototype for emergency, medical, legal, or
    other high-stakes communication.

## Project Structure

-   `public/` --- frontend pages, styles, and browser-side JavaScript
-   `lib/` --- server-side authentication, configuration, rooms, AI,
    validation, and event logic
-   `server.js` --- Express and Socket.IO server entry point
-   `test/` --- automated tests
-   `package.json` --- Node.js dependencies and scripts

Refer to the source files for the exact implementation and configuration
expected by the current version.

## Contributing

This project is a hackathon prototype. Suggestions, bug reports, and
improvements are welcome.

1.  Explain the issue or proposed improvement.
2.  Keep changes focused and do not include secrets.
3.  Test affected features where possible.
4.  Be clear about what has and has not been tested.

## Acknowledgements

Built with open web technologies and services including Node.js,
Express, Socket.IO, WebRTC, Firebase, and NVIDIA API services.

------------------------------------------------------------------------

**STS --- Sign To Speech**\
*Making conversations more accessible through gestures, speech, and
text.*

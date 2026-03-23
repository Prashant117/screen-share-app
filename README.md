# Screen Share App (Google Meet Clone)

A production-grade, low-latency WebRTC meeting application with an SFU architecture and live ephemeral room messaging. It acts as a Google Meet clone where all users are participants capable of sharing their webcams, microphones, and screens simultaneously.

## New Monorepo Layout

screen-share-app/
- screenShare-client/
- screenShare-server/
- docker-compose.yml
- README.md
- package.json

## Why the Split?
- Clear separation of concerns and independent deployability.
- Easier local development with independent `dev` servers.
- Keeps browser-only code out of the server and vice versa.

## Core Features (Many-To-Many Architecture)
- **Unified Meeting Room:** Anyone can be a participant, share their camera, microphone, and screen simultaneously.
- **Dynamic Grid Layout:** Participants are displayed in an expanding grid view.
- **Google Meet Controls:** Mute Mic, Stop Camera, Share Screen, Chat, leave meeting.
- **Participant State:** Accurately track number of participants and their states.

## Apps

### screenShare-client (React + Vite + Tailwind + Zustand)
- Pages: Home, MeetingRoom (Unified multi-participant grid)
- WebRTC client flow: create transports, produce/consume tracks (video, audio, screen) with mediasoup-client
- Ephemeral live chat via Socket.IO
- Env: `.env.example` with `VITE_SERVER_URL` / `VITE_SOCKET_URL`
- Start:
  ```bash
  cd screenShare-client
  npm install
  npm run dev
  ```

### screenShare-server (Node.js + Express + Socket.IO + mediasoup)
- SFU: mediasoup workers/routers/transports supporting many-to-many forwarding.
- Room and peer management, lifecycle and cleanup. Any participant joining creates a new Peer capable of producing & consuming.
- Signaling and ephemeral chat fanout via Socket.IO.
- Health endpoint: GET /health
- Env: `.env.example` with `PORT`, `CLIENT_URL`, `LISTEN_IP`, `ANNOUNCED_IP`, and mediasoup port range
- Start (dev):
  ```bash
  cd screenShare-server
  npm install
  npm run dev
  ```

## Root Scripts
From `screen-share-app` root:
```bash
npm run install:all   # installs in both apps
npm run dev           # runs client and server concurrently (shell background)
npm run dev:client    # client only
npm run dev:server    # server only
npm run build         # builds both
```

## Docker Compose
`docker-compose.yml` includes:
- screenShare-server (Node/mediasoup)
- coturn for TURN/STUN
- optional client dev service

Start:
```bash
docker-compose up -d
```

## Latency Notes
- Uses WebRTC over UDP (where possible) and SFU routing for low latency.
- Real-world latency varies by network, CPU, TURN relaying, and geography.

## Security & Robustness
- Input validation on socket events and messages (trim, length)
- Basic per-socket rate-limit for chat
- CORS configurable via `CLIENT_URL`
- Messages are ephemeral: no persistence, no replay

## Scaling Notes
- mediasoup SFU supports adding more workers/routers
- Add simulcast/SVC and bitrate controls for mixed network conditions

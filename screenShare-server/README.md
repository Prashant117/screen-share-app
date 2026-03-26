# Aiken Meet — Server (screenShare-server)

## Overview
- Node.js + Express + Socket.IO + `mediasoup`
- Provides SFU signaling and media routing for low-latency screen/camera sharing
- Responsibilities:
  - Room and peer lifecycle management
  - WebRTC transport creation/connection
  - Producer/consumer coordination
  - Ephemeral in-room messaging

## Architecture
- Core modules:
  - `rooms/RoomManager.ts`: manages room instances
  - `rooms/Room.ts`: mediasoup Router, transports, produce/consume logic
  - `peers/Peer.ts`: per-socket peer state, transports, producers, consumers
  - `sockets/index.ts`: Socket.IO event handlers and room coordination
  - `config/index.ts`: CORS and mediasoup settings
  - `mediasoup/index.ts`: worker lifecycle
- Data flow:
  - Client connects via Socket.IO, joins/creates a room
  - Server creates send/recv transports per peer
  - When peer produces, server announces `newProducer` to other peers
  - Consumers are created paused, then resumed on request to avoid race conditions

## Environment (.env)
Recommended variables:
```
PORT=3000
LISTEN_IP=0.0.0.0
ANNOUNCED_IP=127.0.0.1
CLIENT_URLS=*
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
```
- `ANNOUNCED_IP`: set to the server’s LAN/WAN IP reachable by clients
- `CLIENT_URLS`: comma-separated origins for CORS (use `*` for dev)
- For production/WAN, configure and use TURN (coturn) and open UDP ports

## Scripts
- Install: `npm install`
- Dev (nodemon): `npm run dev`
- Build: `npm run build`
- Start (prod): `npm start`
- Lint: `npm run lint`

## Socket.IO Event Contract
- Client → Server:
  - `createRoom`: create a new room
  - `joinRoom`: join existing or auto-create room
  - `createWebRtcTransport`: create send/recv transport
  - `connectTransport`: DTLS connect for a given transport
  - `produce`: publish audio/video/screen
  - `getProducers`: list active producers in room
  - `consume`: request consumer params for a producer
  - `resumeConsumer`: resume a paused consumer
  - `closeProducer`: stop publishing a given producer
  - `stopScreenShare`: legacy no-op; `closeProducer` is preferred
  - `sendRoomMessage`: ephemeral chat
  - `raiseHand`: signal hand raise/lower
  - `leaveRoom`: leave current room
- Server → Client:
  - `participantJoined` / `participantLeft` / `participantCountUpdated`
  - `newProducer` / `producerClosed`
  - `roomMessage` / `systemMessage`

## Typical Local Run
1. In `screenShare-server`:
   - `npm install`
   - `npm run dev`
2. The server listens on `http://0.0.0.0:3000`
3. Health check: `GET /health` → `{ "status": "ok" }`

## LAN Notes
- Set `ANNOUNCED_IP` to the server machine’s LAN IP
- Ensure client uses the server’s LAN URL (e.g. `http://192.168.1.10:3000`)
- Open mediasoup UDP range if testing across subnets/NATs; use TURN for WAN

## Docker (optional)
- A `Dockerfile` is provided as a starting point. Mediasoup requires UDP ports; ensure you map and allow the configured RTP port range when containerizing.


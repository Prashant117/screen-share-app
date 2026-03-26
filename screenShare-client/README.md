# Aiken Meet — Client (screenShare-client)

## Overview
- React + TypeScript + Vite + Tailwind CSS + Zustand + React Router
- Integrates `socket.io-client` for signaling and `mediasoup-client` for WebRTC SFU reception
- Responsibilities:
  - Room create/join UI
  - Device and screen capture via `getUserMedia` / `getDisplayMedia`
  - mediasoup send/recv transports management
  - Rendering local and remote tiles (camera/screen) and audio
  - Live ephemeral in-room chat and basic controls

## Key Files
- `src/pages/Home.tsx`: room create/join flow
- `src/pages/MeetingRoom.tsx`: call UI, tiles, controls, join/consume logic
- `src/services/webrtc.ts`: mediasoup-client device, transports, produce/consume
- `src/services/socket.ts`: Socket.IO client creation
- `src/store/useAppStore.ts`: global app state (peers, streams, messages)

## Environment
Set either of the following in `.env` or your shell:
- `VITE_SOCKET_URL` (recommended): full Socket.IO URL (e.g. `http://localhost:3000`)
- `VITE_SERVER_URL`: fallback if `VITE_SOCKET_URL` isn’t set

Example `.env`:
```
VITE_SOCKET_URL=http://localhost:3000
```

For LAN testing, point this to your server host’s LAN IP (e.g. `http://192.168.1.10:3000`), and start Vite with host exposure.

## Scripts
- Install: `npm install`
- Dev (local): `npm run dev`
- Dev (LAN): `npm run dev -- --host`
- Build: `npm run build`
- Preview build: `npm run preview`
- Lint: `npm run lint`

## Typical Local Run
1. Ensure server is running at `http://localhost:3000`
2. In `screenShare-client`:
   - `npm install`
   - `npm run dev`
3. Open `http://localhost:5173/`

## Typical LAN Run
1. Server host:
   - Ensure server ANNOUNCED_IP is set to the host’s LAN IP
2. Client machines:
   - Set `VITE_SOCKET_URL` to the server host’s LAN URL (e.g. `http://192.168.1.10:3000`)
   - Start with `npm run dev -- --host`
   - Open the provided Network URL from Vite (e.g. `http://192.168.1.20:5173/`)

## How It Works (Client-Side)
- On join:
  - Connects to Socket.IO server
  - Loads mediasoup Device with router RTP caps
  - Creates send and recv transports
  - Immediately consumes any already-present producers (from join response)
  - Performs a follow-up sync (`getProducers`) for safety
  - Produces local audio/video when enabled; produces screen when sharing
- On new producer:
  - Ensures a peer entry exists, then consumes and attaches the track to the UI
- On producer closed:
  - Clears the corresponding track/tile

## Troubleshooting
- Browser permissions:
  - Microphone/Camera access requires HTTPS or `localhost`
  - Screen share requires HTTPS on some browsers
- Audio autoplay:
  - Remote audio may require user gesture before playback depending on browser policies
- LAN/WAN:
  - Ensure the server’s `ANNOUNCED_IP` matches the IP visible to clients
  - Use TURN (coturn) for WAN/NAT traversal in real-world scenarios


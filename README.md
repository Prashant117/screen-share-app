# Screen Share App

A production-minded low-latency screen sharing application built with **React**, **Node.js**, **WebRTC**, **mediasoup**, and **Socket.IO**.

The platform supports:
- one-to-many screen sharing
- multiple rooms
- multiple concurrent users
- optional audio sharing
- live ephemeral room messaging
- low-latency media delivery over WebRTC
- scalable SFU-based architecture

This project is designed as a serious MVP, not a toy demo.

---

## Features

### Core
- Create room
- Join room as broadcaster or viewer
- Share screen with remote participants
- Multiple viewers in the same room
- Multiple active rooms at the same time
- Viewer count updates
- Broadcaster start/stop controls
- Realtime connection state updates

### Media
- Screen sharing using `getDisplayMedia()`
- WebRTC media transport
- SFU architecture using **mediasoup**
- UDP-based delivery through WebRTC where possible
- TURN/STUN support for NAT traversal

### Live Messaging
- Room-based live chat
- Ephemeral messages only
- No DB storage
- No replay to late joiners
- Messages vanish on disconnect / session end
- System messages for join, leave, start share, stop share

### Reliability / Engineering
- Clean frontend/backend separation
- Environment-based config
- Socket event contract
- Health endpoint
- Graceful cleanup on disconnect
- Docker-based local setup support

---

## Tech Stack

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- React Router
- Socket.IO client
- mediasoup-client
- WebRTC browser APIs

### Backend
- Node.js
- Express
- TypeScript
- Socket.IO
- mediasoup
- UUID

### Infra
- coturn
- Docker Compose

---

## Architecture

## Why this architecture

This application uses an **SFU (Selective Forwarding Unit)** architecture instead of peer-to-peer mesh.

### Why not mesh
Mesh does not scale well for one-to-many screen sharing:
- broadcaster uploads separate streams to each viewer
- CPU and bandwidth usage grows fast
- performance degrades quickly as users increase

### Why SFU
With SFU:
- broadcaster sends one upstream media stream
- server forwards media to multiple viewers
- lower sender bandwidth
- better scalability for multi-user rooms
- cleaner control over rooms, peers, and stream lifecycle

### Why mediasoup
`mediasoup` was chosen because it gives:
- strong control over WebRTC transport lifecycle
- scalable SFU behavior
- production-grade media routing
- Node.js integration
- flexibility for custom room and signaling logic

---

## High-Level Architecture

```text
+-------------------+         Socket.IO Signaling         +----------------------+
|   React Client    |  <--------------------------------> |   Node.js Server     |
|                   |                                      |  Express + Socket.IO |
| - Home / Join UI  |                                      | - Room Manager       |
| - Broadcaster UI  |                                      | - Peer Manager       |
| - Viewer UI       |                                      | - mediasoup Worker   |
| - Chat Panel      |                                      | - mediasoup Router   |
| - mediasoup-client|                                      | - Transport Handling |
+---------+---------+                                      +----------+-----------+
          |                                                           |
          |                 WebRTC Media Transport                     |
          +-----------------------------------------------------------+
                                  via mediasoup SFU
                                           |
                                           v
                                     +-----------+
                                     |  coturn   |
                                     | STUN/TURN |
                                     +-----------+
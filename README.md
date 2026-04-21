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



## Application Flow

### Broadcaster Flow
- User creates or joins a room as broadcaster
- Frontend connects to backend over Socket.IO
- Frontend requests WebRTC transport creation
- User starts screen sharing via `navigator.mediaDevices.getDisplayMedia()`
- Frontend creates a producer transport
- Screen video track is produced to mediasoup
- Backend marks the broadcaster as active in that room
- Viewers are notified that a producer is available

### Viewer Flow
- User joins a room as viewer
- Frontend connects via Socket.IO
- Frontend requests receive transport creation
- When broadcaster is live, server notifies viewers
- Viewer creates a consumer for the producer
- Consumed media track is attached to a MediaStream
- Stream is rendered in a video element

### Messaging Flow
- User sends a room message
- Client emits message via Socket.IO
- Server validates payload
- Server broadcasts message to currently connected room participants
- Message is rendered in client chat panel
- Message is not stored or replayed later

## Frontend Responsibilities
The React frontend is responsible for:
- Room create/join UI
- Broadcaster and viewer pages
- Local screen capture with `getDisplayMedia()`
- `mediasoup-client` transport handling
- Receiving and rendering remote media
- Connection and status indicators
- Live ephemeral chat UI
- Room lifecycle cleanup on leave/disconnect

## Backend Responsibilities
The Node.js backend is responsible for:
- Express server setup
- Socket.IO signaling
- mediasoup worker/router lifecycle
- Room creation and room lookup
- Peer lifecycle management
- Transport creation/connection
- Producer and consumer coordination
- Viewer count updates
- Broadcaster status tracking
- Ephemeral message fanout
- Cleanup when users disconnect

## Room Model
### Each Room Maintains
- Room ID
- mediasoup router
- Peer collection
- Active broadcaster state
- Current producer(s)
- Transient state required for active session handling

### Each Peer Maintains
- Socket ID
- Display name
- Role (broadcaster or viewer)
- Send/recv transports
- Producers
- Consumers

## WebSocket / Socket.IO Details
Socket.IO is used for:
- Signaling
- Room coordination
- Ephemeral live messaging

It is not used for media transport. Media always flows over WebRTC, not over WebSockets.

### Client -> Server Events
- `createRoom`
- `joinRoom`
- `createWebRtcTransport`
- `connectTransport`
- `startScreenShare`
- `consume`
- `resumeConsumer`
- `stopScreenShare`
- `leaveRoom`
- `sendRoomMessage`

### Server -> Client Events
- `roomCreated`
- `joinedRoom`
- `transportCreated`
- `screenShareStarted`
- `newProducer`
- `consumed`
- `viewerCountUpdated`
- `broadcasterStopped`
- `roomMessage`
- `systemMessage`
- `errorMessage`

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
```

---

## Step-by-Step Guide to Run This Project

This guide will walk you through setting up and running the Screen Share App locally.

### Prerequisites

Before you begin, ensure you have the following installed:
-   **Node.js**: Version 18 or higher (includes npm).
-   **Git**: For cloning the repository.
-   **Docker and Docker Compose** (Optional, for running coturn or other services).

### 1. Clone the Repository

First, clone the project repository to your local machine:

```bash
git clone <repository-url>
cd screen-share-app
```
*(Replace `<repository-url>` with the actual URL of your repository)*

### 2. Install Dependencies

The project is structured as a monorepo with a client and a server. You need to install dependencies for both.

```bash
# Install dependencies for both client and server
npm install --prefix screenShare-client
npm install --prefix screenShare-server
```

### 3. Environment Configuration

#### Server (`screenShare-server`)

Create a `.env` file in the `screenShare-server` directory with the following content:

```
PORT=3000
LISTEN_IP=0.0.0.0
ANNOUNCED_IP=127.0.0.1
CLIENT_URLS=http://localhost:5173,http://localhost:5174,http://localhost:5175
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
```

-   **`PORT`**: The port the server will listen on.
-   **`LISTEN_IP`**: The IP address the server will bind to. `0.0.0.0` makes it accessible from any network interface.
-   **`ANNOUNCED_IP`**: **Crucial for WebRTC**. This should be the IP address that clients can use to reach your server.
    -   For local testing on the same machine, `127.0.0.1` is fine.
    -   For LAN testing (other devices on your network), set this to your machine's local IP address (e.g., `192.168.1.100`).
-   **`CLIENT_URLS`**: A comma-separated list of origins that are allowed to connect to your Socket.IO server. Include all client URLs you might use for testing.
-   **`MEDIASOUP_MIN_PORT` / `MEDIASOUP_MAX_PORT`**: Port range for mediasoup RTP traffic. Ensure these ports are open if you have a firewall.

#### Client (`screenShare-client`)

Create a `.env` file in the `screenShare-client` directory with the following content:

```
VITE_SERVER_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
```

-   **`VITE_SERVER_URL`**: The base URL for API requests (e.g., health checks).
-   **`VITE_SOCKET_URL`**: The URL for the Socket.IO connection.
    -   For local testing, `http://localhost:3000` is typical.
    -   For LAN testing, change this to the `ANNOUNCED_IP` and `PORT` of your server (e.g., `http://192.168.1.100:3000`).

### 4. Run the Server

Navigate to the `screenShare-server` directory and start the development server:

```bash
cd screenShare-server
npm run dev
```

You should see output indicating that mediasoup workers are created and the server is listening on the configured IP and port.

### 5. Run the Client

In a new terminal, navigate to the `screenShare-client` directory and start the development client:

```bash
cd screenShare-client
npm run dev
```

Vite will start the client and provide a local URL (e.g., `http://localhost:5173/`). If port 5173 is in use, it will automatically pick another (e.g., `http://localhost:5174/`).

**For LAN Testing (Client)**: If you want other devices on your network to access the client, you need to expose the Vite development server:

```bash
npm run dev -- --host
```

Vite will then provide a network URL (e.g., `http://192.168.1.100:5173/`).

### 6. Test the Application

1.  Open your web browser and navigate to the client URL (e.g., `http://localhost:5173/`).
2.  Enter a display name and click "Create New Room" or "Join Room" with an existing Room ID.
3.  Open a second browser tab/window (or another device for LAN testing) and join the same room.
4.  Enable your camera and/or start screen sharing on one side.
5.  Verify that the other participant(s) can see the shared camera feed and/or screen.
6.  Test chat functionality, mic/video toggles, and leaving the room.

---

This comprehensive guide should help you get the project up and running smoothly.

import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { roomManager } from '../rooms/RoomManager';
import { Peer } from '../peers/Peer';

export function setupSockets(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);
    let currentRoomId: string | null = null;
    let messageTimestamps: number[] = [];

    socket.on('createRoom', async ({ displayName }, callback) => {
      try {
        const roomId = uuidv4().slice(0, 8);
        const room = await roomManager.createRoom(roomId);
        const peer = new Peer(socket.id, displayName);
        room.addPeer(peer);
        
        socket.join(roomId);
        currentRoomId = roomId;

        callback({ 
          roomId,
          routerRtpCapabilities: room.router.rtpCapabilities
        });
        console.log(`Room ${roomId} created by ${socket.id}`);
      } catch (err: any) {
        callback({ error: err.message });
      }
    });

    socket.on('joinRoom', async ({ roomId, displayName }, callback) => {
      try {
        let room = roomManager.getRoom(roomId);
        if (!room) {
          // Auto-create room if it doesn't exist yet (first participant)
          room = await roomManager.createRoom(roomId);
        }

        const peer = new Peer(socket.id, displayName);
        room.addPeer(peer);

        socket.join(roomId);
        currentRoomId = roomId;

        const peersInfo = room.getPeers()
          .filter(p => p.socketId !== socket.id)
          .map(p => ({
            socketId: p.socketId,
            displayName: p.displayName
          }));
        
        const existingProducers: any[] = [];
        room.getPeers().forEach(p => {
          if (p.socketId === socket.id) return;
          p.producers.forEach(prod => {
            existingProducers.push({
              producerId: prod.id,
              socketId: p.socketId,
              kind: (prod.appData as any)?.customKind || (prod as any).kind
            });
          });
        });
        
        callback({
          room: {
            roomId: room.id,
            participantCount: room.getPeers().length
          },
          peers: peersInfo,
          routerRtpCapabilities: room.router.rtpCapabilities,
          producers: existingProducers
        });

        socket.to(roomId).emit('participantJoined', {
          socketId: socket.id,
          displayName
        });

        io.to(roomId).emit('participantCountUpdated', {
          count: room.getPeers().length
        });

        io.to(roomId).emit('systemMessage', {
          id: uuidv4(),
          content: `${displayName || 'A viewer'} joined the room`,
          timestamp: Date.now()
        });

      } catch (err: any) {
        callback({ error: err.message });
      }
    });

    socket.on('createWebRtcTransport', async ({ forceTcp }, callback) => {
      try {
        if (!currentRoomId) throw new Error('Not in a room');
        const room = roomManager.getRoom(currentRoomId);
        if (!room) throw new Error('Room not found');

        const transportInfo = await room.createWebRtcTransport(socket.id, forceTcp);
        callback(transportInfo);
      } catch (err: any) {
        callback({ error: err.message });
      }
    });

    socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
      try {
        if (!currentRoomId) throw new Error('Not in a room');
        const room = roomManager.getRoom(currentRoomId);
        if (!room) throw new Error('Room not found');

        await room.connectPeerTransport(socket.id, transportId, dtlsParameters);
        callback({ success: true });
      } catch (err: any) {
        callback({ error: err.message });
      }
    });

    socket.on('getRouterRtpCapabilities', (callback) => {
      try {
        if (!currentRoomId) throw new Error('Not in a room');
        const room = roomManager.getRoom(currentRoomId);
        if (!room) throw new Error('Room not found');
        callback({ routerRtpCapabilities: room.router.rtpCapabilities });
      } catch (err: any) {
        callback({ error: err.message });
      }
    });

    // (removed duplicate getProducers handler; see unified implementation further below)

    socket.on('produce', async ({ transportId, kind, rtpParameters, appData }, callback) => {
      try {
        if (!currentRoomId) throw new Error('Not in a room');
        const room = roomManager.getRoom(currentRoomId);
        if (!room) throw new Error('Room not found');

        const producerPeer = room.getPeer(socket.id);
        if (!producerPeer) {
          return callback({ error: 'Peer not found' });
        }

        const producerId = await room.produce(socket.id, transportId, rtpParameters, kind, appData);
        
        callback({ id: producerId });

        socket.to(currentRoomId).emit('newProducer', {
          producerId,
          socketId: socket.id,
          kind: appData?.customKind || kind
        });

      } catch (err: any) {
        callback({ error: err.message });
      }
    });

    socket.on('getProducers', (callback) => {
      try {
        if (!currentRoomId) return callback([]);
        const room = roomManager.getRoom(currentRoomId);
        if (!room) return callback([]);

        const producers: any[] = [];
        room.getPeers().forEach(peer => {
          if (peer.socketId === socket.id) return;
          peer.producers.forEach(producer => {
            producers.push({
              producerId: producer.id,
              socketId: peer.socketId,
              kind: producer.appData?.customKind || producer.kind
            });
          });
        });
        callback(producers);
      } catch (err) {
        callback([]);
      }
    });

    socket.on('closeProducer', async ({ producerId }, callback) => {
      try {
        if (!currentRoomId) throw new Error('Not in a room');
        const room = roomManager.getRoom(currentRoomId);
        if (!room) throw new Error('Room not found');

        const peer = room.getPeer(socket.id);
        if (peer) {
          const producer = peer.getProducer(producerId);
          if (producer) {
            const kind = (producer.appData?.customKind || producer.kind) as string;
            producer.close();
            peer.producers.delete(producerId);
            // notify others that this producer is gone so they can clear tiles
            socket.to(currentRoomId).emit('producerClosed', {
              socketId: socket.id,
              producerId,
              kind
            });
          }
        }
        if (callback) callback({ success: true });
      } catch (err: any) {
        if (callback) callback({ error: err.message });
      }
    });

    socket.on('consume', async ({ transportId, producerId, rtpCapabilities }, callback) => {
      try {
        if (!currentRoomId) throw new Error('Not in a room');
        const room = roomManager.getRoom(currentRoomId);
        if (!room) throw new Error('Room not found');

        const consumeResponse = await room.consume(socket.id, transportId, producerId, rtpCapabilities);
        callback(consumeResponse);
      } catch (err: any) {
        callback({ error: err.message });
      }
    });

    socket.on('resumeConsumer', async ({ consumerId }, callback) => {
      try {
        if (!currentRoomId) throw new Error('Not in a room');
        const room = roomManager.getRoom(currentRoomId);
        if (!room) throw new Error('Room not found');

        const peer = room.getPeer(socket.id);
        if (peer) {
          const consumer = peer.getConsumer(consumerId);
          if (consumer) {
            await consumer.resume();
            return callback({ success: true });
          }
        }
        callback({ error: 'Consumer not found' });
      } catch (err: any) {
        callback({ error: err.message });
      }
    });

    socket.on('stopScreenShare', async (_, callback) => {
      try {
        if (!currentRoomId) throw new Error('Not in a room');
        const room = roomManager.getRoom(currentRoomId);
        if (!room) throw new Error('Room not found');

        // This is deprecated, we prefer closeProducer instead. 
        // We'll leave it as a no-op or only log to avoid closing audio/video.
        console.log(`stopScreenShare called by ${socket.id}, ignoring to prevent breaking other tracks.`);
        
        callback({ success: true });
      } catch (err: any) {
        callback({ error: err.message });
      }
    });

    socket.on('sendRoomMessage', ({ content }, callback) => {
      if (!currentRoomId) return callback({ error: 'Not in a room' });
      const room = roomManager.getRoom(currentRoomId);
      if (!room) return callback({ error: 'Room not found' });

      const peer = room.getPeer(socket.id);
      if (!peer) return callback({ error: 'Peer not found' });

      const trimmed = content.trim();
      if (!trimmed) return callback({ error: 'Empty message' });
      if (trimmed.length > 500) return callback({ error: 'Message too long' });

      const now = Date.now();
      messageTimestamps = messageTimestamps.filter(ts => now - ts < 3000);
      if (messageTimestamps.length >= 5) {
        return callback({ error: 'Rate limit exceeded. Please slow down.' });
      }
      messageTimestamps.push(now);

      const message = {
        id: uuidv4(),
        senderId: socket.id,
        displayName: peer.displayName || 'Participant',
        content: trimmed,
        timestamp: Date.now(),
        type: 'user'
      };

      io.to(currentRoomId).emit('roomMessage', message);
      callback({ success: true });
    });

    socket.on('raiseHand', ({ raised }, callback) => {
      if (!currentRoomId) return callback && callback({ error: 'Not in a room' });
      const room = roomManager.getRoom(currentRoomId);
      if (!room) return callback && callback({ error: 'Room not found' });
      const peer = room.getPeer(socket.id);
      if (!peer) return callback && callback({ error: 'Peer not found' });
      io.to(currentRoomId).emit('handRaised', {
        socketId: socket.id,
        displayName: peer.displayName || 'Participant',
        raised: !!raised,
        timestamp: Date.now()
      });
      callback && callback({ success: true });
    });

    socket.on('leaveRoom', (callback) => {
      if (!currentRoomId) return callback && callback({ success: true });
      const roomId = currentRoomId;
      const room = roomManager.getRoom(roomId);
      currentRoomId = null;
      socket.leave(roomId);
      if (room) {
        const peer = room.getPeer(socket.id);
        const displayName = peer?.displayName || 'A participant';

        room.removePeer(socket.id);

        const count = room.getPeers().length;
        io.to(roomId).emit('participantCountUpdated', { count });
        
        socket.to(roomId).emit('participantLeft', { socketId: socket.id });
        io.to(roomId).emit('systemMessage', {
          id: uuidv4(),
          content: `${displayName} left the room`,
          timestamp: Date.now()
        });

        if (room.getPeers().length === 0) {
          roomManager.removeRoom(roomId);
        }
      }
      callback && callback({ success: true });
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
      if (currentRoomId) {
        const room = roomManager.getRoom(currentRoomId);
        if (room) {
          const peer = room.getPeer(socket.id);
          const displayName = peer?.displayName || 'A participant';

          room.removePeer(socket.id);

          const count = room.getPeers().length;
          io.to(currentRoomId).emit('participantCountUpdated', { count });
          
          socket.to(currentRoomId).emit('participantLeft', { socketId: socket.id });
          io.to(currentRoomId).emit('systemMessage', {
            id: uuidv4(),
            content: `${displayName} left the room`,
            timestamp: Date.now()
          });

          if (room.getPeers().length === 0) {
            roomManager.removeRoom(currentRoomId);
          }
        }
      }
    });
  });
}

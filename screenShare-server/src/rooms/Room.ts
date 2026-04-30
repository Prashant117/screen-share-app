import * as mediasoup from 'mediasoup';
import { Peer } from '../peers/Peer';
import { getMediasoupWorker } from '../mediasoup';
import { config } from '../config';

export class Room {
  id: string;
  router!: mediasoup.types.Router;
  peers: Map<string, Peer>;

  constructor(roomId: string) {
    this.id = roomId;
    this.peers = new Map();
  }

  static async create(roomId: string) {
    const room = new Room(roomId);
    const worker = getMediasoupWorker();
    room.router = await worker.createRouter({
      mediaCodecs: config.mediasoup.router.mediaCodecs as mediasoup.types.RtpCodecCapability[],
    });
    return room;
  }

  addPeer(peer: Peer) {
    // Close any stale peer with the same socket ID before overwriting (e.g. reconnect)
    const existing = this.peers.get(peer.socketId);
    if (existing) {
      try { existing.close(); } catch {}
    }
    this.peers.set(peer.socketId, peer);
  }

  getPeer(socketId: string) {
    return this.peers.get(socketId);
  }

  removePeer(socketId: string) {
    const peer = this.peers.get(socketId);
    if (!peer) return;

    // Close consumers on other peers that were consuming this peer's producers
    const leavingProducerIds = new Set(peer.producers.keys());
    if (leavingProducerIds.size > 0) {
      this.peers.forEach(otherPeer => {
        if (otherPeer.socketId === socketId) return;
        otherPeer.consumers.forEach((consumer, consumerId) => {
          if (leavingProducerIds.has(consumer.producerId)) {
            try { consumer.close(); } catch {}
            otherPeer.consumers.delete(consumerId);
          }
        });
      });
    }

    peer.close();
    this.peers.delete(socketId);
  }

  getPeers() {
    return Array.from(this.peers.values());
  }

  async createWebRtcTransport(socketId: string, forceTcp = false) {
    const {
      listenIps,
      initialAvailableOutgoingBitrate,
      maxSctpMessageSize,
    } = config.mediasoup.webRtcTransport;

    const peer = this.getPeer(socketId);
    if (!peer) throw new Error(`Peer ${socketId} not found`);

    const transport = await this.router.createWebRtcTransport({
      listenIps: listenIps as mediasoup.types.TransportListenIp[],
      enableUdp: !forceTcp,
      enableTcp: true,
      preferUdp: !forceTcp,
      initialAvailableOutgoingBitrate,
      maxSctpMessageSize,
    });

    const closeAndRemove = () => {
      peer.transports.delete(transport.id);
      try { transport.close(); } catch {}
    };

    transport.on('dtlsstatechange', dtlsState => {
      if (dtlsState === 'closed') closeAndRemove();
    });

    transport.on('icestatechange', (iceState: string) => {
      if (iceState === 'failed') closeAndRemove();
    });

    peer.addTransport(transport);

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectPeerTransport(socketId: string, transportId: string, dtlsParameters: any) {
    const peer = this.getPeer(socketId);
    if (!peer) throw new Error(`Peer ${socketId} not found`);

    const transport = peer.getTransport(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);

    await transport.connect({ dtlsParameters });
  }

  async produce(socketId: string, transportId: string, rtpParameters: any, kind: any, appData: any = {}) {
    const peer = this.getPeer(socketId);
    if (!peer) throw new Error(`Peer ${socketId} not found`);

    const transport = peer.getTransport(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);

    const producer = await transport.produce({ kind, rtpParameters, appData });
    peer.addProducer(producer);

    producer.on('transportclose', () => {
      peer.producers.delete(producer.id);
      try { producer.close(); } catch {}
    });

    return producer.id;
  }

  async consume(socketId: string, transportId: string, producerId: string, rtpCapabilities: any) {
    const peer = this.getPeer(socketId);
    if (!peer) throw new Error(`Peer ${socketId} not found`);

    const transport = peer.getTransport(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);

    if (!this.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Router cannot consume this producer with the given RTP capabilities');
    }

    const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
    peer.addConsumer(consumer);

    consumer.on('transportclose', () => {
      peer.consumers.delete(consumer.id);
      try { consumer.close(); } catch {}
    });

    consumer.on('producerclose', () => {
      peer.consumers.delete(consumer.id);
      try { consumer.close(); } catch {}
    });

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }
}

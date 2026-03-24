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
    this.peers.set(peer.socketId, peer);
  }

  getPeer(socketId: string) {
    return this.peers.get(socketId);
  }

  removePeer(socketId: string) {
    const peer = this.peers.get(socketId);
    if (peer) {
      peer.close();
      this.peers.delete(socketId);
    }
  }

  getPeers() {
    return Array.from(this.peers.values());
  }


  async createWebRtcTransport(socketId: string, forceTcp: boolean = false) {
    const {
      listenIps,
      initialAvailableOutgoingBitrate,
      maxSctpMessageSize
    } = config.mediasoup.webRtcTransport;

    const transport = await this.router.createWebRtcTransport({
      listenIps: listenIps as mediasoup.types.TransportListenIp[],
      enableUdp: !forceTcp,
      enableTcp: true,
      preferUdp: !forceTcp,
      initialAvailableOutgoingBitrate,
      maxSctpMessageSize
    });

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        transport.close();
      }
    });

    const peer = this.getPeer(socketId);
    if (peer) {
      peer.addTransport(transport);
    }

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    };
  }

  async connectPeerTransport(socketId: string, transportId: string, dtlsParameters: any) {
    const peer = this.getPeer(socketId);
    if (!peer) return;

    const transport = peer.getTransport(transportId);
    if (!transport) return;

    await transport.connect({ dtlsParameters });
  }

  async produce(socketId: string, transportId: string, rtpParameters: any, kind: any, appData: any = {}) {
    const peer = this.getPeer(socketId);
    if (!peer) return;

    const transport = peer.getTransport(transportId);
    if (!transport) return;

    const producer = await transport.produce({
      kind,
      rtpParameters,
      appData
    });

    peer.addProducer(producer);

    producer.on('transportclose', () => {
      producer.close();
    });

    return producer.id;
  }

  async consume(socketId: string, transportId: string, producerId: string, rtpCapabilities: any) {
    const peer = this.getPeer(socketId);
    if (!peer) return;

    const transport = peer.getTransport(transportId);
    if (!transport) return;

    if (!this.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('cannot consume');
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true
    });

    peer.addConsumer(consumer);

    consumer.on('transportclose', () => {
      consumer.close();
    });

    consumer.on('producerclose', () => {
      consumer.close();
      peer.consumers.delete(consumer.id);
    });

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    };
  }
}


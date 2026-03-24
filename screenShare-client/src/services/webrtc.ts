import { Device } from 'mediasoup-client';
import { socket } from './socket';
import { useAppStore } from '../store/useAppStore';

let device: Device | null = null;
let sendTransport: any = null;
let recvTransport: any = null;

const producers = new Map<string, any>(); // key: kind ('video' | 'audio' | 'screen')
const consumers = new Map<string, any>(); // key: consumer.id
const consumedProducers = new Set<string>(); // producerId de-dup guard
const producerToConsumer = new Map<string, string>(); // producerId -> consumerId

export const webrtcService = {
  getDevice: () => device,

  getProducer: (customKind: 'video' | 'audio' | 'screen') => {
    return producers.get(customKind);
  },

  replaceTrack: async (customKind: 'video' | 'audio' | 'screen', track: MediaStreamTrack | null) => {
    const producer = producers.get(customKind);
    if (producer) {
      await producer.replaceTrack({ track });
    }
  },
  
  loadDevice: async (routerRtpCapabilities: any) => {
    device = new Device();
    await device.load({ routerRtpCapabilities });
    return device;
  },

  setQuality: (q: 'low' | 'medium' | 'high') => {
    // Placeholder hook for future adaptive bitrate; currently not altering encodings.
    (webrtcService as any)._quality = q;
  },

  createSendTransport: async () => {
    if (sendTransport) return sendTransport;
    return new Promise((resolve, reject) => {
      socket.emit('createWebRtcTransport', { forceTcp: false }, async (data: any) => {
        if (data.error) return reject(data.error);

        sendTransport = device!.createSendTransport(data);

        sendTransport.on('connect', ({ dtlsParameters }: any, callback: any, errback: any) => {
          socket.emit('connectTransport', {
            transportId: sendTransport.id,
            dtlsParameters,
          }, (response: any) => {
            if (response.error) errback(response.error);
            else callback();
          });
        });

        sendTransport.on('produce', (parameters: any, callback: any, errback: any) => {
          socket.emit('produce', {
            transportId: sendTransport.id,
            kind: parameters.kind,
            appData: parameters.appData,
            rtpParameters: parameters.rtpParameters,
          }, (response: any) => {
            if (response.error) errback(response.error);
            else callback({ id: response.id });
          });
        });

        resolve(sendTransport);
      });
    });
  },

  createRecvTransport: async () => {
    if (recvTransport) return recvTransport;
    return new Promise((resolve, reject) => {
      socket.emit('createWebRtcTransport', { forceTcp: false }, async (data: any) => {
        if (data.error) return reject(data.error);

        recvTransport = device!.createRecvTransport(data);

        recvTransport.on('connect', ({ dtlsParameters }: any, callback: any, errback: any) => {
          socket.emit('connectTransport', {
            transportId: recvTransport.id,
            dtlsParameters,
          }, (response: any) => {
            if (response.error) errback(response.error);
            else callback();
          });
        });

        resolve(recvTransport);
      });
    });
  },

  produce: async (track: MediaStreamTrack, customKind: 'video' | 'audio' | 'screen'): Promise<string | null> => {
    try {
      if (!sendTransport) await webrtcService.createSendTransport();

      let encodings = undefined;
      let codecOptions = undefined;

      if (customKind === 'screen') {
        encodings = [
          { maxBitrate: 100000 },
          { maxBitrate: 300000 },
          { maxBitrate: 900000 }
        ];
        codecOptions = { videoGoogleStartBitrate: 1000 };
      } else if (customKind === 'video') {
        encodings = [
          { maxBitrate: 100000 },
          { maxBitrate: 500000 }
        ];
      }

      const producer = await sendTransport.produce({
        track,
        encodings,
        codecOptions,
        appData: { customKind }
      });

      producers.set(customKind, producer);

      producer.on('trackended', () => {
        webrtcService.stopProduce(customKind);
      });

      producer.on('transportclose', () => {
        producers.delete(customKind);
      });

      return producer.id;
    } catch (err) {
      console.error(`Error producing ${customKind}:`, err);
      return null;
    }
  },

  stopProduce: (customKind: 'video' | 'audio' | 'screen') => {
    const producer = producers.get(customKind);
    if (producer) {
      const producerId = producer.id;
      producer.close();
      producers.delete(customKind);
      
      socket.emit('closeProducer', { producerId }, () => {});
      
      if (customKind === 'screen') {
        socket.emit('stopScreenShare', {}, () => {});
      }
    }
  },

  consume: async (producerId: string, socketId: string, kind: 'video' | 'audio' | 'screen'): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!recvTransport) return reject('No recvTransport');
      if (consumedProducers.has(producerId)) {
        return resolve(); // already consuming this producer
      }
      
      socket.emit('consume', {
        transportId: recvTransport.id,
        producerId,
        rtpCapabilities: device!.rtpCapabilities,
      }, async (response: any) => {
        if (response.error) return reject(response.error);

        const consumer = await recvTransport.consume({
          id: response.id,
          producerId: response.producerId,
          kind: response.kind,
          rtpParameters: response.rtpParameters,
        });

        consumers.set(consumer.id, consumer);
        consumedProducers.add(producerId);
        producerToConsumer.set(producerId, consumer.id);

        socket.emit('resumeConsumer', { consumerId: consumer.id }, (res: any) => {
          if (res.error) return reject(res.error);
          
          useAppStore.getState().setRemoteStreamTrack(socketId, kind, consumer.track);
          
          consumer.on('transportclose', () => {
            consumers.delete(consumer.id);
            consumedProducers.delete(producerId);
            producerToConsumer.delete(producerId);
            useAppStore.getState().setRemoteStreamTrack(socketId, kind, undefined);
          });
          
          consumer.on('producerclose', () => {
            consumers.delete(consumer.id);
            consumedProducers.delete(producerId);
            producerToConsumer.delete(producerId);
            useAppStore.getState().setRemoteStreamTrack(socketId, kind, undefined);
          });

          resolve();
        });
      });
    });
  },

  // Allow external handler to proactively clear consumer guard when server notifies closure
  markProducerClosed: (producerId: string) => {
    const consumerId = producerToConsumer.get(producerId);
    if (consumerId) {
      const c = consumers.get(consumerId);
      try { c && c.close && c.close(); } catch {}
      consumers.delete(consumerId);
      producerToConsumer.delete(producerId);
    }
    consumedProducers.delete(producerId);
  },

  close: () => {
    producers.forEach(p => p.close());
    producers.clear();
    consumers.forEach(c => c.close());
    consumers.clear();
    if (sendTransport) sendTransport.close();
    if (recvTransport) recvTransport.close();
    device = null;
    sendTransport = null;
    recvTransport = null;
  }
};

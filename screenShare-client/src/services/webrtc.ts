import { Device } from 'mediasoup-client';
import { socket } from './socket';
import { useAppStore } from '../store/useAppStore';

let device: Device | null = null;
let sendTransport: any = null;
let recvTransport: any = null;

const producers = new Map<string, any>();       // key: customKind ('video'|'audio'|'screen')
const consumers = new Map<string, any>();       // key: consumer.id
const consumedProducers = new Set<string>();    // producerId de-dup guard (already consuming)
const consumingInProgress = new Set<string>(); // producerId de-dup guard (consume in flight)
const producerToConsumer = new Map<string, string>();  // producerId -> consumerId
// Stores per-consumer metadata so markProducerClosed can clear the correct UI tile
const consumerMeta = new Map<string, { socketId: string; kind: 'video' | 'audio' | 'screen' }>();

export const webrtcService = {
  getDevice: () => device,

  getProducer: (customKind: 'video' | 'audio' | 'screen') => producers.get(customKind),

  replaceTrack: async (customKind: 'video' | 'audio' | 'screen', track: MediaStreamTrack | null) => {
    const producer = producers.get(customKind);
    if (producer && !producer.closed) {
      await producer.replaceTrack({ track });
    }
  },

  loadDevice: async (routerRtpCapabilities: any) => {
    device = new Device();
    await device.load({ routerRtpCapabilities });
    return device;
  },

  setQuality: (q: 'low' | 'medium' | 'high') => {
    (webrtcService as any)._quality = q;
  },

  createSendTransport: async () => {
    if (sendTransport) return sendTransport;
    return new Promise((resolve, reject) => {
      const onDisconnect = () => reject(new Error('Socket disconnected'));
      socket.once('disconnect', onDisconnect);
      socket.emit('createWebRtcTransport', { forceTcp: false }, (data: any) => {
        socket.off('disconnect', onDisconnect);
        if (data?.error) return reject(new Error(data.error));
        if (!device) return reject(new Error('Device not initialized'));

        sendTransport = device.createSendTransport(data);

        sendTransport.on('connect', ({ dtlsParameters }: any, callback: any, errback: any) => {
          socket.emit(
            'connectTransport',
            { transportId: sendTransport.id, dtlsParameters },
            (response: any) => {
              if (response?.error) errback(new Error(response.error));
              else callback();
            }
          );
        });

        sendTransport.on('produce', (parameters: any, callback: any, errback: any) => {
          socket.emit(
            'produce',
            {
              transportId: sendTransport.id,
              kind: parameters.kind,
              appData: parameters.appData,
              rtpParameters: parameters.rtpParameters,
            },
            (response: any) => {
              if (response?.error) errback(new Error(response.error));
              else callback({ id: response.id });
            }
          );
        });

        resolve(sendTransport);
      });
    });
  },

  createRecvTransport: async () => {
    if (recvTransport) return recvTransport;
    return new Promise((resolve, reject) => {
      const onDisconnect = () => reject(new Error('Socket disconnected'));
      socket.once('disconnect', onDisconnect);
      socket.emit('createWebRtcTransport', { forceTcp: false }, (data: any) => {
        socket.off('disconnect', onDisconnect);
        if (data?.error) return reject(new Error(data.error));
        if (!device) return reject(new Error('Device not initialized'));

        recvTransport = device.createRecvTransport(data);

        recvTransport.on('connect', ({ dtlsParameters }: any, callback: any, errback: any) => {
          socket.emit(
            'connectTransport',
            { transportId: recvTransport.id, dtlsParameters },
            (response: any) => {
              if (response?.error) errback(new Error(response.error));
              else callback();
            }
          );
        });

        resolve(recvTransport);
      });
    });
  },

  // Throws on failure so callers can revert UI state correctly
  produce: async (track: MediaStreamTrack, customKind: 'video' | 'audio' | 'screen'): Promise<string> => {
    if (!device) throw new Error('Device not initialized');
    if (!sendTransport) await webrtcService.createSendTransport();
    if (!sendTransport) throw new Error('Failed to create send transport');

    let encodings: any[] | undefined;
    let codecOptions: any | undefined;

    if (customKind === 'screen') {
      encodings = [
        { maxBitrate: 100_000 },
        { maxBitrate: 300_000 },
        { maxBitrate: 900_000 },
      ];
      codecOptions = { videoGoogleStartBitrate: 1000 };
    } else if (customKind === 'video') {
      encodings = [{ maxBitrate: 100_000 }, { maxBitrate: 500_000 }];
    }

    const producer = await sendTransport.produce({
      track,
      encodings,
      codecOptions,
      appData: { customKind },
    });

    const existingProducer = producers.get(customKind);
    if (existingProducer && !existingProducer.closed) {
      const existingId = existingProducer.id;
      existingProducer.close();
      socket.emit('closeProducer', { producerId: existingId }, () => {});
    }
    producers.set(customKind, producer);

    producer.on('trackended', () => {
      webrtcService.stopProduce(customKind);
    });

    producer.on('transportclose', () => {
      producers.delete(customKind);
    });

    return producer.id;
  },

  stopProduce: (customKind: 'video' | 'audio' | 'screen') => {
    const producer = producers.get(customKind);
    if (producer && !producer.closed) {
      const producerId = producer.id;
      producer.close();
      producers.delete(customKind);
      socket.emit('closeProducer', { producerId }, () => {});
    }
  },

  consume: async (producerId: string, socketId: string, kind: 'video' | 'audio' | 'screen'): Promise<void> => {
    if (!device) throw new Error('Device not initialized');
    if (!recvTransport) throw new Error('No recv transport');
    if (consumedProducers.has(producerId)) return;   // already consuming
    if (consumingInProgress.has(producerId)) return; // concurrent call guard

    consumingInProgress.add(producerId);

    return new Promise((resolve, reject) => {
      socket.emit(
        'consume',
        {
          transportId: recvTransport.id,
          producerId,
          rtpCapabilities: device!.rtpCapabilities,
        },
        async (response: any) => {
          if (response?.error) {
            consumingInProgress.delete(producerId);
            return reject(new Error(response.error));
          }

          try {
            const consumer = await recvTransport.consume({
              id: response.id,
              producerId: response.producerId,
              kind: response.kind,
              rtpParameters: response.rtpParameters,
            });

            consumers.set(consumer.id, consumer);
            consumedProducers.add(producerId);
            consumingInProgress.delete(producerId);
            producerToConsumer.set(producerId, consumer.id);
            consumerMeta.set(consumer.id, { socketId, kind });

            const cleanup = () => {
              const meta = consumerMeta.get(consumer.id);
              consumers.delete(consumer.id);
              consumedProducers.delete(producerId);
              consumingInProgress.delete(producerId);
              producerToConsumer.delete(producerId);
              consumerMeta.delete(consumer.id);
              if (meta) {
                useAppStore.getState().setRemoteStreamTrack(meta.socketId, meta.kind, undefined);
              }
            };

            consumer.on('transportclose', cleanup);
            consumer.on('producerclose', cleanup);

            const onResumeDisconnect = () => {
              socket.off('disconnect', onResumeDisconnect);
              cleanup();
              try { if (!consumer.closed) consumer.close(); } catch {}
              reject(new Error('Socket disconnected'));
            };
            socket.once('disconnect', onResumeDisconnect);

            socket.emit('resumeConsumer', { consumerId: consumer.id }, (res: any) => {
              socket.off('disconnect', onResumeDisconnect);
              if (res?.error) {
                cleanup();
                try { if (!consumer.closed) consumer.close(); } catch {}
                return reject(new Error(res.error));
              }
              useAppStore.getState().setRemoteStreamTrack(socketId, kind, consumer.track);
              resolve();
            });
          } catch (err) {
            consumingInProgress.delete(producerId);
            reject(err);
          }
        }
      );
    });
  },

  // Called when the server emits 'producerClosed' to proactively clear the UI tile
  markProducerClosed: (producerId: string) => {
    const consumerId = producerToConsumer.get(producerId);
    if (consumerId) {
      const meta = consumerMeta.get(consumerId);
      const c = consumers.get(consumerId);
      try { if (c && !c.closed) c.close(); } catch {}
      consumers.delete(consumerId);
      consumerMeta.delete(consumerId);
      producerToConsumer.delete(producerId);
      if (meta) {
        useAppStore.getState().setRemoteStreamTrack(meta.socketId, meta.kind, undefined);
      }
    }
    consumedProducers.delete(producerId);
    consumingInProgress.delete(producerId);
  },

  close: () => {
    producers.forEach(p => { try { if (!p.closed) p.close(); } catch {} });
    producers.clear();
    consumers.forEach(c => { try { if (!c.closed) c.close(); } catch {} });
    consumers.clear();
    consumedProducers.clear();
    consumingInProgress.clear();
    producerToConsumer.clear();
    consumerMeta.clear();
    if (sendTransport) { try { if (!sendTransport.closed) sendTransport.close(); } catch {} }
    if (recvTransport) { try { if (!recvTransport.closed) recvTransport.close(); } catch {} }
    device = null;
    sendTransport = null;
    recvTransport = null;
  },
};

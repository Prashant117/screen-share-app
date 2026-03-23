import * as mediasoup from 'mediasoup';

export class Peer {
  socketId: string;
  displayName?: string;
  transports: Map<string, mediasoup.types.Transport>;
  producers: Map<string, mediasoup.types.Producer>;
  consumers: Map<string, mediasoup.types.Consumer>;

  constructor(socketId: string, displayName?: string) {
    this.socketId = socketId;
    this.displayName = displayName;
    this.transports = new Map();
    this.producers = new Map();
    this.consumers = new Map();
  }

  addTransport(transport: mediasoup.types.Transport) {
    this.transports.set(transport.id, transport);
  }

  getTransport(transportId: string) {
    return this.transports.get(transportId);
  }

  addProducer(producer: mediasoup.types.Producer) {
    this.producers.set(producer.id, producer);
  }

  getProducer(producerId: string) {
    return this.producers.get(producerId);
  }

  addConsumer(consumer: mediasoup.types.Consumer) {
    this.consumers.set(consumer.id, consumer);
  }

  getConsumer(consumerId: string) {
    return this.consumers.get(consumerId);
  }

  close() {
    this.consumers.forEach(consumer => consumer.close());
    this.producers.forEach(producer => producer.close());
    this.transports.forEach(transport => transport.close());
    
    this.consumers.clear();
    this.producers.clear();
    this.transports.clear();
  }
}


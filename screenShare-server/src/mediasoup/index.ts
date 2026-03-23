import * as mediasoup from 'mediasoup';
import { config } from '../config';

const workers: mediasoup.types.Worker[] = [];
let nextMediasoupWorkerIdx = 0;

export async function createWorkers() {
  const { numWorkers } = config.mediasoup;

  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: config.mediasoup.worker.logLevel as mediasoup.types.WorkerLogLevel,
      logTags: config.mediasoup.worker.logTags as mediasoup.types.WorkerLogTag[],
      rtcMinPort: config.mediasoup.worker.rtcMinPort,
      rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
    });

    worker.on('died', () => {
      console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
      setTimeout(() => process.exit(1), 2000);
    });

    workers.push(worker);
  }

  console.log(`Created ${workers.length} mediasoup workers`);
}

export function getMediasoupWorker() {
  const worker = workers[nextMediasoupWorkerIdx];
  if (++nextMediasoupWorkerIdx === workers.length) {
    nextMediasoupWorkerIdx = 0;
  }
  return worker;
}


import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { config } from './config';
import { createWorkers } from './mediasoup';
import { setupSockets } from './sockets';

const app = express();
app.use(cors({
  origin: config.clientOrigins
}));
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: config.clientOrigins,
    methods: ['GET', 'POST']
  }
});

async function main() {
  await createWorkers();
  
  setupSockets(io);

  server.listen(config.port, config.listenIp, () => {
    console.log(`Server listening on http://${config.listenIp}:${config.port}`);
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
});

import dotenv from 'dotenv';
dotenv.config();

const parseOrigins = (): (string | RegExp)[] | true => {
  const urls = process.env.CLIENT_URLS || process.env.CLIENT_URL || '*';
  if (urls === '*') return true;
  const parts = urls.split(',').map(s => s.trim()).filter(Boolean);
  return parts;
};

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  listenIp: process.env.LISTEN_IP || '0.0.0.0',
  announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1',
  clientOrigins: parseOrigins(),
  mediasoup: {
    numWorkers: Object.keys(require('os').cpus()).length,
    worker: {
      rtcMinPort: parseInt(process.env.MEDIASOUP_MIN_PORT || '40000', 10),
      rtcMaxPort: parseInt(process.env.MEDIASOUP_MAX_PORT || '49999', 10),
      logLevel: 'warn',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    },
    router: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/VP9',
          clockRate: 90000,
          parameters: {
            'profile-id': 2,
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '4d0032',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000,
          },
        },
      ],
    },
    webRtcTransport: {
      listenIps: [
        {
          ip: process.env.LISTEN_IP || '0.0.0.0',
          announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1',
        },
      ],
      initialAvailableOutgoingBitrate: 1000000,
      minimumAvailableOutgoingBitrate: 600000,
      maxSctpMessageSize: 262144,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    },
  },
};

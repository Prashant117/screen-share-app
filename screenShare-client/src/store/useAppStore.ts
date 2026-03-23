import { create } from 'zustand';
import type { ChatMessage, PeerInfo, RoomInfo } from '../types/shared';

interface RemoteStreamMap {
  [socketId: string]: {
    video?: MediaStreamTrack;
    audio?: MediaStreamTrack;
    screen?: MediaStreamTrack;
  }
}

interface AppState {
  displayName: string;
  setDisplayName: (name: string) => void;
  
  roomId: string | null;
  setRoomId: (id: string | null) => void;

  roomInfo: RoomInfo | null;
  setRoomInfo: (info: RoomInfo | null) => void;

  peers: PeerInfo[];
  setPeers: (peers: PeerInfo[]) => void;
  addPeer: (peer: PeerInfo) => void;
  removePeer: (socketId: string) => void;

  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  clearMessages: () => void;

  localStreams: { video: boolean, audio: boolean, screen: boolean };
  setLocalStream: (type: 'video' | 'audio' | 'screen', value: boolean) => void;

  remoteStreams: RemoteStreamMap;
  setRemoteStreamTrack: (socketId: string, kind: 'video' | 'audio' | 'screen', track: MediaStreamTrack | undefined) => void;
  removeRemotePeerStreams: (socketId: string) => void;

  participantCount: number;
  setParticipantCount: (count: number) => void;
  
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  displayName: '',
  setDisplayName: (name) => set({ displayName: name }),

  roomId: null,
  setRoomId: (id) => set({ roomId: id }),

  roomInfo: null,
  setRoomInfo: (info) => set({ roomInfo: info }),

  peers: [],
  setPeers: (peers) => set({ peers }),
  addPeer: (peer) => set((state) => ({ peers: [...state.peers, peer] })),
  removePeer: (socketId) => set((state) => ({ peers: state.peers.filter(p => p.socketId !== socketId) })),

  messages: [],
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  clearMessages: () => set({ messages: [] }),

  localStreams: { video: false, audio: false, screen: false },
  setLocalStream: (type, value) => set((state) => ({
    localStreams: { ...state.localStreams, [type]: value }
  })),

  remoteStreams: {},
  setRemoteStreamTrack: (socketId, kind, track) => set((state) => {
    const peerStreams = state.remoteStreams[socketId] || {};
    return {
      remoteStreams: {
        ...state.remoteStreams,
        [socketId]: {
          ...peerStreams,
          [kind]: track
        }
      }
    };
  }),

  removeRemotePeerStreams: (socketId) => set((state) => {
    const newStreams = { ...state.remoteStreams };
    delete newStreams[socketId];
    return { remoteStreams: newStreams };
  }),

  participantCount: 0,
  setParticipantCount: (count) => set({ participantCount: count }),

  reset: () => set({
    roomId: null,
    roomInfo: null,
    peers: [],
    messages: [],
    localStreams: { video: false, audio: false, screen: false },
    remoteStreams: {},
    participantCount: 0
  })
}));

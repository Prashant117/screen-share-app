export interface PeerInfo {
  socketId: string;
  displayName?: string;
}

export interface RoomInfo {
  roomId: string;
  participantCount: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  displayName: string;
  content: string;
  timestamp: number;
  type: 'user' | 'system';
}


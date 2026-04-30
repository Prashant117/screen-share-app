import { Room } from './Room';

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  // Tracks in-flight createRoom promises so concurrent callers await the same one
  private creating: Map<string, Promise<Room>> = new Map();

  async createRoom(roomId: string): Promise<Room> {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    const inFlight = this.creating.get(roomId);
    if (inFlight) return inFlight;

    const promise = Room.create(roomId)
      .then(room => {
        this.rooms.set(roomId, room);
        this.creating.delete(roomId);
        return room;
      })
      .catch(err => {
        this.creating.delete(roomId);
        throw err;
      });

    this.creating.set(roomId, promise);
    return promise;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  removeRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (room) {
      // Close all peer resources before closing the router
      room.getPeers().forEach(peer => peer.close());
      try { room.router.close(); } catch {}
      this.rooms.delete(roomId);
    }
  }

  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }
}

export const roomManager = new RoomManager();

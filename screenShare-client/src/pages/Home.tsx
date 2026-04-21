import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, Users, Loader2 } from 'lucide-react';
import { socket, SOCKET_URL } from '../services/socket';
import { useAppStore } from '../store/useAppStore';

export function Home() {
  const [name, setName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { setDisplayName, setRoomId } = useAppStore();

  const ensureSocketConnected = () =>
    new Promise<void>((resolve, reject) => {
      if (socket.connected) return resolve();
      const onConnect = () => {
        socket.off('connect_error', onError);
        resolve();
      };
      const onError = (err: any) => {
        socket.off('connect', onConnect);
        const msg = err?.message || 'Socket connection failed';
        reject(new Error(`Could not connect to ${SOCKET_URL}. ${msg}`));
      };
      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
      socket.connect();
    });

  const handleCreateRoom = () => {
    const finalName = name.trim() || `Guest-${Math.random().toString(36).slice(2,6)}`;

    setIsLoading(true);
    setError('');

    ensureSocketConnected()
      .then(() => {
        let timeout: any;
        const onAck = (response: any) => {
          clearTimeout(timeout);
          setIsLoading(false);
          if (response?.error) {
            setError(response.error);
            return;
          }
          setDisplayName(finalName);
          setRoomId(response.roomId);
          navigate(`/room/${response.roomId}`);
        };
        socket.emit('createRoom', { displayName: finalName }, onAck);
        timeout = setTimeout(() => {
          setIsLoading(false);
          setError('Room creation timed out. Please try again.');
        }, 8000);
      })
      .catch((err) => {
        setIsLoading(false);
        setError(err.message || 'Failed to connect to server');
      });
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = name.trim() || `Guest-${Math.random().toString(36).slice(2,6)}`;
    if (!roomIdInput.trim()) {
      setError('Please enter a Room ID');
      return;
    }

    setIsLoading(true);
    setError('');

    ensureSocketConnected()
      .then(() => {
        setDisplayName(finalName);
        setRoomId(roomIdInput);
        navigate(`/room/${roomIdInput}`);
      })
      .catch((err) => {
        setIsLoading(false);
        setError(err.message || 'Failed to connect to server');
      });
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-xl p-8 shadow-2xl">
        <div className="flex items-center justify-center mb-8">
          <Monitor className="text-blue-500 w-10 h-10 mr-3" />
          <h1 className="text-3xl font-bold text-white tracking-tight">Aiken Meet</h1>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-500 px-4 py-3 rounded-lg mb-6 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Your Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              placeholder="e.g. Dr. XYZ"
            />
          </div>

          <div className="pt-4 border-t border-gray-800">
            <button
              onClick={handleCreateRoom}
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="animate-spin w-5 h-5" /> : <Monitor className="w-5 h-5 mr-2" />}
              Create New Room
            </button>
          </div>

          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-gray-800"></div>
            <span className="flex-shrink-0 mx-4 text-gray-500 text-sm">or join existing</span>
            <div className="flex-grow border-t border-gray-800"></div>
          </div>

          <form onSubmit={handleJoinRoom} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Room ID
              </label>
              <input
                type="text"
                value={roomIdInput}
                onChange={(e) => setRoomIdInput(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="e.g. 8a7b6c5d"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gray-800 hover:bg-gray-700 text-white font-medium py-3 px-4 rounded-lg border border-gray-700 flex items-center justify-center transition-colors disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="animate-spin w-5 h-5" /> : <Users className="w-5 h-5 mr-2" />}
              Join Room
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

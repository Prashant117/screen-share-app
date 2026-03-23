import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  Mic, MicOff, Video, VideoOff, 
  MonitorUp, PhoneOff, MessageSquare, 
  Users, Expand
} from 'lucide-react';
import { socket } from '../services/socket';
import { webrtcService } from '../services/webrtc';
import { useAppStore } from '../store/useAppStore';

const VideoPlayer = ({ track, muted, autoPlay, className }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && track) {
      const stream = new MediaStream([track]);
      videoRef.current.srcObject = stream;
    }
  }, [track]);

  return (
    <video
      ref={videoRef}
      autoPlay={autoPlay}
      playsInline
      muted={muted}
      className={className}
    />
  );
};

const AudioPlayer = ({ track }: any) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current && track) {
      const stream = new MediaStream([track]);
      audioRef.current.srcObject = stream;
    }
  }, [track]);

  return <audio ref={audioRef} autoPlay />;
};

export function MeetingRoom() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  
  const [localDeviceStream, setLocalDeviceStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);

  const {
    displayName,
    setRoomInfo,
    addPeer,
    removePeer,
    peers,
    setPeers,
    messages,
    addMessage,
    clearMessages,
    localStreams,
    setLocalStream,
    remoteStreams,
    participantCount,
    setParticipantCount,
    removeRemotePeerStreams
  } = useAppStore();

  const ensureSocketConnected = () =>
    new Promise<void>((resolve, reject) => {
      if (socket.connected) return resolve();
      const onConnect = () => {
        socket.off('connect_error', onError);
        resolve();
      };
      const onError = (err: any) => {
        socket.off('connect', onConnect);
        reject(new Error(err?.message || 'Socket connection failed'));
      };
      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
      socket.connect();
    });

  useEffect(() => {
    if (!displayName || !id) {
      navigate('/');
      return;
    }

    const init = async () => {
      try {
        await ensureSocketConnected();

        let joined = false;
        socket.emit('joinRoom', { roomId: id, displayName }, async (response: any) => {
          if (response.error) {
            console.error(response.error);
            navigate('/');
            return;
          }

          joined = true;
          setRoomInfo(response.room);
          setPeers(response.peers || []);
          setParticipantCount(response.room.participantCount);
          
          await webrtcService.loadDevice(response.routerRtpCapabilities);
          await webrtcService.createSendTransport();
          await webrtcService.createRecvTransport();

          // Get local camera/mic
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { width: 1280, height: 720 },
              audio: true
            });
            
            setLocalDeviceStream(stream);

            // Turn off tracks initially or leave them on based on preference
            const videoTrack = stream.getVideoTracks()[0];
            const audioTrack = stream.getAudioTracks()[0];
            
            if (videoTrack) {
              await webrtcService.produce(videoTrack, 'video');
              setLocalStream('video', true);
            }
            if (audioTrack) {
              await webrtcService.produce(audioTrack, 'audio');
              setLocalStream('audio', true);
            }
          } catch (e) {
            console.error("Could not get user media", e);
          }
        });

        // Fail-safe if join fails
        setTimeout(() => {
          if (!joined) navigate('/');
        }, 5000);
      } catch (err) {
        console.error(err);
        navigate('/');
      }
    };

    init();

    // Socket listeners
    const onParticipantJoined = (data: any) => addPeer(data);
    const onParticipantLeft = (data: any) => {
      removePeer(data.socketId);
      removeRemotePeerStreams(data.socketId);
    };
    const onParticipantCountUpdated = (data: any) => setParticipantCount(data.count);
    
    const onNewProducer = async (data: any) => {
      try {
        await webrtcService.consume(data.producerId, data.socketId, data.kind);
      } catch (err) {
        console.error('Error consuming new producer:', err);
      }
    };

    const onRoomMessage = (msg: any) => addMessage(msg);
    const onSystemMessage = (msg: any) => addMessage({ ...msg, type: 'system' });

    socket.on('participantJoined', onParticipantJoined);
    socket.on('participantLeft', onParticipantLeft);
    socket.on('participantCountUpdated', onParticipantCountUpdated);
    socket.on('newProducer', onNewProducer);
    socket.on('roomMessage', onRoomMessage);
    socket.on('systemMessage', onSystemMessage);

    return () => {
      socket.emit('leaveRoom');
      webrtcService.close();
      localDeviceStream?.getTracks().forEach(t => t.stop());
      localScreenStream?.getTracks().forEach(t => t.stop());
      socket.off('participantJoined', onParticipantJoined);
      socket.off('participantLeft', onParticipantLeft);
      socket.off('participantCountUpdated', onParticipantCountUpdated);
      socket.off('newProducer', onNewProducer);
      socket.off('roomMessage', onRoomMessage);
      socket.off('systemMessage', onSystemMessage);
      clearMessages();
    };
  }, []);

  const toggleMic = async () => {
    if (localDeviceStream) {
      const audioTrack = localDeviceStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !localStreams.audio;
        setLocalStream('audio', audioTrack.enabled);
        if (audioTrack.enabled) {
          // It was produced during init, just unmuted
        }
      }
    }
  };

  const toggleVideo = async () => {
    if (localDeviceStream) {
      const videoTrack = localDeviceStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !localStreams.video;
        setLocalStream('video', videoTrack.enabled);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (localStreams.screen) {
      webrtcService.stopProduce('screen');
      localScreenStream?.getTracks().forEach(t => t.stop());
      setLocalScreenStream(null);
      setLocalStream('screen', false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: 1920, height: 1080 },
          audio: false
        });
        
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          await webrtcService.produce(videoTrack, 'screen');
          setLocalScreenStream(stream);
          setLocalStream('screen', true);

          videoTrack.onended = () => {
            webrtcService.stopProduce('screen');
            setLocalScreenStream(null);
            setLocalStream('screen', false);
          };
        }
      } catch (err) {
        console.error('Error sharing screen', err);
      }
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socket.emit('sendRoomMessage', { content: chatInput }, () => {});
    setChatInput('');
  };

  const leaveRoom = () => {
    navigate('/');
  };

  // Build grid blocks
  const localVideoTrack = localDeviceStream?.getVideoTracks()[0];
  const localScreenTrack = localScreenStream?.getVideoTracks()[0];
  
  const entries = [];
  
  if (localVideoTrack && localStreams.video) {
    entries.push({ id: 'local-video', type: 'video', track: localVideoTrack, name: displayName + ' (You)' });
  }
  if (localScreenTrack && localStreams.screen) {
    entries.push({ id: 'local-screen', type: 'screen', track: localScreenTrack, name: displayName + ' (Your Screen)' });
  }

  // Remote tracks
  Object.keys(remoteStreams).forEach(socketId => {
    const peerName = peers.find(p => p.socketId === socketId)?.displayName || 'Participant';
    const s = remoteStreams[socketId];
    if (s.video) entries.push({ id: `${socketId}-video`, type: 'video', track: s.video, name: peerName });
    if (s.screen) entries.push({ id: `${socketId}-screen`, type: 'screen', track: s.screen, name: `${peerName}'s Screen` });
  });

  // Calculate grid layout sizes
  const count = entries.length || 1; 
  const cols = count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 2 : count <= 9 ? 3 : 4;

  return (
    <div className="h-screen bg-[#202124] flex overflow-hidden text-white font-sans">
      
      {/* Invisible Audio Players for remote users */}
      {Object.values(remoteStreams).map((s, i) => s.audio ? <AudioPlayer key={i} track={s.audio} /> : null)}

      {/* Main Content */}
      <div className={`flex-1 flex flex-col transition-all duration-300 ${chatOpen ? 'mr-80' : ''}`}>
        
        {/* Top Header */}
        <div className="h-12 flex items-center justify-between px-4 pb-2 pt-4 absolute top-0 w-full z-10 pointer-events-none">
          <div className="bg-black/50 px-3 py-1.5 rounded-md backdrop-blur-sm pointer-events-auto">
            <span className="font-medium">{id}</span>
          </div>
        </div>

        {/* Video Grid Area */}
        <div className="flex-1 p-4 pb-20 flex justify-center items-center">
          {entries.length === 0 ? (
            <div className="text-center text-gray-400">
              <div className="mb-4">
                <Users className="w-16 h-16 mx-auto opacity-50" />
              </div>
              <p className="text-xl">You're the only one here right now.</p>
              <p className="mt-2 text-sm">Waiting for others to join...</p>
            </div>
          ) : (
            <div 
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gap: '12px',
                width: '100%',
                maxHeight: '100%',
                aspectRatio: count === 1 ? '16/9' : 'auto'
              }}
              className="h-full items-center justify-center p-4"
            >
              {entries.map(e => (
                <div key={e.id} className="relative w-full h-full bg-[#3c4043] rounded-lg overflow-hidden shadow-lg group">
                  <VideoPlayer 
                    track={e.track} 
                    muted={e.id.startsWith('local')} 
                    autoPlay 
                    className={`w-full h-full object-cover ${e.type === 'video' && e.id.startsWith('local') ? '-scale-x-100' : ''}`} 
                  />
                  <div className="absolute bottom-3 left-3 bg-black/60 px-3 py-1 rounded text-sm backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity">
                    {e.name}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Control Bar */}
        <div className="h-20 bg-[#202124] flex items-center justify-between px-6 absolute bottom-0 w-full z-20 transition-all duration-300" style={{ right: chatOpen ? '20rem' : '0' }}>
          
          <div className="flex items-center space-x-4 w-1/3">
            <div className="text-lg font-medium">{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} | {id}</div>
          </div>

          <div className="flex items-center justify-center space-x-4 w-1/3">
            <button 
              onClick={toggleMic}
              className={`p-3 rounded-full ${localStreams.audio ? 'bg-[#3c4043] hover:bg-[#4a4f54]' : 'bg-red-500 hover:bg-red-600'} transition-colors`}
            >
              {localStreams.audio ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
            </button>
            <button 
              onClick={toggleVideo}
              className={`p-3 rounded-full ${localStreams.video ? 'bg-[#3c4043] hover:bg-[#4a4f54]' : 'bg-red-500 hover:bg-red-600'} transition-colors`}
            >
              {localStreams.video ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
            </button>
            <button 
              onClick={toggleScreenShare}
              className={`p-3 rounded-full ${localStreams.screen ? 'bg-blue-200 text-blue-800' : 'bg-[#3c4043] hover:bg-[#4a4f54]'} transition-colors`}
            >
              <MonitorUp className="w-6 h-6" />
            </button>
            <button 
              onClick={leaveRoom}
              className="p-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors px-6 ml-4"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
          </div>

          <div className="flex items-center justify-end space-x-4 w-1/3">
            <div className="flex bg-[#3c4043] rounded-full px-4 py-2 text-sm font-medium mr-2">
              <Users className="w-5 h-5 mr-2" />
              {participantCount}
            </div>
            <button 
              onClick={() => setChatOpen(!chatOpen)}
              className={`p-3 rounded-full transition-colors relative ${chatOpen ? 'bg-blue-200 text-blue-800' : 'bg-[#3c4043] hover:bg-[#4a4f54]'}`}
            >
              <MessageSquare className="w-6 h-6" />
            </button>
          </div>

        </div>
      </div>

      {/* Side Chat Panel */}
      <div 
        className={`fixed right-0 top-0 h-full w-80 bg-white text-gray-900 shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col z-30 ${chatOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="h-16 flex items-center justify-between px-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold">In-call messages</h2>
          <button onClick={() => setChatOpen(false)} className="text-gray-500 hover:bg-gray-100 p-2 rounded-md">
            ✕
          </button>
        </div>

        <div className="p-4 bg-gray-50 text-xs text-gray-500 text-center">
          Messages can only be seen by people in the call and are deleted when the call ends.
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map(msg => (
            <div key={msg.id} className={msg.type === 'system' ? 'text-center' : ''}>
              {msg.type === 'system' ? (
                <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full">{msg.content}</span>
              ) : (
                <div>
                  <div className="flex items-baseline space-x-2 mb-1">
                    <span className="font-semibold text-sm">{msg.displayName}</span>
                    <span className="text-xs text-gray-500">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="bg-gray-100 rounded-bl-none rounded-2xl p-3 text-sm inline-block">
                    {msg.content}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-gray-200">
          <form onSubmit={handleSendMessage} className="flex space-x-2 bg-gray-100 rounded-full pr-2 pl-4 py-1">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Send a message"
              className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-sm py-2"
            />
            <button
              type="submit"
              disabled={!chatInput.trim()}
              className="p-2 rounded-full text-blue-600 disabled:opacity-50 hover:bg-gray-200"
            >
              <Expand className="w-5 h-5 -rotate-45" /> {/* Using outline icon for send */}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

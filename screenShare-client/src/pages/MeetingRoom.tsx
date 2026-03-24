import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  Mic, MicOff, Video, VideoOff, 
  MonitorUp, PhoneOff, MessageSquare, 
  Users, Expand, Hand, Maximize, Minimize, SlidersHorizontal, LayoutGrid, PersonStanding
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

const Tile = ({ entry }: { entry: any }) => (
  <div className="relative w-full h-full bg-[#3c4043] rounded-lg overflow-hidden shadow-lg group flex items-center justify-center">
    {entry.type === 'avatar' ? (
      <div className="w-[30%] min-w-[80px] max-w-[150px] aspect-square rounded-full bg-blue-600 flex items-center justify-center text-4xl sm:text-6xl font-medium text-white shadow-xl">
        {entry.initial}
      </div>
    ) : (
      <VideoPlayer 
        track={entry.track} 
        muted={entry.isLocal} 
        autoPlay 
        className={`absolute inset-0 w-full h-full ${entry.type === 'screen' ? 'object-contain bg-black' : 'object-cover'} ${entry.type === 'video' && entry.isLocal ? '-scale-x-100' : ''}`} 
      />
    )}
    <div className="absolute bottom-3 left-3 bg-black/60 px-3 py-1 rounded text-sm text-white backdrop-blur-md z-10">
      {entry.name}
    </div>
  </div>
);

export function MeetingRoom() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [activeSidebar, setActiveSidebar] = useState<'chat' | 'people' | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'speaker'>('grid');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quality, setQuality] = useState<'low'|'medium'|'high'>('high');
  const [chatInput, setChatInput] = useState('');
  const [toasts, setToasts] = useState<Array<{ id: string; text: string }>>([]);
  
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

          socket.emit('getProducers', (producers: any[]) => {
            if (producers && producers.length > 0) {
              producers.forEach(p => onNewProducer(p));
            }
          });

          // Get local camera/mic
          try {
            const combinedStream = new MediaStream();
            
            try {
              const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
              const audioTrack = audioStream.getAudioTracks()[0];
              if (audioTrack) {
                combinedStream.addTrack(audioTrack);
                await webrtcService.produce(audioTrack, 'audio');
                setLocalStream('audio', true);
              }
            } catch (e) { console.warn('Audio not available initially', e); }

            try {
              const videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
              const videoTrack = videoStream.getVideoTracks()[0];
              if (videoTrack) {
                combinedStream.addTrack(videoTrack);
                await webrtcService.produce(videoTrack, 'video');
                setLocalStream('video', true);
              }
            } catch (e) { console.warn('Video not available initially', e); }

            if (combinedStream.getTracks().length > 0) {
              setLocalDeviceStream(combinedStream);
            } else {
              setLocalDeviceStream(new MediaStream());
            }

          } catch (e) {
            console.error("Could not init media streams", e);
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
    const onHandRaised = (data: any) => {
      const text = data.raised ? `${data.displayName || 'Participant'} raised hand` : `${data.displayName || 'Participant'} lowered hand`;
      addMessage({
        id: Math.random().toString(36).slice(2),
        senderId: data.socketId,
        displayName: data.displayName,
        content: text,
        timestamp: data.timestamp,
        type: 'system'
      });
      const idToast = Math.random().toString(36).slice(2);
      setToasts(prev => [...prev, { id: idToast, text }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== idToast)), 4000);
    };
    const onProducerClosed = (data: any) => {
      // proactively remove the closed producer track
      if (data && data.socketId && data.kind) {
        useAppStore.getState().setRemoteStreamTrack(data.socketId, data.kind, undefined);
      }
    };

    socket.on('participantJoined', onParticipantJoined);
    socket.on('participantLeft', onParticipantLeft);
    socket.on('participantCountUpdated', onParticipantCountUpdated);
    socket.on('newProducer', onNewProducer);
    socket.on('roomMessage', onRoomMessage);
    socket.on('systemMessage', onSystemMessage);
    socket.on('handRaised', onHandRaised);
    socket.on('producerClosed', onProducerClosed);

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
      socket.off('handRaised', onHandRaised);
      socket.off('producerClosed', onProducerClosed);
      clearMessages();
    };
  }, []);

  const toggleMic = async () => {
    if (localStreams.audio) {
      if (localDeviceStream) {
        const audioTrack = localDeviceStream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.stop();
          localDeviceStream.removeTrack(audioTrack);
        }
      }
      try {
        await webrtcService.replaceTrack('audio', null);
      } catch (err) {
        const producer = webrtcService.getProducer('audio');
        if (producer) producer.pause();
      }
      setLocalStream('audio', false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioTrack = stream.getAudioTracks()[0];
        
        if (localDeviceStream) {
          localDeviceStream.addTrack(audioTrack);
        } else {
          setLocalDeviceStream(stream);
        }

        const producer = webrtcService.getProducer('audio');
        if (producer) {
          await webrtcService.replaceTrack('audio', audioTrack);
          if (producer.paused) producer.resume();
        } else {
          await webrtcService.produce(audioTrack, 'audio');
        }
        setLocalStream('audio', true);
      } catch (err) {
        console.error('Error enabling audio:', err);
      }
    }
  };

  const toggleVideo = async () => {
    if (localStreams.video) {
      // Turn off video and camera access
      if (localDeviceStream) {
        const videoTrack = localDeviceStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.stop();
          localDeviceStream.removeTrack(videoTrack);
        }
      }
      try {
        await webrtcService.replaceTrack('video', null);
      } catch (err) {
        // Fallback for older mediasoup versions
        const producer = webrtcService.getProducer('video');
        if (producer) producer.pause();
      }
      setLocalStream('video', false);
    } else {
      // Turn on video
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        const videoTrack = stream.getVideoTracks()[0];
        
        if (localDeviceStream) {
          localDeviceStream.addTrack(videoTrack);
        } else {
          setLocalDeviceStream(stream);
        }

        const producer = webrtcService.getProducer('video');
        if (producer) {
          await webrtcService.replaceTrack('video', videoTrack);
          if (producer.paused) producer.resume();
        } else {
          await webrtcService.produce(videoTrack, 'video');
        }
        setLocalStream('video', true);
      } catch (err) {
        console.error('Error enabling video:', err);
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
  const entries = [];
  
  entries.push({
    id: 'local',
    type: (localDeviceStream?.getVideoTracks()[0] && localStreams.video) ? 'video' : 'avatar',
    track: localDeviceStream?.getVideoTracks()[0] || null,
    name: displayName + ' (You)',
    initial: displayName.charAt(0).toUpperCase(),
    isLocal: true
  });

  if (localScreenStream?.getVideoTracks()[0] && localStreams.screen) {
    entries.push({
      id: 'local-screen',
      type: 'screen',
      track: localScreenStream.getVideoTracks()[0],
      name: displayName + ' (Your Screen)',
      isLocal: true
    });
  }

  // Remote tracks & avatars
  peers.filter(p => p.socketId !== socket.id).forEach(peer => {
    const s = remoteStreams[peer.socketId];
    entries.push({
      id: peer.socketId,
      type: s?.video ? 'video' : 'avatar',
      track: s?.video || null,
      name: peer.displayName || 'Participant',
      initial: (peer.displayName || 'P').charAt(0).toUpperCase(),
      isLocal: false
    });

    if (s?.screen) {
      entries.push({
        id: `${peer.socketId}-screen`,
        type: 'screen',
        track: s.screen,
        name: `${peer.displayName || 'Participant'}'s Screen`,
        isLocal: false
      });
    }
  });

  entries.sort((a, b) => {
    if (a.type === 'screen' && b.type !== 'screen') return -1;
    if (b.type === 'screen' && a.type !== 'screen') return 1;
    return 0;
  });

  const screenShareCount = entries.filter(e => e.type === 'screen').length;
  
  useEffect(() => {
    if (screenShareCount > 0 && viewMode !== 'speaker') {
      setViewMode('speaker');
    }
  }, [screenShareCount]);

  // Calculate grid layout sizes
  const count = entries.length || 1; 
  const cols = viewMode === 'speaker' ? 1 : (count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 2 : count <= 9 ? 3 : 4);

  return (
    <div className="h-screen bg-[#202124] flex overflow-hidden text-white font-sans">
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(t => (
          <div key={t.id} className="bg-black/80 text-white px-4 py-2 rounded-lg shadow-lg border border-white/10">
            {t.text}
          </div>
        ))}
      </div>
      
      {/* Invisible Audio Players for remote users */}
      {Object.values(remoteStreams).map((s, i) => s.audio ? <AudioPlayer key={i} track={s.audio} /> : null)}

      {/* Main Content */}
      <div className={`flex-1 flex flex-col transition-all duration-300 ${activeSidebar ? 'mr-80' : ''}`}>
        
        {/* Top Header */}
        <div className="h-12 flex items-center justify-between px-4 pb-2 pt-4 absolute top-0 w-full z-10 pointer-events-none">
          <div className="bg-black/50 px-3 py-1.5 rounded-md backdrop-blur-sm pointer-events-auto">
            <span className="font-medium">{id}</span>
          </div>
        </div>

        {/* Video Grid Area */}
        <div className="flex-1 p-4 pb-20 flex justify-center items-center relative">
          
          {peers.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none drop-shadow-md">
               <div className="bg-black/60 p-6 rounded-2xl backdrop-blur-md text-center max-w-sm">
                 <Users className="w-12 h-12 mx-auto opacity-70 mb-3" />
                 <p className="text-lg font-medium text-white">You're the only one here right now.</p>
                 <p className="mt-2 text-sm text-gray-300">Waiting for others to join...</p>
               </div>
            </div>
          )}

          {viewMode === 'speaker' ? (
            <div className="flex w-full h-full gap-4 relative items-center">
              <div className="flex-1 h-full w-full relative">
                {entries[0] && <Tile entry={entries[0]} />}
              </div>
              {entries.length > 1 && (
                <div className="w-64 max-h-full flex flex-col gap-3 overflow-y-auto pr-2">
                  {entries.slice(1).map(e => (
                    <div key={e.id} className="w-full aspect-video shrink-0">
                      <Tile entry={e} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div 
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gap: '12px',
                width: '100%',
                maxHeight: '100%',
                aspectRatio: (count === 1 ? '16/9' : 'auto')
              }}
              className="h-full items-center justify-center w-full"
            >
              {entries.map(e => (
                <Tile key={e.id} entry={e} />
              ))}
            </div>
          )}
        </div>

        {/* Bottom Control Bar */}
        <div className="h-20 bg-[#202124] flex items-center justify-between px-6 absolute bottom-0 w-full z-20 transition-all duration-300" style={{ right: activeSidebar ? '20rem' : '0' }}>
          
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
              onClick={() => socket.emit('raiseHand', { raised: true })}
              className="p-3 rounded-full bg-[#3c4043] hover:bg-[#4a4f54] transition-colors"
              title="Raise hand"
            >
              <Hand className="w-6 h-6" />
            </button>
            <button
              onClick={() => setViewMode(v => v === 'grid' ? 'speaker' : 'grid')}
              className="p-3 rounded-full bg-[#3c4043] hover:bg-[#4a4f54] transition-colors"
              title="Toggle view"
            >
              {viewMode === 'grid' ? <PersonStanding className="w-6 h-6" /> : <LayoutGrid className="w-6 h-6" />}
            </button>
            <button
              onClick={() => {
                if (!isFullscreen) {
                  document.documentElement.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(()=>{});
                } else {
                  document.exitFullscreen?.().then(()=>setIsFullscreen(false)).catch(()=>{});
                }
              }}
              className="p-3 rounded-full bg-[#3c4043] hover:bg-[#4a4f54] transition-colors"
              title="Toggle fullscreen"
            >
              {isFullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-3 rounded-full bg-[#3c4043] hover:bg-[#4a4f54] transition-colors"
              title="Settings"
            >
              <SlidersHorizontal className="w-6 h-6" />
            </button>
            <button 
              onClick={leaveRoom}
              className="p-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors px-6 ml-4"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
          </div>

          <div className="flex items-center justify-end space-x-4 w-1/3">
            <button 
              onClick={() => setActiveSidebar(activeSidebar === 'people' ? null : 'people')}
              className={`flex items-center rounded-full px-4 py-2 text-sm font-medium mr-2 transition-colors ${activeSidebar === 'people' ? 'bg-blue-200 text-blue-800' : 'bg-[#3c4043] hover:bg-[#4a4f54]'}`}
            >
              <Users className="w-5 h-5 mr-2" />
              {participantCount}
            </button>
            <button 
              onClick={() => setActiveSidebar(activeSidebar === 'chat' ? null : 'chat')}
              className={`p-3 rounded-full transition-colors relative ${activeSidebar === 'chat' ? 'bg-blue-200 text-blue-800' : 'bg-[#3c4043] hover:bg-[#4a4f54]'}`}
            >
              <MessageSquare className="w-6 h-6" />
            </button>
          </div>

        </div>
      </div>

      {/* Sidebar Panel */}
      <div 
        className={`fixed right-0 top-0 h-full w-80 bg-white text-gray-900 shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col z-30 ${activeSidebar ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="h-16 flex items-center justify-between px-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold">{activeSidebar === 'chat' ? 'In-call messages' : 'People'}</h2>
          <button onClick={() => setActiveSidebar(null)} className="text-gray-500 hover:bg-gray-100 p-2 rounded-md">
            ✕
          </button>
        </div>

        {activeSidebar === 'chat' ? (
          <>
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
                  <Expand className="w-5 h-5 -rotate-45" />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="flex items-center space-x-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{displayName} (You)</p>
                <p className="text-xs text-gray-500">Meeting Host</p>
              </div>
            </div>
            {peers.map(peer => (
              <div key={peer.socketId} className="flex items-center space-x-3 border-t border-gray-100 pt-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-lg">
                  {(peer.displayName || 'P').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{peer.displayName || 'Participant'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40">
          <div className="w-[520px] bg-[#2a2d31] text-white rounded-xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-[#3a3f45]">
              <h2 className="text-lg font-semibold">Settings</h2>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <p className="text-sm text-gray-300 mb-2">Performance</p>
                <div className="flex gap-2">
                  {(['low','medium','high'] as const).map(q => (
                    <button
                      key={q}
                      onClick={() => { setQuality(q); webrtcService.setQuality(q); }}
                      className={`px-3 py-2 rounded-md ${quality === q ? 'bg-blue-600' : 'bg-[#3a3f45] hover:bg-[#4a4f54]'}`}
                    >
                      {q.toUpperCase()}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">Lower quality reduces bandwidth and CPU usage.</p>
              </div>
            </div>
            <div className="p-4 border-t border-[#3a3f45] flex justify-end">
              <button onClick={() => setSettingsOpen(false)} className="px-4 py-2 bg-blue-600 rounded-md">OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

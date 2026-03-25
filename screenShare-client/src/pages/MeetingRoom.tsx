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

const VideoPlayer = ({ track, autoPlay, className }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && track) {
      const stream = new MediaStream([track]);
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => console.error("Error playing video:", e));
    }
  }, [track]);

  return (
    <video
      ref={videoRef}
      autoPlay={autoPlay}
      playsInline
      // Always mute VideoPlayer because remote audio is handled via separate AudioPlayer. 
      // Unmuted dynamically added videos are often blocked by browsers, causing blank screens.
      muted={true}
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
        autoPlay 
        className={`absolute inset-0 w-full h-full ${entry.type === 'screen' ? 'object-contain bg-black' : 'object-cover'} ${entry.type === 'video' && entry.isLocal ? '-scale-x-100' : ''}`} 
      />
    )}
    <div className="absolute bottom-3 left-3 bg-black/60 px-3 py-1 rounded text-sm text-white backdrop-blur-md z-10">
      {entry.name}
    </div>
  </div>
);

const ControlButton = ({ 
  onClick, 
  className,
  title,
  ariaLabel,
  children
}: {
  onClick: (e: any) => void;
  className: string;
  title: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    title={title}
    aria-label={ariaLabel || title}
    role="button"
    tabIndex={0}
    onMouseDown={(e) => e.stopPropagation()}
    onTouchStart={(e) => {
      // Prevents ghost clicks on certain mobile browsers
      e.stopPropagation();
    }}
    onClick={(e) => {
      e.stopPropagation();
      onClick(e);
    }}
    onKeyDown={(e) => { 
      if (e.key === 'Enter' || e.key === ' ') { 
        e.preventDefault(); 
        e.stopPropagation();
        onClick(e); 
      } 
    }}
    className={`p-2 sm:p-3 rounded-full transition-colors cursor-pointer focus:outline-none focus:ring-2 select-none shrink-0 ${className}`}
  >
    {children}
  </button>
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
  
  const showToast = (msg: string) => {
    const idToast = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id: idToast, text: msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== idToast)), 5000);
  };
  
  const [localDeviceStream, setLocalDeviceStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const localDeviceStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);

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

  const onNewProducer = async (data: any) => {
    try {
      const exists = useAppStore.getState().peers.some(p => p.socketId === data.socketId);
      if (!exists) {
        addPeer({ socketId: data.socketId, displayName: 'Participant' });
      }
      await webrtcService.consume(data.producerId, data.socketId, data.kind);
    } catch (err) {
      console.error('Error consuming new producer:', err);
    }
  };

  useEffect(() => {
    if (!displayName || !id) {
      navigate('/');
      return;
    }
    let isUnmounted = false;

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

          if (response.producers && Array.isArray(response.producers) && response.producers.length > 0) {
            for (const p of response.producers) {
              onNewProducer(p);
            }
          }

          socket.emit('getProducers', (producers: any[]) => {
            if (producers && producers.length > 0) {
              producers.forEach(p => onNewProducer(p));
            }
          });

          // Get local camera/mic
          try {
            const combinedStream = new MediaStream();
            
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
              showToast("Camera/Mic access requires a secure HTTPS connection or localhost.");
            } else {
              try {
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const audioTrack = audioStream.getAudioTracks()[0];
                if (isUnmounted && audioTrack) {
                  audioTrack.stop();
                } else if (audioTrack) {
                  combinedStream.addTrack(audioTrack);
                  await webrtcService.produce(audioTrack, 'audio');
                  setLocalStream('audio', true);
                }
              } catch (e: any) { 
                console.warn('Audio not available initially', e); 
                if (e.name === 'NotAllowedError') showToast('Microphone access denied. Please allow it in browser settings.');
              }

              try {
                const videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
                const videoTrack = videoStream.getVideoTracks()[0];
                if (isUnmounted && videoTrack) {
                  videoTrack.stop();
                } else if (videoTrack) {
                  combinedStream.addTrack(videoTrack);
                  await webrtcService.produce(videoTrack, 'video');
                  setLocalStream('video', true);
                }
              } catch (e: any) { 
                console.warn('Video not available initially', e); 
                if (e.name === 'NotAllowedError') showToast('Camera access denied. Please allow it in browser settings.');
              }
            }

            if (combinedStream.getTracks().length > 0) {
              setLocalDeviceStream(combinedStream);
              localDeviceStreamRef.current = combinedStream;
            } else {
              const emptyStream = new MediaStream();
              setLocalDeviceStream(emptyStream);
              localDeviceStreamRef.current = emptyStream;
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
    const onParticipantJoined = (data: any) => {
      addPeer(data);
      // Refresh producers list to avoid missing any in-flight produce events
      socket.emit('getProducers', (producers: any[]) => {
        if (producers && producers.length > 0) {
          producers.forEach(p => onNewProducer(p));
        }
      });
    };
    const onParticipantLeft = (data: any) => {
      removePeer(data.socketId);
      removeRemotePeerStreams(data.socketId);
    };
    const onParticipantCountUpdated = (data: any) => setParticipantCount(data.count);
    
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
      if (data?.producerId) {
        webrtcService.markProducerClosed?.(data.producerId);
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
      isUnmounted = true;
      socket.emit('leaveRoom');
      webrtcService.close();
      if (localDeviceStreamRef.current) {
        localDeviceStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (localScreenStreamRef.current) {
        localScreenStreamRef.current.getTracks().forEach(t => t.stop());
      }
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
      if (localDeviceStreamRef.current) localDeviceStreamRef.current.getTracks().forEach(t => t.stop());
      if (localScreenStreamRef.current) localScreenStreamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const toggleMic = async () => {
    if (localStreams.audio) {
      if (localDeviceStreamRef.current) {
        const audioTrack = localDeviceStreamRef.current.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.stop();
          localDeviceStreamRef.current.removeTrack(audioTrack);
        }
      }
      webrtcService.stopProduce('audio');
      setLocalStream('audio', false);
    } else {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Media devices API not available. This usually requires HTTPS.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioTrack = stream.getAudioTracks()[0];
        
        if (localDeviceStreamRef.current) {
          localDeviceStreamRef.current.getAudioTracks().forEach(t => {
            t.stop();
            localDeviceStreamRef.current?.removeTrack(t);
          });
          localDeviceStreamRef.current.addTrack(audioTrack);
        } else {
          setLocalDeviceStream(stream);
          localDeviceStreamRef.current = stream;
        }

        const producer = webrtcService.getProducer('audio');
        if (producer) {
          await webrtcService.replaceTrack('audio', audioTrack);
          if (producer.paused) producer.resume();
        } else {
          await webrtcService.produce(audioTrack, 'audio');
        }
        setLocalStream('audio', true);
      } catch (err: any) {
        console.error('Error enabling audio:', err);
        if (err.name === 'NotAllowedError') showToast('Microphone permission denied. Please allow it in browser settings.');
        else showToast(err.message || 'Could not access microphone');
      }
    }
  };

  const toggleVideo = async () => {
    if (localStreams.video) {
      // Turn off video and camera access
      if (localDeviceStreamRef.current) {
        const videoTrack = localDeviceStreamRef.current.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.stop();
          localDeviceStreamRef.current.removeTrack(videoTrack);
        }
      }
      webrtcService.stopProduce('video');
      setLocalStream('video', false);
    } else {
      // Turn on video
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Media devices API not available. This usually requires HTTPS.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        const videoTrack = stream.getVideoTracks()[0];
        
        if (localDeviceStreamRef.current) {
          localDeviceStreamRef.current.getVideoTracks().forEach(t => {
            t.stop();
            localDeviceStreamRef.current?.removeTrack(t);
          });
          localDeviceStreamRef.current.addTrack(videoTrack);
        } else {
          setLocalDeviceStream(stream);
          localDeviceStreamRef.current = stream;
        }

        const producer = webrtcService.getProducer('video');
        if (producer) {
          await webrtcService.replaceTrack('video', videoTrack);
          if (producer.paused) producer.resume();
        } else {
          await webrtcService.produce(videoTrack, 'video');
        }
        setLocalStream('video', true);
      } catch (err: any) {
        console.error('Error enabling video:', err);
        if (err.name === 'NotAllowedError') showToast('Camera permission denied. Please allow it in browser settings.');
        else showToast(err.message || 'Could not access camera');
      }
    }
  };

  const toggleScreenShare = async () => {
    if (localStreams.screen) {
      webrtcService.stopProduce('screen');
      if (localScreenStreamRef.current) {
        localScreenStreamRef.current.getTracks().forEach(t => t.stop());
      }
      setLocalScreenStream(null);
      localScreenStreamRef.current = null;
      setLocalStream('screen', false);
    } else {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          throw new Error('Screen sharing API not available. This usually requires HTTPS.');
        }
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: 1920, height: 1080 },
          audio: false
        });
        
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          await webrtcService.produce(videoTrack, 'screen');
          setLocalScreenStream(stream);
          localScreenStreamRef.current = stream;
          setLocalStream('screen', true);

          videoTrack.onended = () => {
            webrtcService.stopProduce('screen');
            if (localScreenStreamRef.current) {
              localScreenStreamRef.current.getTracks().forEach(t => t.stop());
            }
            setLocalScreenStream(null);
            localScreenStreamRef.current = null;
            setLocalStream('screen', false);
          };
        }
      } catch (err: any) {
        console.error('Error sharing screen', err);
        if (err.name !== 'NotAllowedError') {
          showToast(err.message || 'Could not start screen share');
        }
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
    try {
      socket.emit('leaveRoom', () => {
        try {
          webrtcService.close();
          localDeviceStream?.getTracks().forEach(t => t.stop());
          localScreenStream?.getTracks().forEach(t => t.stop());
          socket.disconnect();
        } finally {
          navigate('/');
        }
      });
    } catch {
      navigate('/');
    }
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

        {/* Bottom Control Bar (fixed, always clickable) */}
        <div
          className="fixed bottom-0 left-0 right-0 bg-[#202124] flex items-center justify-between px-2 sm:px-6 z-[1000] transition-all duration-300 pointer-events-auto shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
          style={{ 
            paddingRight: activeSidebar ? '20rem' : (window.innerWidth < 640 ? '0.5rem' : '1.5rem'),
            height: 'calc(5rem + env(safe-area-inset-bottom))',
            paddingBottom: 'env(safe-area-inset-bottom)'
          }}
          role="region"
          aria-label="In-call controls"
        >
          
          <div className="flex-1 hidden md:flex items-center space-x-4 overflow-hidden">
            <div className="text-lg font-medium whitespace-nowrap overflow-hidden text-ellipsis text-gray-300">{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} | {id}</div>
          </div>

          <div className="flex-none flex items-center justify-center space-x-2 md:space-x-4 z-10 relative overflow-x-auto overflow-y-hidden scrollbar-hide py-2 max-w-[85%] md:max-w-full">
            <ControlButton 
              onClick={toggleMic}
              className={`${localStreams.audio ? 'bg-[#3c4043] hover:bg-[#4a4f54] focus:ring-blue-400' : 'bg-red-500 hover:bg-red-600 focus:ring-red-400'} text-white`}
              title={localStreams.audio ? "Turn off microphone" : "Turn on microphone"}
            >
              {localStreams.audio ? <Mic className="w-5 h-5 sm:w-6 sm:h-6" /> : <MicOff className="w-5 h-5 sm:w-6 sm:h-6" />}
            </ControlButton>
            <ControlButton 
              onClick={toggleVideo}
              className={`${localStreams.video ? 'bg-[#3c4043] hover:bg-[#4a4f54] focus:ring-blue-400' : 'bg-red-500 hover:bg-red-600 focus:ring-red-400'} text-white`}
              title={localStreams.video ? "Turn off camera" : "Turn on camera"}
            >
              {localStreams.video ? <Video className="w-5 h-5 sm:w-6 sm:h-6" /> : <VideoOff className="w-5 h-5 sm:w-6 sm:h-6" />}
            </ControlButton>
            <ControlButton 
              onClick={toggleScreenShare}
              className={`${localStreams.screen ? 'bg-blue-200 text-blue-800 focus:ring-blue-400' : 'bg-[#3c4043] hover:bg-[#4a4f54] text-white focus:ring-blue-400'}`}
              title={localStreams.screen ? "Stop presenting" : "Present now"}
            >
              <MonitorUp className="w-5 h-5 sm:w-6 sm:h-6" />
            </ControlButton>
            <ControlButton 
              onClick={() => socket.emit('raiseHand', { raised: true })}
              className="bg-[#3c4043] hover:bg-[#4a4f54] text-white focus:ring-blue-400"
              title="Raise hand"
            >
              <Hand className="w-5 h-5 sm:w-6 sm:h-6" />
            </ControlButton>
            <ControlButton
              onClick={() => setViewMode(v => v === 'grid' ? 'speaker' : 'grid')}
              className="bg-[#3c4043] hover:bg-[#4a4f54] text-white focus:ring-blue-400 hidden sm:block"
              title="Toggle view"
            >
              {viewMode === 'grid' ? <PersonStanding className="w-5 h-5 sm:w-6 sm:h-6" /> : <LayoutGrid className="w-5 h-5 sm:w-6 sm:h-6" />}
            </ControlButton>
            <ControlButton
              onClick={() => {
                const docEl = document.documentElement as any;
                if (!isFullscreen) {
                  const reqFS = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.msRequestFullscreen;
                  if (reqFS) reqFS.call(docEl).then(() => setIsFullscreen(true)).catch(()=>{});
                  else alert("Fullscreen is not natively supported on this device.");
                } else {
                  const exitFS = document.exitFullscreen || (document as any).webkitExitFullscreen || (document as any).msExitFullscreen;
                  if (exitFS) exitFS.call(document).then(()=>setIsFullscreen(false)).catch(()=>{});
                }
              }}
              className="bg-[#3c4043] hover:bg-[#4a4f54] text-white focus:ring-blue-400 hidden sm:block"
              title="Toggle fullscreen"
            >
              {isFullscreen ? <Minimize className="w-5 h-5 sm:w-6 sm:h-6" /> : <Maximize className="w-5 h-5 sm:w-6 sm:h-6" />}
            </ControlButton>
            <ControlButton
              onClick={() => setSettingsOpen(true)}
              className="bg-[#3c4043] hover:bg-[#4a4f54] text-white focus:ring-blue-400"
              title="Settings"
            >
              <SlidersHorizontal className="w-5 h-5 sm:w-6 sm:h-6" />
            </ControlButton>
            <ControlButton 
              onClick={leaveRoom}
              className="bg-red-500 hover:bg-red-600 focus:ring-red-400 text-white px-5 sm:px-6 ml-1 sm:ml-4"
              title="Leave call"
            >
              <PhoneOff className="w-5 h-5 sm:w-6 sm:h-6" />
            </ControlButton>
          </div>

          <div className="flex-1 flex items-center justify-end space-x-2 md:space-x-4">
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

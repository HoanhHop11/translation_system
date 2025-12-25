import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import io from 'socket.io-client';
import { Device } from 'mediasoup-client';
import ENV from '../config/env';
// ❌ DISABLED: Echo Suppression - Root cause was shared VAD on Gateway
// import remoteAudioMonitorService from '../services/RemoteAudioMonitorService';

/**
 * WebRTC Context - MediaSoup SFU Architecture
 * 
 * Features:
 * - MediaSoup SFU for video/audio streaming (scalable for N users)
 * - Server-side audio translation pipeline (STT → Translation → TTS)
 * - Real-time captions (original + translated)
 * - Chat messaging
 * - Room management
 */

const WebRTCContext = createContext(null);

// Feature flag: khi true, chỉ dùng caption từ Gateway, bỏ qua legacy transcription đẩy từ client STT
const USE_GATEWAY_ASR = true;

export const useWebRTC = () => {
  const context = useContext(WebRTCContext);
  if (!context) {
    throw new Error('useWebRTC must be used within WebRTCProvider');
  }
  return context;
};

export const WebRTCProvider = ({ children }) => {
  // ==========================================
  // SOCKET & CONNECTION STATE
  // ==========================================

  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [roomId, setRoomId] = useState(null);
  const [userId, setUserId] = useState(null);
  const [participantId, setParticipantId] = useState(null);

  // Echo Suppression State (DISABLED - Root cause was shared VAD on Gateway)
  // const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);
  const [userAudioEnabled, setUserAudioEnabled] = useState(true);

  // ❌ DISABLED: Echo Suppression không cần thiết sau khi fix per-participant VAD
  // Start Remote Monitor
  // useEffect(() => {
  //   remoteAudioMonitorService.start((isSpeaking) => {
  //     setIsRemoteSpeaking(isSpeaking);
  //   });
  //   return () => remoteAudioMonitorService.stop();
  // }, []);

  // ❌ DISABLED: Soft Mute Logic gây ra vấn đề không thể barge-in
  // Soft Mute Logic (Echo Suppression)
  // useEffect(() => {
  //   if (!localStream) return;
  //   const audioTrack = localStream.getAudioTracks()[0];
  //   if (!audioTrack) return;
  //
  //   // Logic: Enable mic ONLY if User wants it AND Remote is NOT speaking
  //   // This allows Soft Mute (sending silence) when remote speaks to prevent echo
  //   // The Gateway receives silence, so STT doesn't pick up echo.
  //   const shouldEnable = userAudioEnabled && !isRemoteSpeaking;
  //
  //   if (audioTrack.enabled !== shouldEnable) {
  //     audioTrack.enabled = shouldEnable;
  //
  //     // Only log if it's an automatic suppressed event (User enabled but system disabled)
  //     if (userAudioEnabled && !shouldEnable) {
  //       console.log('🔇 Echo Suppression: Soft Muting Microphone');
  //     } else if (userAudioEnabled && shouldEnable && isRemoteSpeaking === false) {
  //       // Logic check: if we are here, isRemoteSpeaking just became false
  //       console.log('🔊 Echo Suppression: Unmuting Microphone');
  //     }
  //   }
  // }, [localStream, userAudioEnabled, isRemoteSpeaking]);



  // ==========================================
  // MEDIASOUP STATE
  // ==========================================

  const [isDeviceLoaded, setIsDeviceLoaded] = useState(false);
  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);

  // Producers: Map<kind, Producer> - our local media
  const producersRef = useRef(new Map());

  // Consumers: Map<consumerId, { consumer, participantId, kind }>
  const consumersRef = useRef(new Map());

  // ==========================================
  // MEDIA STREAMS STATE
  // ==========================================

  const [localStream, setLocalStream] = useState(null);
  const localStreamRef = useRef(null);

  // Remote streams: Map<participantId, MediaStream>
  const [remoteStreams, setRemoteStreams] = useState(new Map());

  // ==========================================
  // PARTICIPANTS & UI STATE
  // ==========================================

  // Participants: Map<participantId, { name, sourceLanguage, targetLanguage }>
  const [participants, setParticipants] = useState(new Map());

  // Connection states: Map<participantId, 'connecting' | 'connected' | 'disconnected'>
  const [connectionState, setConnectionState] = useState(new Map());

  // ==========================================
  // TRANSLATION STATE
  // ==========================================

  const [sourceLanguage, setSourceLanguage] = useState('vi');
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [transcriptions, setTranscriptions] = useState([]);
  const [translatedAudioQueue, setTranslatedAudioQueue] = useState([]);
  // 🔥 NEW: Lưu translations đã được Gateway xử lý sẵn (tránh duplicate API call)
  const [serverTranslations, setServerTranslations] = useState(new Map()); // key: `${participantId}-${timestamp}` → translatedText
  const setupLocalTranslationRef = useRef(false);

  // Update language settings to server when changed
  useEffect(() => {
    if (!socket || !isConnected) return;

    console.log('🌐 Syncing language settings to server:', { sourceLanguage, targetLanguage });
    socket.emit('update-language', {
      sourceLanguage,
      targetLanguage
    });
  }, [socket, isConnected, sourceLanguage, targetLanguage]);

  // ==========================================
  // INITIALIZE SOCKET CONNECTION
  // ==========================================

  const initializeSocket = useCallback(() => {
    const GATEWAY_URL = ENV.GATEWAY_URL;

    console.log('🔌 Connecting to Gateway SFU:', GATEWAY_URL);

    const newSocket = io(GATEWAY_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    newSocket.on('connect', () => {
      console.log('✅ Socket connected:', newSocket.id);
      setIsConnected(true);
      setUserId(newSocket.id);
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Socket disconnected');
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('🔴 Socket connection error:', error);
    });

    setSocket(newSocket);

    return newSocket;
  }, []);

  // Initialize socket on mount
  useEffect(() => {
    const sock = initializeSocket();

    return () => {
      if (sock) {
        sock.disconnect();
      }
    };
  }, [initializeSocket]);

  // ==========================================
  // SOCKET EVENT LISTENERS
  // ==========================================

  useEffect(() => {
    if (!socket) return;

    // New producer from other participant
    socket.on('new-producer', async ({ participantId: remotePId, producerId, kind }) => {
      console.log('🆕 New producer:', { remotePId, producerId, kind });

      try {
        // Consume the new producer
        await consumeProducer(producerId, remotePId, kind);
      } catch (error) {
        console.error('❌ Error consuming new producer:', error);
      }
    });

    // Producer closed
    socket.on('producer-closed', ({ participantId: remotePId, producerId }) => {
      console.log('🛑 Producer closed:', { remotePId, producerId });

      // Find and close corresponding consumer
      consumersRef.current.forEach((consumerData, consumerId) => {
        if (consumerData.consumer.producerId === producerId) {
          consumerData.consumer.close();
          consumersRef.current.delete(consumerId);

          // Update remote streams
          updateRemoteStream(remotePId);
        }
      });
    });

    // Participant joined
    socket.on('participant-joined', (data) => {
      const { participantId: remotePId, name, sourceLanguage, targetLanguage } = data;
      console.log('👤 Participant joined:', data);

      setParticipants(prev => {
        const newMap = new Map(prev);
        newMap.set(remotePId, { name, sourceLanguage, targetLanguage });
        return newMap;
      });
    });

    // Participant left
    socket.on('participant-left', ({ participantId: remotePId }) => {
      console.log('👋 Participant left:', remotePId);

      setParticipants(prev => {
        const newMap = new Map(prev);
        newMap.delete(remotePId);
        return newMap;
      });

      setRemoteStreams(prev => {
        const newMap = new Map(prev);
        newMap.delete(remotePId);
        return newMap;
      });

      setConnectionState(prev => {
        const newMap = new Map(prev);
        newMap.delete(remotePId);
        return newMap;
      });

      // ❌ DISABLED: Echo Suppression - Root cause was shared VAD on Gateway
      // remoteAudioMonitorService.untrackStream(remotePId);
    });

    // Transcription (captions) - legacy; khi USE_GATEWAY_ASR=true chỉ bỏ qua nếu source rõ ràng KHÔNG phải gateway.
    // Các event cũ không có field `source` vẫn được chấp nhận để tương thích với gateway image cũ.
    socket.on('transcription', (data) => {
      // Nếu dùng Gateway ASR (mode mới), bỏ qua hoàn toàn legacy event để tránh duplicate
      // Gateway đã gửi event 'gateway-caption' rồi.
      if (USE_GATEWAY_ASR) {
        return;
      }
      const { participantId: remotePId, type, text, language, timestamp, isFinal } = data;

      setTranscriptions(prev => [...prev, {
        id: `${remotePId}-${timestamp}`,
        participantId: remotePId,
        type,
        text,
        language,
        timestamp,
        isFinal: isFinal ?? true,
        source: data?.source || 'legacy'
      }].slice(-10)); // Keep last 10 captions
    });

    // Gateway caption (new event)
    socket.on('gateway-caption', (data) => {
      const { speakerId, text, language, isFinal, timestamp, seq } = data;

      // 🔍 DEBUG: Log để xác định caption của ai
      // Lấy myParticipantId từ closure hoặc từ socket data
      const myPId = socket._myParticipantId; // Sẽ set sau khi join room
      const isMyCaption = speakerId === myPId;

      if (isMyCaption) {
        console.log(`🎤 [MY CAPTION] seq=${seq} text="${text}" lang=${language}`);
      } else {
        console.log(`👤 [OTHER] ${speakerId.slice(-8)} seq=${seq} text="${text}" lang=${language}`);
      }

      setTranscriptions(prev => [...prev, {
        id: `${speakerId}-${timestamp || Date.now()}-${seq}`,
        participantId: speakerId,
        speakerId: speakerId || undefined,
        text,
        language,
        isFinal: !!isFinal,
        timestamp: timestamp || Date.now(),
        source: 'gateway'
      }].slice(-10));
    });

    socket.on('caption-status', (data) => {
      console.warn('Caption status event', data);
    });

    // 🔥 NEW: Gateway translation event (pre-translated text từ server)
    // Lưu lại để TranslationContext sử dụng thay vì gọi Translation API lại
    socket.on('translation', (data) => {
      const { participantId, originalText, translatedText, sourceLanguage, targetLanguage, timestamp } = data;

      // Chỉ lưu translation nếu targetLanguage match với user's target
      // (Gateway broadcast cho tất cả target languages)
      console.log('📥 Received server translation:', {
        participantId,
        originalText: originalText?.substring(0, 30) + '...',
        translatedText: translatedText?.substring(0, 30) + '...',
        targetLanguage
      });

      // Store với key để TranslationContext có thể lookup
      const key = `${participantId}-${originalText?.trim()}`;
      setServerTranslations(prev => {
        const newMap = new Map(prev);
        // Lưu theo cả key text và targetLanguage
        newMap.set(`${key}-${targetLanguage}`, {
          translatedText,
          sourceLanguage,
          targetLanguage,
          timestamp: timestamp || Date.now()
        });
        // Cleanup old entries (keep last 50)
        if (newMap.size > 50) {
          const entries = Array.from(newMap.entries());
          return new Map(entries.slice(-50));
        }
        return newMap;
      });
    });

    // Translated audio
    socket.on('translated-audio', async (data) => {
      const { audioData } = data;
      setTranslatedAudioQueue(prev => [...prev, audioData]);
    });

    // Chat message
    socket.on('chat-message', (message) => {
      // Handle chat messages (will be consumed by ChatPanel)
      console.log('💬 Chat message received:', message);
    });

    return () => {
      socket.off('new-producer');
      socket.off('producer-closed');
      socket.off('participant-joined');
      socket.off('participant-left');
      socket.off('transcription');
      socket.off('translation');
      socket.off('translated-audio');
      socket.off('chat-message');
    };
  }, [socket]);

  // ==========================================
  // MEDIASOUP DEVICE MANAGEMENT
  // ==========================================

  const loadDevice = useCallback(async (rtpCapabilities) => {
    try {
      if (deviceRef.current) {
        console.log('⚠️ Device already loaded');
        return deviceRef.current;
      }

      console.log('🔧 Creating MediaSoup Device...');
      const device = new Device();

      console.log('📡 Loading device with RTP capabilities from join-room...');
      await device.load({ routerRtpCapabilities: rtpCapabilities });

      deviceRef.current = device;
      setIsDeviceLoaded(true);

      console.log('✅ MediaSoup Device loaded', {
        canProduceVideo: device.canProduce('video'),
        canProduceAudio: device.canProduce('audio'),
      });

      return device;
    } catch (error) {
      console.error('❌ Error loading device:', error);
      throw error;
    }
  }, []);

  // ==========================================
  // TRANSPORT MANAGEMENT
  // ==========================================

  const createSendTransport = useCallback(async () => {
    try {
      if (sendTransportRef.current) {
        console.log('⚠️ Send transport already exists');
        return sendTransportRef.current;
      }

      const device = deviceRef.current;
      if (!device) {
        throw new Error('Device not loaded');
      }

      console.log('🚀 Creating send transport...');

      const transportOptions = await new Promise((resolve, reject) => {
        socket.emit('create-webrtc-transport', { producing: true }, (response) => {
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response);
          }
        });
      });

      const sendTransport = device.createSendTransport(transportOptions);

      sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await new Promise((resolve, reject) => {
            socket.emit('connect-webrtc-transport', {
              transportId: sendTransport.id,
              dtlsParameters,
            }, (response) => {
              if (response.error) {
                reject(new Error(response.error.message));
              } else {
                resolve();
              }
            });
          });
          callback();
        } catch (error) {
          errback(error);
        }
      });

      sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
        try {
          const { producerId } = await new Promise((resolve, reject) => {
            socket.emit('produce', {
              transportId: sendTransport.id,
              kind,
              rtpParameters,
              appData: appData || {},
            }, (response) => {
              if (response.error) {
                reject(new Error(response.error.message));
              } else {
                resolve(response);
              }
            });
          });
          console.log(`📡 Producer ID received from Gateway:`, producerId);
          callback({ id: producerId });
        } catch (error) {
          errback(error);
        }
      });

      sendTransportRef.current = sendTransport;
      console.log('✅ Send transport created:', sendTransport.id);

      return sendTransport;
    } catch (error) {
      console.error('❌ Error creating send transport:', error);
      throw error;
    }
  }, [socket]);

  const createRecvTransport = useCallback(async () => {
    try {
      if (recvTransportRef.current) {
        console.log('⚠️ Recv transport already exists');
        return recvTransportRef.current;
      }

      const device = deviceRef.current;
      if (!device) {
        throw new Error('Device not loaded');
      }

      console.log('🚀 Creating recv transport...');

      const transportOptions = await new Promise((resolve, reject) => {
        socket.emit('create-webrtc-transport', { producing: false }, (response) => {
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response);
          }
        });
      });

      const recvTransport = device.createRecvTransport(transportOptions);

      recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await new Promise((resolve, reject) => {
            socket.emit('connect-webrtc-transport', {
              transportId: recvTransport.id,
              dtlsParameters,
            }, (response) => {
              if (response.error) {
                reject(new Error(response.error.message));
              } else {
                resolve();
              }
            });
          });
          callback();
        } catch (error) {
          errback(error);
        }
      });

      recvTransportRef.current = recvTransport;
      console.log('✅ Recv transport created:', recvTransport.id);

      return recvTransport;
    } catch (error) {
      console.error('❌ Error creating recv transport:', error);
      throw error;
    }
  }, [socket]);

  // ==========================================
  // MEDIA PRODUCTION & CONSUMPTION
  // ==========================================

  const produceMedia = useCallback(async (track, appData = {}) => {
    try {
      const sendTransport = sendTransportRef.current;
      if (!sendTransport) {
        throw new Error('Send transport not created');
      }

      console.log(`🎥 Producing ${track.kind} track...`, {
        trackId: track.id,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState
      });

      const producer = await sendTransport.produce({
        track,
        appData,
      });

      producersRef.current.set(track.kind, producer);

      // 🔍 DEBUG: Log chi tiết producer
      console.log(`✅ ${track.kind} producer created:`, {
        producerId: producer.id,
        kind: producer.kind,
        paused: producer.paused,
        closed: producer.closed
      });

      producer.on('trackended', () => {
        console.log(`🛑 ${track.kind} track ended`);
      });

      producer.on('transportclose', () => {
        console.log(`🔌 ${track.kind} transport closed`);
        producersRef.current.delete(track.kind);
      });

      console.log(`✅ ${track.kind} producer created:`, producer.id);

      return producer;
    } catch (error) {
      console.error(`❌ Error producing ${track.kind}:`, error);
      throw error;
    }
  }, []);

  const consumeProducer = useCallback(async (producerId, remotePId, kind) => {
    try {
      const recvTransport = recvTransportRef.current;
      const device = deviceRef.current;

      if (!recvTransport || !device) {
        throw new Error('Recv transport or device not ready');
      }

      console.log('🔽 Consuming producer:', { producerId, remotePId, kind });

      const { id, rtpParameters, kind: consumerKind } = await new Promise((resolve, reject) => {
        socket.emit('consume', {
          producerId,
          rtpCapabilities: device.rtpCapabilities,
        }, (response) => {
          if (!response) {
            reject(new Error('No response from consume'));
          } else if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response);
          }
        });
      });

      const consumer = await recvTransport.consume({
        id,
        producerId,
        kind: consumerKind,
        rtpParameters,
      });

      consumersRef.current.set(consumer.id, {
        consumer,
        participantId: remotePId,
        kind: consumerKind
      });

      consumer.on('transportclose', () => {
        console.log('🔌 Consumer transport closed:', consumer.id);
        consumersRef.current.delete(consumer.id);
      });

      // Resume consumer
      await new Promise((resolve, reject) => {
        socket.emit('resume-consumer', { consumerId: consumer.id }, (response) => {
          if (!response) {
            // Resume không trả data, chỉ callback empty = success
            resolve();
          } else if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve();
          }
        });
      });

      console.log('✅ Consumer created:', consumer.id, consumerKind);

      // Update remote stream
      updateRemoteStream(remotePId);

      return consumer;
    } catch (error) {
      console.error('❌ Error consuming:', error);
      throw error;
    }
  }, [socket]);

  // Update remote stream helper
  const updateRemoteStream = useCallback((remotePId) => {
    const stream = new MediaStream();

    consumersRef.current.forEach((consumerData) => {
      if (consumerData.participantId === remotePId) {
        stream.addTrack(consumerData.consumer.track);
      }
    });

    if (stream.getTracks().length > 0) {
      setRemoteStreams(prev => {
        const newMap = new Map(prev);
        newMap.set(remotePId, stream);
        return newMap;
      });

      setConnectionState(prev => {
        const newMap = new Map(prev);
        newMap.set(remotePId, 'connected');
        return newMap;
      });

      // ❌ DISABLED: Echo Suppression - Root cause was shared VAD on Gateway
      // remoteAudioMonitorService.trackStream(remotePId, stream);

      // Translation setup moved to RoomMeet level to avoid circular dependency
    }
  }, []);

  // ==========================================
  // LOCAL MEDIA MANAGEMENT
  // ==========================================

  const getLocalStream = useCallback(async () => {
    try {
      if (localStreamRef.current) {
        console.log('⚠️ Local stream already exists');
        return localStreamRef.current;
      }

      console.log('🎥 Getting local media...');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      localStreamRef.current = stream;
      setLocalStream(stream);

      console.log('✅ Got local stream:', stream.id);

      return stream;
    } catch (error) {
      console.error('❌ Error getting local media:', error);
      throw error;
    }
  }, []);

  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        // Toggle User Intention State
        const newState = !userAudioEnabled;
        setUserAudioEnabled(newState);

        // Note: We DO NOT toggle audioTrack.enabled here physically for the state.
        // We let the Echo Suppression useEffect handle the track.enabled property.
        // However, we DO need to notify Gateway about "Producer Pause" if the USER strictly wants to mute.
        // If it's just Echo Suppression, we don't pause producer (we send silence).

        // 🔇 Notify Gateway về pause/resume producer (User Action)
        const audioProducer = producersRef.current.get('audio');
        if (audioProducer && socket) {
          const producerId = audioProducer.id;
          if (producerId) {
            if (newState) {
              // User Unmute -> Resume producer
              socket.emit('resume-producer', { producerId }, (response) => {
                if (response?.error) {
                  console.error('❌ Failed to resume producer:', response.error);
                } else {
                  console.log('🔊 Audio producer resumed on Gateway');
                }
              });
            } else {
              // User Mute -> Pause producer
              socket.emit('pause-producer', { producerId }, (response) => {
                if (response?.error) {
                  console.error('❌ Failed to pause producer:', response.error);
                } else {
                  console.log('🔇 Audio producer paused on Gateway');
                }
              });
            }
          }
        }

        console.log('🎤 Audio User State:', newState ? 'ON' : 'OFF');
        return newState;
      }
    }
    return false;
  }, [userAudioEnabled, socket]);

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        console.log('📹 Video:', videoTrack.enabled ? 'ON' : 'OFF');
        return videoTrack.enabled;
      }
    }
    return false;
  }, []);

  // ==========================================
  // ROOM MANAGEMENT
  // ==========================================

  const createRoom = useCallback(async () => {
    return new Promise((resolve, reject) => {
      try {
        if (!socket || !socket.connected) {
          reject(new Error('Socket not connected'));
          return;
        }

        console.log('🔨 Creating new room...');

        socket.emit('create-room', (response) => {
          if (response.error) {
            console.error('❌ Error creating room:', response.error);
            reject(new Error(response.error.message || 'Failed to create room'));
          } else {
            console.log('✅ Room created:', response.roomId);
            resolve(response.roomId);
          }
        });
      } catch (error) {
        console.error('❌ Error in createRoom:', error);
        reject(error);
      }
    });
  }, [socket]);

  const joinRoom = useCallback(async (roomIdToJoin, userInfo = {}) => {
    try {
      console.log('🚪 Joining room:', roomIdToJoin);

      // 1. Get local media first
      const stream = await getLocalStream();

      // 🔧 FIX: Ưu tiên language từ userInfo (passed from RoomMeet), fallback về state
      const effectiveSourceLang = userInfo.sourceLanguage || sourceLanguage;
      const effectiveTargetLang = userInfo.targetLanguage || targetLanguage;

      console.log('🌐 Join room with languages:', {
        sourceLanguage: effectiveSourceLang,
        targetLanguage: effectiveTargetLang,
        fromUserInfo: !!userInfo.sourceLanguage
      });

      // 2. Join room on server (nhận rtpCapabilities trong response)
      const joinResponse = await new Promise((resolve, reject) => {
        socket.emit('join-room', {
          roomId: roomIdToJoin,
          name: userInfo.userId || userId,
          userid: userInfo.userId || userId,
          sourceLanguage: effectiveSourceLang,
          targetLanguage: effectiveTargetLang
        }, (response) => {
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response);
          }
        });
      });

      const { participantId: myPId, participants: existingParticipants, rtpCapabilities } = joinResponse;

      // Update participants state with existing participants
      if (existingParticipants && existingParticipants.length > 0) {
        setParticipants(prev => {
          const newMap = new Map(prev);
          existingParticipants.forEach(p => {
            newMap.set(p.id, {
              name: p.name,
              sourceLanguage: p.sourceLanguage,
              targetLanguage: p.targetLanguage
            });
          });
          return newMap;
        });
      }

      // 3. Load device with rtpCapabilities from join response
      await loadDevice(rtpCapabilities);
      setRoomId(roomIdToJoin);
      setParticipantId(myPId);

      // 🔍 DEBUG: Store myParticipantId on socket for caption filtering
      socket._myParticipantId = myPId;

      console.log('✅ Joined room:', roomIdToJoin, 'as', myPId);

      // 4. Create transports
      await createSendTransport();
      await createRecvTransport();

      // 5. Produce local media
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (videoTrack) {
        await produceMedia(videoTrack);
      }

      if (audioTrack) {
        await produceMedia(audioTrack);
      }

      // 6. Consume existing producers
      if (existingParticipants && existingParticipants.length > 0) {
        console.log('🔽 Consuming existing participants:', existingParticipants.length);

        for (const participant of existingParticipants) {
          if (participant.producers) {
            for (const producer of participant.producers) {
              // Use participant.id (from Gateway response) instead of participant.participantId
              await consumeProducer(producer.id, participant.id, producer.kind);
            }
          }
        }
      }

      console.log('✅ Room join complete');

    } catch (error) {
      console.error('❌ Error joining room:', error);
      throw error;
    }
  }, [socket, userId, sourceLanguage, targetLanguage, loadDevice, getLocalStream, createSendTransport, createRecvTransport, produceMedia, consumeProducer]);

  const leaveRoom = useCallback(() => {
    console.log('👋 Leaving room...');

    // Close all producers
    producersRef.current.forEach((producer) => {
      producer.close();
    });
    producersRef.current.clear();

    // Close all consumers
    consumersRef.current.forEach((consumerData) => {
      consumerData.consumer.close();
    });
    consumersRef.current.clear();

    // Close transports
    if (sendTransportRef.current) {
      sendTransportRef.current.close();
      sendTransportRef.current = null;
    }

    if (recvTransportRef.current) {
      recvTransportRef.current.close();
      recvTransportRef.current = null;
    }

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    // Emit leave event
    socket?.emit('leave-room');

    // Clear state
    setRoomId(null);
    setParticipantId(null);
    setLocalStream(null);
    setRemoteStreams(new Map());
    setParticipants(new Map());
    setConnectionState(new Map());
    setIsDeviceLoaded(false);
    deviceRef.current = null;

    console.log('✅ Left room');
  }, [socket]);

  // ==========================================
  // TRANSLATION SETUP FOR EXISTING STREAMS
  // ==========================================

  // Translation setup moved to RoomMeet level to avoid circular dependency

  // Translation setup for local stream moved to RoomMeet level

  // ==========================================
  // CONTEXT VALUE
  // ==========================================

  const value = {
    // Connection
    socket,
    isConnected,
    userId,
    participantId,

    // MediaSoup
    isDeviceLoaded,
    device: deviceRef.current,

    // Room
    roomId,
    participants,
    connectionState,
    createRoom,
    joinRoom,
    leaveRoom,

    // Media
    localStream,
    remoteStreams,
    getLocalStream,
    toggleAudio,
    toggleVideo,

    // Translation
    sourceLanguage,
    targetLanguage,
    setSourceLanguage,
    setTargetLanguage,
    transcriptions,
    translatedAudioQueue,
    serverTranslations, // 🔥 Pre-translated text từ Gateway
  };

  return (
    <WebRTCContext.Provider value={value}>
      {children}
    </WebRTCContext.Provider>
  );
};

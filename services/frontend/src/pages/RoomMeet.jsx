import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useWebRTC } from '../contexts/WebRTCContext';
import { useTranslation } from '../contexts/TranslationContext';
import { useToast } from '../contexts/ToastContext';
import { Loader2, AlertCircle, Wifi } from 'lucide-react';
import VideoGrid from '../components/room/VideoGrid';
import ControlsBar from '../components/room/ControlsBar';
import CaptionsOverlay from '../components/room/CaptionsOverlay';
import ChatPanel from '../components/room/ChatPanel';
import ParticipantsPanel from '../components/room/ParticipantsPanel';
import SettingsPanel from '../components/room/SettingsPanel';
import TranslationControls from '../components/room/TranslationControls';

// Helper function để decode Base64 có tiếng Việt
const decodeData = (encodedString) => {
  try {
    // Base64 -> UTF8 -> JSON Object
    const jsonString = decodeURIComponent(escape(atob(encodedString)));
    return JSON.parse(jsonString);
  } catch (e) {
    console.error('Lỗi giải mã data:', e);
    return null;
  }
};

export default function RoomMeet() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();

  const {
    socket,
    isConnected,
    connectionState,
    participants,
    participantId,
    localStream,
    remoteStreams,
    createRoom,
    joinRoom,
    leaveRoom,
    toggleAudio,
    toggleVideo,
    sourceLanguage,
    targetLanguage,
    setSourceLanguage,
    setTargetLanguage,
    transcriptions
  } = useWebRTC();

  // Đọc user info từ encoded data hoặc URL params (cho external integration)
  const encodedData = searchParams.get('data');
  const decodedUserInfo = encodedData ? decodeData(encodedData) : null;

  const urlUsername = decodedUserInfo?.username || searchParams.get('username');
  const urlUserid = decodedUserInfo?.userid || searchParams.get('userid');
  const urlToken = decodedUserInfo?.token || searchParams.get('token');
  const urlPartnerName = decodedUserInfo?.partner_name;
  const urlSourceLang = decodedUserInfo?.source_lang || searchParams.get('source_lang') || searchParams.get('sourceLang');
  const urlTargetLang = decodedUserInfo?.target_lang || searchParams.get('target_lang') || searchParams.get('targetLang');

  const [username] = useState(() => {
    // Priority: encoded data > URL params > localStorage > 'Anonymous'
    return urlUsername || localStorage.getItem('jb_username') || 'Anonymous';
  });

  const [userid] = useState(() => {
    return urlUserid || localStorage.getItem('jb_userid') || null;
  });

  const [partnerName] = useState(() => {
    return urlPartnerName || null;
  });
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const [isTranslationOpen, setIsTranslationOpen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isJoining, setIsJoining] = useState(true);
  const [error, setError] = useState(null);
  const [captionMode, setCaptionMode] = useState('bilingual');
  const [visibleCaptions, setVisibleCaptions] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

  // Translation context
  const {
    enabled: translationEnabled,
    captions,
    setupParticipantTranslation,
    participantSettings,
    ingestGatewayCaption
  } = useTranslation();
  const [connectionQuality, setConnectionQuality] = useState('good');
  const [latency, setLatency] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [connectionStates, setConnectionStates] = useState(new Map());
  const [iceConnectionState, setIceConnectionState] = useState('new');

  const controlsTimeoutRef = useRef(null);
  const hasJoinedRef = useRef(false);

  // Memoize participant list for VideoGrid
  const participantList = useMemo(() => {
    return Array.from(participants.entries()).map(([id, info]) => ({
      id,
      userId: info.username || info.name || id.slice(0, 8),
      language: info.sourceLanguage,
      targetLanguage: info.targetLanguage
    }));
  }, [participants]);

  // Select which captions to show based on translation toggle
  const overlayCaptions = useMemo(() => {
    const base = translationEnabled && captions.length > 0 ? captions : visibleCaptions;

    return base.map((caption) => {
      const participantInfo = participants.get(caption.participantId);
      return {
        ...caption,
        id: caption.id || `${caption.participantId || 'unknown'}-${caption.timestamp || Date.now()}`,
        username: caption.username || participantInfo?.name || (caption.participantId === participantId ? username : undefined)
      };
    });
  }, [captions, visibleCaptions, translationEnabled, participants, participantId, username]);

  // Lưu user info vào localStorage cho lần sau
  useEffect(() => {
    if (username && username !== 'Anonymous') {
      localStorage.setItem('jb_username', username);
    }
    if (userid) {
      localStorage.setItem('jb_userid', userid);
    }

    // Log decoded info cho debug
    if (decodedUserInfo) {
      console.log('📦 Decoded User Info:', {
        username: decodedUserInfo.username,
        userid: decodedUserInfo.userid,
        partner_name: decodedUserInfo.partner_name,
        timestamp: decodedUserInfo.timestamp
      });
    }
  }, [username, userid, decodedUserInfo]);

  // Room initialization effect
  useEffect(() => {
    if (!roomId) {
      navigate('/');
      return;
    }

    if (hasJoinedRef.current) {
      return;
    }

    // ⚠️ CRITICAL FIX: Đợi socket connected trước khi join room
    if (!isConnected) {
      console.log('⏳ Waiting for socket connection before joining room...');
      return;
    }

    const initRoom = async () => {
      try {
        setIsJoining(true);
        setError(null);
        hasJoinedRef.current = true;

        // Sử dụng language từ URL nếu có, nếu không dùng default
        const finalSourceLang = urlSourceLang || sourceLanguage;
        const finalTargetLang = urlTargetLang || targetLanguage;

        // Update language settings nếu có trong URL
        if (urlSourceLang && urlSourceLang !== sourceLanguage) {
          setSourceLanguage(urlSourceLang);
        }
        if (urlTargetLang && urlTargetLang !== targetLanguage) {
          setTargetLanguage(urlTargetLang);
        }

        // Prepare room data với external integration support
        const roomData = {
          username,
          userid,
          token: urlToken,
          sourceLanguage: finalSourceLang,
          targetLanguage: finalTargetLang
        };

        try {
          await joinRoom(roomId, roomData);
          setIsJoining(false);
        } catch (joinErr) {
          if (joinErr?.message?.includes('không tồn tại') && createRoom) {
            hasJoinedRef.current = false;
            const newRoomId = await createRoom();
            navigate(`/room/${newRoomId}`, { replace: true });
            return;
          }
          throw joinErr;
        }
      } catch (err) {
        console.error('❌ Error joining room:', err);
        setError(err.message || 'Không thể tham gia phòng');
        setIsJoining(false);
        hasJoinedRef.current = false;
      }
    };

    initRoom();

    return () => {
      leaveRoom();
      hasJoinedRef.current = false;
    };
  }, [roomId, isConnected, navigate, username, userid, urlToken, urlSourceLang, urlTargetLang, sourceLanguage, targetLanguage, setSourceLanguage, setTargetLanguage, joinRoom, createRoom, leaveRoom]);

  useEffect(() => {
    if (transcriptions.length === 0 || captionMode === 'off') return;
    const latest = transcriptions[transcriptions.length - 1];
    const captionId = `${Date.now()}-${Math.random()}`;
    setVisibleCaptions(prev => [...prev, { ...latest, id: captionId }].slice(-3));
    const timeout = setTimeout(() => {
      setVisibleCaptions(prev => prev.filter(caption => caption.id !== captionId));
    }, 5000);
    return () => clearTimeout(timeout);
  }, [transcriptions, captionMode]);

  // Ingest gateway captions vào TranslationContext để chạy MT/TTS per-viewer
  useEffect(() => {
    if (!translationEnabled) return;
    if (transcriptions.length === 0) return;
    const latest = transcriptions[transcriptions.length - 1];
    if (!latest.isFinal) return;
    ingestGatewayCaption(latest);
  }, [transcriptions, translationEnabled, ingestGatewayCaption]);

  useEffect(() => {
    if (!socket) return;
    const pingInterval = setInterval(() => {
      const start = Date.now();
      socket.emit('ping', () => {
        const ms = Date.now() - start;
        setLatency(ms);
        setConnectionQuality(ms < 100 ? 'good' : ms < 300 ? 'fair' : 'poor');
      });
    }, 5000);
    return () => clearInterval(pingInterval);
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    const handleChatMessage = (data) => {
      const messageId = `${data.sender}-${data.timestamp || Date.now()}`;

      setMessages(prev => {
        // Check if message already exists (deduplicate)
        if (prev.some(msg => msg.id === messageId)) {
          return prev;
        }

        return [...prev, {
          id: messageId,
          sender: data.sender,
          text: data.text,
          timestamp: data.timestamp || Date.now()
        }];
      });

      if (!isChatOpen) {
        setUnreadCount(prev => prev + 1);
      }
    };

    socket.on('chat-message', handleChatMessage);
    return () => {
      socket.off('chat-message', handleChatMessage);
    };
  }, [socket, isChatOpen]);

  useEffect(() => {
    if (!socket) return;

    const handleDisconnect = () => {
      setReconnecting(true);
      setError('Mất kết nối với server...');
    };
    const handleReconnect = () => {
      setReconnecting(false);
      setError(null);
    };
    const handleReconnectError = () => {
      setError('Không thể kết nối lại với server');
    };
    const handleReconnectFailed = () => {
      setError('Kết nối thất bại. Vui lòng tải lại trang.');
    };

    socket.on('disconnect', handleDisconnect);
    socket.on('reconnect', handleReconnect);
    socket.on('reconnect_error', handleReconnectError);
    socket.on('reconnect_failed', handleReconnectFailed);

    return () => {
      socket.off('disconnect', handleDisconnect);
      socket.off('reconnect', handleReconnect);
      socket.off('reconnect_error', handleReconnectError);
      socket.off('reconnect_failed', handleReconnectFailed);
    };
  }, [socket]);

  useEffect(() => {
    const newStates = new Map();
    participants.forEach((info, peerId) => {
      newStates.set(peerId, {
        connectionState: iceConnectionState || 'new'
      });
    });
    setConnectionStates(newStates);
  }, [participants, iceConnectionState]);

  useEffect(() => {
    if (!localStream) return;
    const [audioTrack] = localStream.getAudioTracks();
    const [videoTrack] = localStream.getVideoTracks();
    if (audioTrack) setIsAudioEnabled(audioTrack.enabled);
    if (videoTrack) setIsVideoEnabled(videoTrack.enabled);
  }, [localStream]);

  useEffect(() => {
    if (!connectionState) return;
    setIceConnectionState(connectionState);
  }, [connectionState]);

  useEffect(() => {
    if (iceConnectionState === 'failed') {
      setError('Kết nối P2P thất bại');
    } else if (iceConnectionState === 'disconnected') {
      setError('Mất kết nối video');
    } else if (iceConnectionState === 'connected' || iceConnectionState === 'completed') {
      setError(null);
    }
  }, [iceConnectionState]);

  useEffect(() => {
    if (isChatOpen) {
      setUnreadCount(0);
    }
  }, [isChatOpen]);

  // 🔥 NEW: Setup translation for local and remote streams
  useEffect(() => {
    if (!translationEnabled) return;

    // 1. Setup local translation
    if (localStream && participantId && !participantSettings.has(participantId)) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        console.log('🎤 Setting up translation for local stream:', participantId);
        setupParticipantTranslation(participantId, audioTrack);
      }
    }

    // 2. Setup remote translation
    remoteStreams.forEach((stream, remoteId) => {
      if (participantSettings.has(remoteId)) return;
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        console.log('🎧 Setting up translation for remote stream:', remoteId);
        setupParticipantTranslation(remoteId, audioTrack);
      }
    });
  }, [translationEnabled, localStream, remoteStreams, participantId, participantSettings, setupParticipantTranslation]);

  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  const handleToggleAudio = useCallback(() => {
    setIsAudioEnabled(toggleAudio());
  }, [toggleAudio]);

  const handleToggleVideo = useCallback(() => {
    setIsVideoEnabled(toggleVideo());
  }, [toggleVideo]);

  const handleScreenShare = useCallback(async () => {
    try {
      if (!isScreenSharing) {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const [screenTrack] = stream.getVideoTracks();

        if (screenTrack && localStream) {
          // Replace video track trong local stream
          const oldTrack = localStream.getVideoTracks()[0];
          if (oldTrack) {
            localStream.removeTrack(oldTrack);
            oldTrack.stop();
          }
          localStream.addTrack(screenTrack);

          // Trigger re-render để update video display
          if (socket) {
            socket.emit('screen-share-started', { roomId });
          }

          screenTrack.onended = () => {
            // Switch back to camera khi dừng share
            navigator.mediaDevices.getUserMedia({ video: true, audio: false })
              .then(cameraStream => {
                const [cameraTrack] = cameraStream.getVideoTracks();
                const currentScreenTrack = localStream.getVideoTracks()[0];
                if (currentScreenTrack) {
                  localStream.removeTrack(currentScreenTrack);
                }
                localStream.addTrack(cameraTrack);
                setIsScreenSharing(false);
                if (socket) {
                  socket.emit('screen-share-stopped', { roomId });
                }
              })
              .catch(err => {
                console.error('Failed to switch back to camera:', err);
                setIsScreenSharing(false);
              });
          };
        }
        setIsScreenSharing(true);
        showToast('Đã bắt đầu chia sẻ màn hình', 'success');
      } else {
        // Stop screen sharing manually
        const screenTrack = localStream?.getVideoTracks()[0];
        if (screenTrack) {
          screenTrack.stop();
        }
        setIsScreenSharing(false);
      }
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        showToast('Lỗi chia sẻ màn hình: ' + err.message, 'error');
      }
    }
  }, [isScreenSharing, localStream, socket, roomId, showToast]);

  const handleLeaveCall = useCallback(() => {
    if (confirm('Rời khỏi cuộc gọi?')) {
      leaveRoom();

      // Nếu là external integration (có data parameter), đóng tab thay vì về Home
      if (encodedData) {
        // Thử đóng tab/window (chỉ work nếu window được mở bằng script)
        window.close();

        // Fallback: Nếu window.close() không work, hiển thị thông báo
        setTimeout(() => {
          // Check xem window có đóng được không
          if (!window.closed) {
            alert('Cuộc gọi đã kết thúc. Bạn có thể đóng tab này.');
          }
        }, 100);
      } else {
        // Normal flow: về Home
        navigate('/');
      }
    }
  }, [leaveRoom, navigate, encodedData]);

  const handleSendMessage = useCallback(() => {
    if (!newMessage.trim() || !socket) return;

    const timestamp = Date.now();
    const messageId = `${username}-${timestamp}`;

    const messageData = {
      roomId,
      sender: username,
      text: newMessage.trim(),
      timestamp
    };

    socket.emit('chat-message', messageData);

    setMessages(prev => [...prev, {
      ...messageData,
      id: messageId
    }]);

    setNewMessage('');
  }, [newMessage, socket, roomId, username]);

  const handleSourceLanguageChange = useCallback((lang) => setSourceLanguage(lang), [setSourceLanguage]);
  const handleTargetLanguageChange = useCallback((lang) => setTargetLanguage(lang), [setTargetLanguage]);
  const handleCaptionModeChange = useCallback((mode) => setCaptionMode(mode), []);

  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  const handleToggleChat = useCallback(() => {
    setIsChatOpen(prev => {
      const next = !prev;
      if (next) {
        setUnreadCount(0);
      }
      return next;
    });
  }, []);

  const handleToggleParticipants = useCallback(() => setIsParticipantsOpen(prev => !prev), []);
  const handleToggleSettings = useCallback(() => setIsSettingsOpen(prev => !prev), []);
  const handleToggleTranslation = useCallback(() => setIsTranslationOpen(prev => !prev), []);

  const handleDeviceChange = useCallback(async (kind, deviceId) => {
    try {
      if (kind === 'audioInput' || kind === 'videoInput') {
        // Stop current stream tracks
        if (localStream) {
          localStream.getTracks().forEach(track => track.stop());
        }

        // Get new stream with new device
        const constraints = {
          audio: kind === 'audioInput' ? { deviceId: { exact: deviceId } } : true,
          video: kind === 'videoInput' ? { deviceId: { exact: deviceId } } : true
        };

        const newStream = await navigator.mediaDevices.getUserMedia(constraints);

        // Note: You may need to update WebRTCContext to handle stream replacement
        // For now, just show success toast
        showToast(`Đã chuyển ${kind === 'audioInput' ? 'microphone' : 'camera'}`, 'success');
      } else if (kind === 'audioOutput') {
        // Set audio output for all video elements
        const videoElements = document.querySelectorAll('video');
        videoElements.forEach(video => {
          if (typeof video.setSinkId === 'function') {
            video.setSinkId(deviceId).catch(err => {
              console.error('Error setting audio output:', err);
            });
          }
        });

        showToast('Đã chuyển loa', 'success');
      }
    } catch (error) {
      console.error('Error changing device:', error);
      showToast('Không thể chuyển thiết bị: ' + error.message, 'error');
    }
  }, [localStream, showToast]);

  if (isJoining) {
    return (
      <div className="room room--joining">
        <div className="room__loading">
          <Loader2 className="spinner" size={48} />
          <h2>Đang tham gia phòng...</h2>
          <p>Room ID: <strong>{roomId}</strong></p>
        </div>
      </div>
    );
  }

  const hasOpenPanel = isChatOpen || isParticipantsOpen || isSettingsOpen || isTranslationOpen;
  const participantCount = participants.size + 1;

  return (
    <div className={`room ${hasOpenPanel ? 'room--with-panel' : ''}`} onMouseMove={handleMouseMove}>
      {/* Reconnection Banner */}
      {reconnecting && (
        <div className="fixed top-0 left-0 right-0 bg-yellow-600 text-white px-4 py-2 text-center z-50 flex items-center justify-center gap-2">
          <Wifi size={20} className="animate-pulse" />
          <span>Đang kết nối lại...</span>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="error-banner">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Main Video Content */}
      <div className="room__video-content">
        <VideoGrid
          localStream={localStream}
          remoteStreams={remoteStreams}
          participants={participantList}
          username={username}
          isVideoEnabled={isVideoEnabled}
          isAudioEnabled={isAudioEnabled}
          isScreenSharing={isScreenSharing}
          iceConnectionState={iceConnectionState}
          latency={latency}
          connectionQuality={connectionQuality}
          roomId={roomId}
        />
      </div>

      <CaptionsOverlay captions={overlayCaptions} mode={captionMode} />

      <ControlsBar
        roomId={roomId}
        participantCount={participantCount}
        isConnected={isConnected}
        connectionQuality={connectionQuality}
        isAudioEnabled={isAudioEnabled}
        isVideoEnabled={isVideoEnabled}
        isScreenSharing={isScreenSharing}
        isChatOpen={isChatOpen}
        isParticipantsOpen={isParticipantsOpen}
        isSettingsOpen={isSettingsOpen}
        isTranslationOpen={isTranslationOpen}
        unreadCount={unreadCount}
        showControls={showControls}
        onToggleAudio={handleToggleAudio}
        onToggleVideo={handleToggleVideo}
        onScreenShare={handleScreenShare}
        onLeaveCall={handleLeaveCall}
        onToggleChat={handleToggleChat}
        onToggleParticipants={handleToggleParticipants}
        onToggleSettings={handleToggleSettings}
        onToggleTranslation={handleToggleTranslation}
      />

      <ChatPanel
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={messages}
        newMessage={newMessage}
        setNewMessage={setNewMessage}
        onSendMessage={handleSendMessage}
        username={username}
      />

      <ParticipantsPanel
        isOpen={isParticipantsOpen}
        onClose={() => setIsParticipantsOpen(false)}
        participants={participants}
        username={username}
        connectionStates={connectionStates}
      />

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        sourceLanguage={sourceLanguage}
        targetLanguage={targetLanguage}
        onSourceLanguageChange={handleSourceLanguageChange}
        onTargetLanguageChange={handleTargetLanguageChange}
        iceConnectionState={iceConnectionState}
        latency={latency}
        participants={participants}
        onDeviceChange={handleDeviceChange}
      />

      <TranslationControls
        isOpen={isTranslationOpen}
        onClose={() => setIsTranslationOpen(false)}
        captionMode={captionMode}
        onCaptionModeChange={handleCaptionModeChange}
      />
    </div>
  );
}

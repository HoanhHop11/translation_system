import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWebRTC } from '../contexts/WebRTCContext';
import { Loader2, AlertCircle, Wifi } from 'lucide-react';
import VideoGrid from '../components/room/VideoGrid';
import ControlsBar from '../components/room/ControlsBar';
import CaptionsOverlay from '../components/room/CaptionsOverlay';
import ChatPanel from '../components/room/ChatPanel';
import ParticipantsPanel from '../components/room/ParticipantsPanel';
import SettingsPanel from '../components/room/SettingsPanel';

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  
  const {
    socket, isConnected, userId, connectionState, iceConnectionState,
    participants, localStream, remoteStreams, joinRoom, leaveRoom,
    toggleAudio, toggleVideo, sourceLanguage, targetLanguage,
    setSourceLanguage, setTargetLanguage, transcriptions
  } = useWebRTC();
  
  const [username] = useState(() => localStorage.getItem('jb_username') || 'Anonymous');
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isJoining, setIsJoining] = useState(true);
  const [error, setError] = useState(null);
  const [captionMode, setCaptionMode] = useState('bilingual');
  const [visibleCaptions, setVisibleCaptions] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [connectionQuality, setConnectionQuality] = useState('good');
  const [latency, setLatency] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [connectionStates, setConnectionStates] = useState(new Map());
  const controlsTimeoutRef = useRef(null);
  const hasJoinedRef = useRef(false);
  
  useEffect(() => {
    if (!roomId) { 
      navigate('/'); 
      return; 
    }
    
    // Prevent double join (React Strict Mode in dev)
    if (hasJoinedRef.current) {
      console.log('⚠️ Already joined, skipping...');
      return;
    }
    
    const initRoom = async () => {
      try {
        setIsJoining(true);
        setError(null);
        hasJoinedRef.current = true;
        await joinRoom(roomId, { userId: username, language: sourceLanguage, targetLanguage });
        setIsJoining(false);
      } catch (error) {
        setError(error.message || 'Không thể tham gia phòng');
        setIsJoining(false);
        hasJoinedRef.current = false; // Reset on error
      }
    };
    
    initRoom();
    
    return () => {
      leaveRoom();
      hasJoinedRef.current = false;
    };
  }, [roomId]); // Only depend on roomId, not on joinRoom/leaveRoom functions
  
  useEffect(() => {
    if (transcriptions.length > 0 && captionMode !== 'off') {
      const latest = transcriptions[transcriptions.length - 1];
      const captionId = Date.now() + '-' + Math.random();
      setVisibleCaptions(prev => [...prev, { ...latest, id: captionId }].slice(-3));
      setTimeout(() => setVisibleCaptions(prev => prev.filter(c => c.id !== captionId)), 5000);
    }
  }, [transcriptions, captionMode]);
  
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
    if (iceConnectionState === 'failed') setError('Kết nối P2P thất bại');
    else if (iceConnectionState === 'disconnected') setError('Mất kết nối video');
    else if (iceConnectionState === 'connected' || iceConnectionState === 'completed') setError(null);
  }, [iceConnectionState]);
  
  // Socket event handlers for chat
  useEffect(() => {
    if (!socket) return;
    
    const handleChatMessage = (data) => {
      setMessages(prev => [...prev, {
        sender: data.sender,
        text: data.text,
        timestamp: data.timestamp || Date.now()
      }]);
      
      // Tăng unread count nếu chat panel đang đóng
      if (!isChatOpen) {
        setUnreadCount(prev => prev + 1);
      }
    };
    
    socket.on('chat-message', handleChatMessage);
    
    return () => {
      socket.off('chat-message', handleChatMessage);
    };
  }, [socket, isChatOpen]);
  
  // Socket reconnection handlers
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
  
  // Track connection states for participants panel
  useEffect(() => {
    const newStates = new Map();
    participants.forEach((info, peerId) => {
      newStates.set(peerId, {
        connectionState: connectionState.get(peerId)?.connectionState || 'new',
        iceConnectionState: connectionState.get(peerId)?.iceConnectionState || 'new'
      });
    });
    setConnectionStates(newStates);
  }, [participants, connectionState]);
  
  const handleToggleAudio = useCallback(() => setIsAudioEnabled(toggleAudio()), [toggleAudio]);
  const handleToggleVideo = useCallback(() => setIsVideoEnabled(toggleVideo()), [toggleVideo]);
  const handleScreenShare = useCallback(async () => {
    try {
      if (!isScreenSharing) {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        stream.getVideoTracks()[0].onended = () => setIsScreenSharing(false);
        setIsScreenSharing(true);
      } else {
        setIsScreenSharing(false);
      }
    } catch (err) { if (err.name !== 'NotAllowedError') alert('Lỗi: ' + err.message); }
  }, [isScreenSharing]);
  
  const handleLeaveCall = useCallback(() => {
    if (confirm('Rời khỏi cuộc gọi?')) { leaveRoom(); navigate('/'); }
  }, [leaveRoom, navigate]);
  
  const handleSendMessage = useCallback(() => {
    if (!newMessage.trim() || !socket) return;
    
    const messageData = {
      roomId,
      sender: username,
      text: newMessage.trim(),
      timestamp: Date.now()
    };
    
    // Gửi message qua socket
    socket.emit('chat-message', messageData);
    
    // Thêm message vào local state
    setMessages(prev => [...prev, messageData]);
    setNewMessage('');
  }, [newMessage, socket, roomId, username]);
  
  const handleSourceLanguageChange = useCallback((lang) => {
    setSourceLanguage(lang);
  }, [setSourceLanguage]);
  
  const handleTargetLanguageChange = useCallback((lang) => {
    setTargetLanguage(lang);
  }, [setTargetLanguage]);
  
  const handleCaptionModeChange = useCallback((mode) => {
    setCaptionMode(mode);
  }, []);
  
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
  }, []);
  
  if (isJoining) {
    return (
      <div className="room-container joining">
        <div className="joining-overlay">
          <Loader2 className="spinner" size={48} />
          <h2>Đang tham gia phòng...</h2>
          <p>Room ID: <strong>{roomId}</strong></p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="room-container" onMouseMove={handleMouseMove}>
      {/* Reconnecting Banner */}
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
      
      <VideoGrid
        localStream={localStream}
        remoteStreams={remoteStreams}
        participants={participants}
        username={username}
        isVideoEnabled={isVideoEnabled}
        isAudioEnabled={isAudioEnabled}
        isScreenSharing={isScreenSharing}
        iceConnectionState={iceConnectionState}
        latency={latency}
        connectionQuality={connectionQuality}
        roomId={roomId}
      />
      
      <CaptionsOverlay captions={visibleCaptions} mode={captionMode} />
      
      <ControlsBar
        roomId={roomId}
        participantCount={participants.size + 1}
        isConnected={isConnected}
        connectionQuality={connectionQuality}
        isAudioEnabled={isAudioEnabled}
        isVideoEnabled={isVideoEnabled}
        isScreenSharing={isScreenSharing}
        isChatOpen={isChatOpen}
        isParticipantsOpen={isParticipantsOpen}
        isSettingsOpen={isSettingsOpen}
        unreadCount={unreadCount}
        showControls={showControls}
        onToggleAudio={handleToggleAudio}
        onToggleVideo={handleToggleVideo}
        onScreenShare={handleScreenShare}
        onLeaveCall={handleLeaveCall}
        onToggleChat={() => { setIsChatOpen(!isChatOpen); setUnreadCount(0); }}
        onToggleParticipants={() => setIsParticipantsOpen(!isParticipantsOpen)}
        onToggleSettings={() => setIsSettingsOpen(!isSettingsOpen)}
      />
      
      {/* Chat Panel */}
      <ChatPanel
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={messages}
        newMessage={newMessage}
        setNewMessage={setNewMessage}
        onSendMessage={handleSendMessage}
        username={username}
      />
      
      {/* Participants Panel */}
      <ParticipantsPanel
        isOpen={isParticipantsOpen}
        onClose={() => setIsParticipantsOpen(false)}
        participants={participants}
        username={username}
        connectionStates={connectionStates}
      />
      
      {/* Settings Panel */}
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        sourceLanguage={sourceLanguage}
        targetLanguage={targetLanguage}
        captionMode={captionMode}
        onSourceLanguageChange={handleSourceLanguageChange}
        onTargetLanguageChange={handleTargetLanguageChange}
        onCaptionModeChange={handleCaptionModeChange}
        iceConnectionState={iceConnectionState}
        latency={latency}
        participants={participants}
      />
    </div>
  );
}

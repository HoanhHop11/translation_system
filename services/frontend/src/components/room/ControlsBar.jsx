import { Mic, MicOff, Video, VideoOff, PhoneOff, Settings, MessageSquare, Users, Monitor, MonitorOff, Wifi, WifiOff, Languages } from 'lucide-react';

/**
 * ControlsBar Component - Media controls and UI toggles
 */
export default function ControlsBar({
  roomId,
  participantCount,
  isConnected,
  connectionQuality,
  isAudioEnabled,
  isVideoEnabled,
  isScreenSharing,
  isChatOpen,
  isParticipantsOpen,
  isSettingsOpen,
  isTranslationOpen,
  unreadCount,
  showControls,
  onToggleAudio,
  onToggleVideo,
  onScreenShare,
  onLeaveCall,
  onToggleChat,
  onToggleParticipants,
  onToggleSettings,
  onToggleTranslation
}) {
  const getConnectionIcon = () => {
    if (!isConnected) return <WifiOff className="status-icon" />;
    if (connectionQuality === 'poor') return <Wifi className="status-icon poor" />;
    if (connectionQuality === 'fair') return <Wifi className="status-icon fair" />;
    return <Wifi className="status-icon good" />;
  };
  
  const getConnectionText = () => {
    if (!isConnected) return 'Mất kết nối';
    if (connectionQuality === 'good') return 'Tốt';
    if (connectionQuality === 'fair') return 'Trung bình';
    return 'Kém';
  };
  
  return (
    <div className={`room__controls ${showControls ? '' : 'room__controls--hidden'}`}>
      <button
        className={`room__control-btn ${!isAudioEnabled ? 'room__control-btn--muted' : ''}`}
        onClick={onToggleAudio}
        title={isAudioEnabled ? 'Tắt micro' : 'Bật micro'}
      >
        {isAudioEnabled ? <Mic size={24} /> : <MicOff size={24} />}
        <span className="room__control-label">{isAudioEnabled ? 'Tắt mic' : 'Bật mic'}</span>
      </button>
      
      <button
        className={`room__control-btn ${!isVideoEnabled ? 'room__control-btn--muted' : ''}`}
        onClick={onToggleVideo}
        title={isVideoEnabled ? 'Tắt camera' : 'Bật camera'}
      >
        {isVideoEnabled ? <Video size={24} /> : <VideoOff size={24} />}
        <span className="room__control-label">{isVideoEnabled ? 'Tắt cam' : 'Bật cam'}</span>
      </button>
      
      <button
        className={`room__control-btn ${isScreenSharing ? 'room__control-btn--active' : ''}`}
        onClick={onScreenShare}
        title={isScreenSharing ? 'Dừng chia sẻ' : 'Chia sẻ màn hình'}
      >
        {isScreenSharing ? <MonitorOff size={24} /> : <Monitor size={24} />}
        <span className="room__control-label">{isScreenSharing ? 'Dừng chia sẻ' : 'Chia sẻ'}</span>
      </button>
      
      <button
        className={`room__control-btn ${isChatOpen ? 'room__control-btn--active' : ''}`}
        onClick={onToggleChat}
        title="Chat"
      >
        <MessageSquare size={24} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-semibold">
            {unreadCount}
          </span>
        )}
        <span className="room__control-label">Chat</span>
      </button>
      
      <button
        className={`room__control-btn ${isParticipantsOpen ? 'room__control-btn--active' : ''}`}
        onClick={onToggleParticipants}
        title="Người tham gia"
      >
        <Users size={24} />
        <span className="room__control-label">Thành viên</span>
      </button>
      
      <button
        className={`room__control-btn ${isTranslationOpen ? 'room__control-btn--active' : ''}`}
        onClick={onToggleTranslation}
        title="Dịch thuật"
      >
        <Languages size={24} />
        <span className="room__control-label">Dịch</span>
      </button>
      
      <button
        className={`room__control-btn ${isSettingsOpen ? 'room__control-btn--active' : ''}`}
        onClick={onToggleSettings}
        title="Cài đặt"
      >
        <Settings size={24} />
        <span className="room__control-label">Cài đặt</span>
      </button>
      
      <button
        className="room__control-btn room__control-btn--danger"
        onClick={onLeaveCall}
        title="Rời khỏi cuộc gọi"
      >
        <PhoneOff size={24} />
        <span className="room__control-label">Rời phòng</span>
      </button>
    </div>
  );
}

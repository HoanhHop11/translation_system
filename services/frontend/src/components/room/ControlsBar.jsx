import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Settings,
  MessageSquare,
  Users,
  Monitor,
  MonitorOff,
  Wifi,
  WifiOff,
  Languages,
} from 'lucide-react';

/**
 * ControlsBar Component - Thanh điều khiển đáy màn hình (glassmorphism)
 * - Giữ nguyên API props, chỉ thay UI + className
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
  onToggleTranslation,
}) {
  const controlBarClassName = `control-bar ${showControls ? 'visible' : 'hidden'}`;

  const renderConnectionQuality = () => {
    if (!isConnected) {
      return (
        <>
          <WifiOff size={16} className="status-indicator" />
          <span>Mất kết nối</span>
        </>
      );
    }

    switch (connectionQuality) {
      case 'excellent':
      case 'good':
        return (
          <>
            <Wifi size={16} className="status-active" />
            <span>Kết nối tốt</span>
          </>
        );
      case 'fair':
        return (
          <>
            <Wifi size={16} className="status-indicator" />
            <span>Kết nối trung bình</span>
          </>
        );
      case 'poor':
      case 'bad':
        return (
          <>
            <Wifi size={16} className="status-indicator" />
            <span>Kết nối yếu</span>
          </>
        );
      default:
        return (
          <>
            <Wifi size={16} className="status-indicator" />
            <span>Đang đo chất lượng...</span>
          </>
        );
    }
  };

  return (
    <div className={controlBarClassName}>
      {/* Nhóm trái: thông tin phòng + trạng thái mạng */}
      <div className="control-group">
        <div className="room-info-badge">
          {renderConnectionQuality()}
          <span style={{ margin: '0 8px' }}>·</span>
          <span>Phòng: {roomId}</span>
          <span style={{ margin: '0 8px' }}>·</span>
          <span>{participantCount} người tham gia</span>
        </div>
      </div>

      {/* Nhóm giữa: điều khiển media chính */}
      <div className="control-group control-group-center">
        {/* Mic */}
        <button
          type="button"
          className={`control-btn ${!isAudioEnabled ? 'control-btn-active control-btn-danger' : ''}`}
          onClick={onToggleAudio}
          title={isAudioEnabled ? 'Tắt micro' : 'Bật micro'}
        >
          {isAudioEnabled ? <Mic size={22} /> : <MicOff size={22} />}
        </button>

        {/* Camera */}
        <button
          type="button"
          className={`control-btn ${!isVideoEnabled ? 'control-btn-active' : ''}`}
          onClick={onToggleVideo}
          title={isVideoEnabled ? 'Tắt camera' : 'Bật camera'}
        >
          {isVideoEnabled ? <Video size={22} /> : <VideoOff size={22} />}
        </button>

        {/* Share screen */}
        <button
          type="button"
          className={`control-btn ${isScreenSharing ? 'control-btn-active' : ''}`}
          onClick={onScreenShare}
          title={isScreenSharing ? 'Dừng chia sẻ màn hình' : 'Chia sẻ màn hình'}
        >
          {isScreenSharing ? <MonitorOff size={22} /> : <Monitor size={22} />}
        </button>
      </div>

      {/* Nhóm phải: Chat / Participants / Translation / Settings / Leave */}
      <div className="control-group">
        {/* Chat */}
        <button
          type="button"
          className={`control-btn ${isChatOpen ? 'control-btn-active' : ''}`}
          onClick={onToggleChat}
          title="Chat"
        >
          <MessageSquare size={20} />
          {unreadCount > 0 && (
            <span className="control-badge control-badge-danger">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {/* Participants */}
        <button
          type="button"
          className={`control-btn ${isParticipantsOpen ? 'control-btn-active' : ''}`}
          onClick={onToggleParticipants}
          title="Người tham gia"
        >
          <Users size={20} />
        </button>

        {/* Translation / Caption settings */}
        <button
          type="button"
          className={`control-btn ${isTranslationOpen ? 'control-btn-active' : ''}`}
          onClick={onToggleTranslation}
          title="Cài đặt dịch và phụ đề"
        >
          <Languages size={20} />
        </button>

        {/* Settings */}
        <button
          type="button"
          className={`control-btn ${isSettingsOpen ? 'control-btn-active' : ''}`}
          onClick={onToggleSettings}
          title="Cài đặt thiết bị"
        >
          <Settings size={20} />
        </button>

        {/* Leave button (nút đỏ lớn) */}
        <button
          type="button"
          className="control-btn control-btn-danger control-btn-large"
          onClick={onLeaveCall}
          title="Rời cuộc gọi"
        >
          <PhoneOff size={22} />
        </button>
      </div>
    </div>
  );
}

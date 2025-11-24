import { useRef, useEffect, useState } from 'react';
import { VideoOff, MicOff, Monitor, Users, Mic, Copy } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import useAudioLevel from '../../hooks/useAudioLevel';
import StreamLoader from './StreamLoader';

/**
 * VideoGrid Component - Displays local and remote video streams
 */
export default function VideoGrid({ 
  localStream, 
  remoteStreams, 
  participants, 
  username,
  isVideoEnabled,
  isAudioEnabled,
  isScreenSharing,
  iceConnectionState,
  latency,
  connectionQuality,
  roomId
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef(new Map());
  const { showToast } = useToast();
  
  // Track stream loading states
  const [streamLoadingStates, setStreamLoadingStates] = useState(new Map());
  
  // Detect local speaking
  const isLocalSpeaking = useAudioLevel(localStream, -50);
  
  // Attach local stream
  useEffect(() => {
    if (localStream && localVideoRef.current) {
      if (localVideoRef.current.srcObject !== localStream) {
        localVideoRef.current.srcObject = localStream;
      }
    }
  }, [localStream]);
  
  // Attach remote streams
  useEffect(() => {
    remoteStreams.forEach((stream, peerId) => {
      const videoElement = remoteVideoRefs.current.get(peerId);
      if (videoElement && videoElement.srcObject !== stream) {
        videoElement.srcObject = stream;
      }
    });
  }, [remoteStreams]);
  
  // Detect when remote stream is ready
  useEffect(() => {
    remoteStreams.forEach((stream, peerId) => {
      const videoTrack = stream.getVideoTracks()[0];
      
      if (videoTrack) {
        // Check if track is active
        if (videoTrack.readyState === 'live') {
          setStreamLoadingStates(prev => {
            const newMap = new Map(prev);
            newMap.set(peerId, false); // Not loading
            return newMap;
          });
        } else {
          setStreamLoadingStates(prev => {
            const newMap = new Map(prev);
            newMap.set(peerId, true); // Loading
            return newMap;
          });
          
          // Listen for track to become active
          const handleUnmute = () => {
            setStreamLoadingStates(prev => {
              const newMap = new Map(prev);
              newMap.set(peerId, false);
              return newMap;
            });
          };
          
          videoTrack.addEventListener('unmute', handleUnmute);
          
          return () => {
            videoTrack.removeEventListener('unmute', handleUnmute);
          };
        }
      }
    });
  }, [remoteStreams]);
  
  const getICEStatusColor = () => {
    switch (iceConnectionState) {
      case 'connected':
      case 'completed':
        return 'status-green';
      case 'checking':
      case 'new':
        return 'status-yellow';
      case 'failed':
      case 'closed':
        return 'status-red';
      case 'disconnected':
        return 'status-orange';
      default:
        return 'status-gray';
    }
  };
  
  const totalParticipants = remoteStreams.size + 1; // +1 for local
  const gridClass = `room__video-grid room__video-grid--p${Math.min(totalParticipants, 12)}`;
  
  // Copy room code handler
  const handleCopyRoomCode = () => {
    navigator.clipboard.writeText(roomId);
    showToast('Đã copy mã phòng!', 'success', 2000);
  };
  
  return (
    <div className={gridClass}>
      {/* Local Video */}
      <div className={`room__video-tile room__video-tile--local ${isLocalSpeaking ? 'room__video-tile--speaking' : ''}`}>
        {!localStream && (
          <StreamLoader message="Đang khởi động camera..." />
        )}
        
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="room__video-element room__video-element--mirrored"
        />
        
        {!isVideoEnabled && localStream && (
          <div className="room__video-avatar">
            <div className="room__avatar-initials">{username.charAt(0).toUpperCase()}</div>
          </div>
        )}
        
        {/* Speaking badge */}
        {isLocalSpeaking && isAudioEnabled && (
          <div className="speaking-badge">
            <Mic size={14} />
            <span>Đang nói</span>
          </div>
        )}
        
        <div className="room__video-overlay">
          <div className="room__video-name">{username} (Bạn)</div>
          <div className="room__video-status">
            {!isAudioEnabled && (
              <div className="room__status-icon room__status-icon--muted" title="Micro tắt">
                <MicOff size={16} />
              </div>
            )}
            {isScreenSharing && (
              <div className="room__status-icon" title="Đang chia sẻ màn hình">
                <Monitor size={16} />
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Remote Videos */}
      {Array.from(remoteStreams.entries()).map(([peerId, stream]) => {
        return <RemoteVideoTile 
          key={peerId} 
          peerId={peerId} 
          stream={stream} 
          participants={participants}
          remoteVideoRefs={remoteVideoRefs}
          isLoading={streamLoadingStates.get(peerId) !== false}
        />;
      })}
      
      {/* Empty Slot */}
      {remoteStreams.size === 0 && (
        <div className="room__video-tile room__video-tile--empty">
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <Users size={64} className="mb-4 opacity-50" />
            <p className="text-lg mb-2">Đang chờ người khác tham gia...</p>
            <div className="mt-4 text-center">
              <p className="text-sm mb-2">Mã phòng:</p>
              <div className="flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-lg">
                <strong className="text-white text-lg">{roomId}</strong>
                <button
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors flex items-center gap-2"
                  onClick={handleCopyRoomCode}
                  title="Copy mã phòng"
                >
                  <Copy size={16} />
                  Copy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Remote Video Tile Component - Separate để sử dụng hooks
 */
function RemoteVideoTile({ peerId, stream, participants, remoteVideoRefs, isLoading }) {
  const participant = participants.find(p => p.id === peerId);
  const participantName = participant?.userId || peerId.slice(0, 8);
  const isRemoteSpeaking = useAudioLevel(stream, -50);
  
  return (
    <div className={`room__video-tile room__video-tile--remote ${isRemoteSpeaking ? 'room__video-tile--speaking' : ''}`}>
      {/* Show loader if stream is connecting */}
      {isLoading && (
        <StreamLoader participantName={participantName} />
      )}
      
      <video
        ref={(el) => {
          if (el) remoteVideoRefs.current.set(peerId, el);
        }}
        autoPlay
        playsInline
        className="room__video-element"
      />
      
      {/* Speaking badge */}
      {isRemoteSpeaking && (
        <div className="speaking-badge">
          <Mic size={14} />
          <span>{participantName}</span>
        </div>
      )}
      
      <div className="room__video-overlay">
        <div className="room__video-name">
          {participantName}
          {participant?.language && (
            <span className="ml-2 text-xs opacity-75">
              {participant.language} → {participant.targetLanguage}
            </span>
          )}
        </div>
        <div className="room__video-status">
          {/* Connection quality indicator can be added here */}
        </div>
      </div>
    </div>
  );
}

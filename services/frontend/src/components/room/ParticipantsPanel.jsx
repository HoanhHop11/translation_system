import React from 'react';
import { X, User, Wifi, WifiOff } from 'lucide-react';

const ParticipantsPanel = ({
  isOpen,
  onClose,
  participants,
  username,
  connectionStates
}) => {
  if (!isOpen) return null;

  // Tạo danh sách participants bao gồm cả local user
  const allParticipants = [
    {
      id: 'local',
      name: username,
      isLocal: true,
      connectionState: 'connected'
    },
    ...Array.from(participants.entries()).map(([id, info]) => ({
      id,
      name: info.username,
      sourceLanguage: info.sourceLanguage,
      targetLanguage: info.targetLanguage,
      isLocal: false,
      connectionState: connectionStates.get(id)?.connectionState || 'new'
    }))
  ];

  const getConnectionColor = (state) => {
    switch (state) {
      case 'connected':
      case 'completed':
        return 'text-green-500';
      case 'connecting':
        return 'text-yellow-500';
      case 'disconnected':
      case 'failed':
      case 'closed':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const getConnectionIcon = (state) => {
    switch (state) {
      case 'connected':
      case 'completed':
        return <Wifi size={16} className="text-green-500" />;
      case 'disconnected':
      case 'failed':
      case 'closed':
        return <WifiOff size={16} className="text-red-500" />;
      default:
        return <Wifi size={16} className="text-yellow-500" />;
    }
  };

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-gray-900 border-l border-gray-700 flex flex-col z-10">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h3 className="text-lg font-semibold text-white">
          Người tham gia ({allParticipants.length})
        </h3>
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Participants List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {allParticipants.map((participant) => (
          <div
            key={participant.id}
            className="bg-gray-800 rounded-lg p-3 hover:bg-gray-750 transition-colors"
          >
            <div className="flex items-center gap-3">
              {/* Avatar */}
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold">
                {participant.isLocal ? (
                  <User size={20} />
                ) : (
                  participant.name.charAt(0).toUpperCase()
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium truncate">
                    {participant.name}
                  </span>
                  {participant.isLocal && (
                    <span className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full">
                      Bạn
                    </span>
                  )}
                </div>

                {/* Language Info */}
                {!participant.isLocal && (
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                    <span>
                      {participant.sourceLanguage || 'vi'} → {participant.targetLanguage || 'en'}
                    </span>
                  </div>
                )}

                {/* Connection Status */}
                <div className="flex items-center gap-1 mt-1">
                  {getConnectionIcon(participant.connectionState)}
                  <span className={`text-xs ${getConnectionColor(participant.connectionState)}`}>
                    {participant.connectionState === 'connected' || participant.connectionState === 'completed'
                      ? 'Đã kết nối'
                      : participant.connectionState === 'connecting'
                        ? 'Đang kết nối...'
                        : participant.connectionState === 'disconnected'
                          ? 'Mất kết nối'
                          : 'Chờ kết nối'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700 text-center text-xs text-gray-500">
        <p>Tất cả người tham gia đều được mã hóa end-to-end</p>
      </div>
    </div>
  );
};

export default ParticipantsPanel;

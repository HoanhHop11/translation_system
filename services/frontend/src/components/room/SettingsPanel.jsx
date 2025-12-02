import React from 'react';
import { X, Wifi, Clock, Users } from 'lucide-react';

const SettingsPanel = ({
  isOpen,
  onClose,
  iceConnectionState,
  latency,
  participants
}) => {
  if (!isOpen) return null;

  const getConnectionStatusColor = (state) => {
    switch (state) {
      case 'connected':
      case 'completed':
        return 'text-green-500';
      case 'checking':
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

  const getLatencyColor = (latency) => {
    if (latency < 100) return 'text-green-500';
    if (latency < 200) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <div className="fixed right-0 top-0 bottom-0 w-96 bg-gray-900 border-l border-gray-700 flex flex-col z-10">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-900">
        <h3 className="text-lg font-semibold text-white">Cài đặt</h3>
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 p-4 space-y-6 overflow-y-auto">
        {/* Connection Info */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Wifi size={20} className="text-green-500" />
            <h4 className="text-white font-semibold">Thông tin Kết nối</h4>
          </div>

          <div className="space-y-3 bg-gray-800 rounded-lg p-3">
            {/* ICE Connection State */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Trạng thái ICE:</span>
              <span className={`text-sm font-medium ${getConnectionStatusColor(iceConnectionState)}`}>
                {iceConnectionState || 'new'}
              </span>
            </div>

            {/* Latency */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400 flex items-center gap-1">
                <Clock size={14} />
                Độ trễ:
              </span>
              <span className={`text-sm font-medium ${getLatencyColor(latency)}`}>
                {latency ? `${latency}ms` : '-'}
              </span>
            </div>

            {/* Participants Count */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400 flex items-center gap-1">
                <Users size={14} />
                Người tham gia:
              </span>
              <span className="text-sm font-medium text-white">
                {participants.size + 1}
              </span>
            </div>
          </div>
        </div>

        {/* Debug Info (chỉ hiện trong development) */}
        {process.env.NODE_ENV === 'development' && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm text-gray-500">🔧 Debug Info</span>
            </div>
          <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-400 space-y-1 font-mono">
            <div>ICE: {iceConnectionState || 'new'}</div>
            <div>Latency: {latency || 0}ms</div>
            <div>Peers: {participants.size}</div>
          </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700 text-center text-xs text-gray-500">
        <p>Các thay đổi được áp dụng ngay lập tức</p>
      </div>
    </div>
  );
};

export default SettingsPanel;

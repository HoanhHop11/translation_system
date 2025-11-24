import React from 'react';
import { X, Globe, Subtitles, Wifi, Clock, Users } from 'lucide-react';

const SettingsPanel = ({
  isOpen,
  onClose,
  sourceLanguage,
  targetLanguage,
  captionMode,
  onSourceLanguageChange,
  onTargetLanguageChange,
  onCaptionModeChange,
  iceConnectionState,
  latency,
  participants
}) => {
  if (!isOpen) return null;

  const languageOptions = [
    { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'zh', name: '中文', flag: '🇨🇳' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' },
    { code: 'ko', name: '한국어', flag: '🇰🇷' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'es', name: 'Español', flag: '🇪🇸' }
  ];

  const captionModes = [
    { value: 'off', label: 'Tắt phụ đề', icon: '🚫' },
    { value: 'source', label: 'Chỉ ngôn ngữ gốc', icon: '🗣️' },
    { value: 'target', label: 'Chỉ ngôn ngữ đích', icon: '🎯' },
    { value: 'bilingual', label: 'Song ngữ', icon: '🌐' }
  ];

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
        {/* Language Settings */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Globe size={20} className="text-blue-500" />
            <h4 className="text-white font-semibold">Cài đặt Ngôn ngữ</h4>
          </div>

          {/* Source Language */}
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">
              Ngôn ngữ của bạn
            </label>
            <select
              value={sourceLanguage}
              onChange={(e) => onSourceLanguageChange(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 transition-colors"
            >
              {languageOptions.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.flag} {lang.name}
                </option>
              ))}
            </select>
          </div>

          {/* Target Language */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Ngôn ngữ muốn dịch sang
            </label>
            <select
              value={targetLanguage}
              onChange={(e) => onTargetLanguageChange(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 transition-colors"
            >
              {languageOptions.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.flag} {lang.name}
                </option>
              ))}
            </select>
          </div>

          {sourceLanguage === targetLanguage && (
            <div className="mt-2 p-2 bg-yellow-900/30 border border-yellow-700 rounded text-xs text-yellow-400">
              ⚠️ Ngôn ngữ gốc và đích giống nhau
            </div>
          )}
        </div>

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
              <div>Source: {sourceLanguage}</div>
              <div>Target: {targetLanguage}</div>
              <div>Caption: {captionMode}</div>
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

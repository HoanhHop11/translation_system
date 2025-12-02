/**
 * TranslationControls - UI controls cho translation settings
 * 
 * Features:
 * - Enable/disable toggle
 * - Source language selector (auto-detect)
 * - Target language selector
 * - Volume control cho translated audio
 * - Stats display (translations count, latency, cache hits)
 */

import React, { useState } from 'react';
import { useTranslation } from '../../contexts/TranslationContext';
import { useWebRTC } from '../../contexts/WebRTCContext';
import { Languages, Volume2, X, BarChart3, Subtitles } from 'lucide-react';

// Chỉ hiển thị các ngôn ngữ được STT/TTS hỗ trợ trong pipeline hiện tại
const LANGUAGES = [
  { code: 'vi', name: 'Vietnamese', flag: '🇻🇳' },
  { code: 'en', name: 'English', flag: '🇬🇧' }
];

const TranslationControls = ({ isOpen, onClose, captionMode, onCaptionModeChange }) => {
  const {
    enabled,
    myLanguage,
    targetLanguage,
    metrics,
    toggleTranslation,
    setMyLanguage,
    setTargetLanguage,
    ttsEnabled,
    toggleTTS,
    ttsPlaybackService,
    getStats,
    ttsVoice,
    setTtsVoice,
  } = useTranslation();

  // Đồng bộ ngôn ngữ với WebRTC/Gateway để STT chọn đúng mode (VI utterance / EN streaming)
  const {
    setSourceLanguage,
    setTargetLanguage: setTargetLanguageWebRTC
  } = useWebRTC();
  
  const [volume, setVolume] = useState(ttsPlaybackService.getVolume() * 100);
  const [showStats, setShowStats] = useState(false);

  const handleSwapLanguages = () => {
    const newMyLang = targetLanguage;
    const newTargetLang = myLanguage;
    setMyLanguage(newMyLang);
    setTargetLanguage(newTargetLang);
    setSourceLanguage(newMyLang);
    setTargetLanguageWebRTC(newTargetLang);
  };

  const handleMyLanguageChange = (value) => {
    setMyLanguage(value);
    setSourceLanguage(value);
  };

  const handleTargetLanguageChange = (value) => {
    setTargetLanguage(value);
    setTargetLanguageWebRTC(value);
  };
  
  if (!isOpen) return null;
  
  const handleVolumeChange = (e) => {
    const newVolume = parseInt(e.target.value);
    setVolume(newVolume);
    ttsPlaybackService.setVolume(newVolume / 100);
  };
  
  const stats = showStats ? getStats() : null;
  
  return (
    <div className={`translation ${isOpen ? 'translation--open' : ''}`}>
      <div className="translation__header">
        <div className="translation__title">
          <Languages size={20} />
          <span>Cài đặt Dịch thuật</span>
        </div>
        <button className="translation__close-btn" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      
      <div className="translation__content">
        {/* Enable/Disable Toggle */}
        <div className="translation__section">
          <label className="translation__toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => toggleTranslation(e.target.checked)}
            />
            <span className="translation__toggle-slider"></span>
            <span className="translation__toggle-text">
              {enabled ? 'Đã bật' : 'Đã tắt'}
            </span>
          </label>
        </div>
        
        {enabled && (
          <>
            {/* My Language */}
            <div className="translation__section">
              <label className="translation__label">
                Ngôn ngữ của tôi
              </label>
              <select
                value={myLanguage}
                onChange={(e) => handleMyLanguageChange(e.target.value)}
                className="translation__select"
              >
                {LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Target Language + Swap */}
            <div className="translation__section">
              <div className="translation__label flex items-center justify-between">
                <span>Dịch sang ngôn ngữ</span>
                <button
                  type="button"
                  onClick={handleSwapLanguages}
                  className="px-2 py-1 text-xs rounded bg-gray-800 border border-gray-700 hover:border-gray-500"
                  title="Đảo ngược ngôn ngữ nguồn/đích"
                >
                  🔄 Đảo ngược
                </button>
              </div>
              <select
                value={targetLanguage}
                onChange={(e) => handleTargetLanguageChange(e.target.value)}
                className="translation__select"
              >
                {LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Live Translation / Live Caption Modes */}
            <div className="translation__section">
              <label className="translation__label">
                <Subtitles size={16} />
                <span>Chế độ Dịch thuật</span>
              </label>
              
              <div className="space-y-3">
                {/* Live Translation with TTS */}
                <button
                  onClick={() => toggleTTS(!ttsEnabled)}
                  className={`w-full px-4 py-3 rounded-lg text-left transition-all ${
                    ttsEnabled
                      ? 'bg-blue-600 text-white border-2 border-blue-400 shadow-lg'
                      : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-600 hover:bg-gray-750'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="text-xl">{ttsEnabled ? '🔊' : '🔇'}</span>
                      <span>Live Translation</span>
                    </div>
                    {ttsEnabled && <span className="text-xs bg-blue-500 px-2 py-0.5 rounded">ĐANG BẬT</span>}
                  </div>
                  <div className="text-xs opacity-80 ml-7">
                    STT → Dịch → Phát âm thanh đã dịch
                  </div>
                </button>
                
                {/* Live Caption info box */}
                <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-2 font-medium text-gray-200 mb-1">
                    <span className="text-xl">📝</span>
                    <span>Live Caption</span>
                  </div>
                  <div className="text-xs text-gray-400 ml-7">
                    Hiển thị phụ đề (STT → Dịch → Text)
                    <br/>
                    {ttsEnabled 
                      ? '✅ Đang hoạt động cùng TTS' 
                      : '⚠️ Chỉ hiển thị text (TTS đã tắt)'}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Caption Display Mode */}
            <div className="translation__section">
              <label className="translation__label">
                <span>Hiển thị Phụ đề</span>
              </label>
              <div className="space-y-2">
                <button
                  onClick={() => onCaptionModeChange('off')}
                  className={`w-full px-3 py-2 rounded-lg text-left transition-all text-sm ${
                    captionMode === 'off'
                      ? 'bg-blue-600 text-white border-2 border-blue-400'
                      : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>🚫</span>
                    <span>Tắt phụ đề</span>
                  </div>
                </button>
                <button
                  onClick={() => onCaptionModeChange('source')}
                  className={`w-full px-3 py-2 rounded-lg text-left transition-all text-sm ${
                    captionMode === 'source'
                      ? 'bg-blue-600 text-white border-2 border-blue-400'
                      : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>🗣️</span>
                    <span>Chỉ ngôn ngữ gốc</span>
                  </div>
                </button>
                <button
                  onClick={() => onCaptionModeChange('target')}
                  className={`w-full px-3 py-2 rounded-lg text-left transition-all text-sm ${
                    captionMode === 'target'
                      ? 'bg-blue-600 text-white border-2 border-blue-400'
                      : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>🎯</span>
                    <span>Chỉ ngôn ngữ đã dịch</span>
                  </div>
                </button>
                <button
                  onClick={() => onCaptionModeChange('bilingual')}
                  className={`w-full px-3 py-2 rounded-lg text-left transition-all text-sm ${
                    captionMode === 'bilingual'
                      ? 'bg-blue-600 text-white border-2 border-blue-400'
                      : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>🌐</span>
                    <span>Song ngữ (gốc + dịch)</span>
                  </div>
                </button>
              </div>
            </div>
            
            {/* Volume Control */}
            <div className="translation__section">
              <label className="translation__label">
                <Volume2 size={16} />
                <span>Âm lượng Dịch thuật</span>
              </label>
              <div className="translation__volume">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={volume}
                  onChange={handleVolumeChange}
                  className="translation__volume-slider"
                />
                <span className="translation__volume-value">{volume}%</span>
              </div>
            </div>

            {/* TTS Voice Selection */}
            <div className="translation__section">
              <label className="translation__label">
                <span>Giọng nói TTS</span>
              </label>
              <select
                value={ttsVoice}
                onChange={(e) => setTtsVoice(e.target.value)}
                className="translation__select"
              >
                <option value="default">Mặc định</option>
                <option value="female">Nữ (cao hơn)</option>
                <option value="male">Nam (trầm hơn)</option>
              </select>
            </div>
            
            {/* Stats Toggle */}
            <div className="translation__section">
              <button
                className="translation__stats-toggle"
                onClick={() => setShowStats(!showStats)}
              >
                <BarChart3 size={16} />
                <span>{showStats ? 'Ẩn' : 'Hiện'} Thống kê</span>
              </button>
            </div>
            
            {/* Stats Display */}
            {showStats && stats && (
              <div className="translation__stats">
                <div className="translation__stat-item">
                  <span className="translation__stat-label">Tổng số lần dịch:</span>
                  <span className="translation__stat-value">{metrics.totalTranslations}</span>
                </div>
                <div className="translation__stat-item">
                  <span className="translation__stat-label">Độ trễ trung bình:</span>
                  <span className="translation__stat-value">
                    {metrics.avgLatency > 0 ? `${metrics.avgLatency.toFixed(0)}ms` : 'N/A'}
                  </span>
                </div>
                <div className="translation__stat-item">
                  <span className="translation__stat-label">Lỗi:</span>
                  <span className="translation__stat-value">{metrics.errors}</span>
                </div>
                <div className="translation__stat-item">
                  <span className="translation__stat-label">Người tham gia:</span>
                  <span className="translation__stat-value">{stats.participantCount}</span>
                </div>
                <div className="translation__stat-item">
                  <span className="translation__stat-label">Cache:</span>
                  <span className="translation__stat-value">{stats.cacheSize}</span>
                </div>
              </div>
            )}
            
            {/* Info */}
            <div className="translation__info">
              <p>🎤 Audio tự động trích xuất từ người tham gia</p>
              <p>🌐 Âm thanh đã dịch sẽ phát cùng video gốc</p>
              <p>⚡ Độ trễ mục tiêu: &lt;1.5 giây</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TranslationControls;

/**
 * CaptionsOverlay - Hiển thị real-time captions và translations
 * 
 * Features:
 * - Show original text + translated text based on mode
 * - Auto-scroll to latest
 * - Fade out old captions
 * - Color-coded by participant
 * - BEM styled
 */

import React, { useEffect, useRef } from 'react';

const CaptionsOverlay = ({ captions = [], mode = 'bilingual' }) => {
  const containerRef = useRef(null);
  
  // Auto-scroll to bottom khi có caption mới
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [captions]);
  
  if (mode === 'off') {
    return null;
  }
  
  return (
    <div className="room__captions" ref={containerRef}>
      {captions.length === 0 ? (
        <div className="room__caption-bubble room__caption-bubble--placeholder">
          <div className="room__caption-text" style={{ opacity: 0.6, fontStyle: 'italic' }}>
            🎤 Đang chờ người nói...
          </div>
        </div>
      ) : (
        captions.map((caption) => {
        // Determine what to show based on mode
        const showOriginal = mode === 'source' || mode === 'bilingual';
        const showTranslated = (mode === 'target' || mode === 'bilingual') && caption.translatedText;
        
        return (
          <div
            key={caption.id || `${caption.participantId}-${caption.timestamp}`}
            className="room__caption-bubble"
          >
            <div className="room__caption-speaker">
              {caption.username || `Participant ${caption.participantId?.substring(0, 8) || 'Unknown'}`}
            </div>
            
            {showOriginal && (
              <div className="room__caption-text">
                {caption.text}
              </div>
            )}
            
            {showTranslated && (
              <div className="room__caption-translation">
                {caption.translatedText}
              </div>
            )}
          </div>
        );
      }))}
    </div>
  );
};

export default CaptionsOverlay;

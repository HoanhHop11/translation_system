import { Loader2 } from 'lucide-react';

/**
 * Stream Loader Component
 * Hiển thị loading state khi stream đang kết nối
 * 
 * Props:
 * - participantName: Tên người tham gia (optional)
 * - message: Custom message (optional)
 */
const StreamLoader = ({ participantName, message }) => {
  return (
    <div className="stream-loader">
      <div className="loader-content">
        <Loader2 className="loader-spinner" size={48} />
        <p className="loader-message">
          {message || (participantName 
            ? `Đang kết nối với ${participantName}...` 
            : 'Đang kết nối...')}
        </p>
      </div>
    </div>
  );
};

export default StreamLoader;

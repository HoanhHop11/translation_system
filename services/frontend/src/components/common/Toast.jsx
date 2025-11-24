import { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

/**
 * Toast Component - Hiển thị thông báo tạm thời
 * 
 * Props:
 * - id: Unique identifier
 * - type: 'success' | 'error' | 'info' | 'warning'
 * - message: Nội dung thông báo
 * - duration: Thời gian hiển thị (ms), default 3000
 * - onClose: Callback khi đóng toast
 */
const Toast = ({ id, type = 'info', message, duration = 3000, onClose }) => {
  useEffect(() => {
    if (duration && duration > 0) {
      const timer = setTimeout(() => {
        onClose(id);
      }, duration);
      
      return () => clearTimeout(timer);
    }
  }, [id, duration, onClose]);
  
  const icons = {
    success: <CheckCircle size={20} />,
    error: <AlertCircle size={20} />,
    warning: <AlertTriangle size={20} />,
    info: <Info size={20} />
  };
  
  const styles = {
    success: 'toast-success',
    error: 'toast-error',
    warning: 'toast-warning',
    info: 'toast-info'
  };
  
  return (
    <div className={`toast ${styles[type]}`} role="alert">
      <div className="toast-icon">
        {icons[type]}
      </div>
      <div className="toast-message">
        {message}
      </div>
      <button 
        className="toast-close"
        onClick={() => onClose(id)}
        aria-label="Đóng thông báo"
      >
        <X size={16} />
      </button>
    </div>
  );
};

export default Toast;

import { createContext, useContext, useState, useCallback } from 'react';
import Toast from '../components/common/Toast';

/**
 * Toast Context - Quản lý hệ thống thông báo
 * 
 * Usage:
 * const { showToast } = useToast();
 * showToast('Kết nối thành công!', 'success');
 */
const ToastContext = createContext(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  
  /**
   * Hiển thị toast mới
   * @param {string} message - Nội dung thông báo
   * @param {string} type - Loại: 'success', 'error', 'info', 'warning'
   * @param {number} duration - Thời gian hiển thị (ms), default 3000
   */
  const showToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = Date.now() + Math.random();
    const newToast = { id, message, type, duration };
    
    setToasts(prev => [...prev, newToast]);
    
    return id;
  }, []);
  
  /**
   * Đóng toast theo ID
   */
  const closeToast = useCallback((id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);
  
  /**
   * Đóng tất cả toasts
   */
  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);
  
  const value = {
    showToast,
    closeToast,
    clearToasts
  };
  
  return (
    <ToastContext.Provider value={value}>
      {children}
      
      {/* Toast Container */}
      <div className="toast-container">
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            id={toast.id}
            type={toast.type}
            message={toast.message}
            duration={toast.duration}
            onClose={closeToast}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export default ToastContext;

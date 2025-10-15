import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  Video, 
  Languages, 
  MessageSquare, 
  Monitor, 
  Mic,
  Sparkles,
  Info 
} from 'lucide-react'

export default function Home() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [isJoining, setIsJoining] = useState(false)

  const handleCreateRoom = (e) => {
    e.preventDefault()
    if (!username.trim()) {
      alert('Vui lòng nhập tên của bạn')
      return
    }

    // Tạo room code ngẫu nhiên (6 ký tự)
    const newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase()
    
    // Lưu username vào localStorage
    localStorage.setItem('jb_username', username.trim())
    
    // Navigate đến room
    navigate(`/room/${newRoomCode}`)
  }

  const handleJoinRoom = (e) => {
    e.preventDefault()
    if (!username.trim()) {
      alert('Vui lòng nhập tên của bạn')
      return
    }
    if (!roomCode.trim()) {
      alert('Vui lòng nhập mã phòng')
      return
    }

    // Lưu username vào localStorage
    localStorage.setItem('jb_username', username.trim())
    
    // Navigate đến room
    navigate(`/room/${roomCode.trim().toUpperCase()}`)
  }

  return (
    <div className="home-container">
      <div className="home-header">
        <h1>JB Calling</h1>
        <p>Hệ thống video call với dịch thuật real-time</p>
      </div>

      <div className="join-room-section">
        {!isJoining ? (
          // Create Room Form
          <form onSubmit={handleCreateRoom}>
            <h2>Tạo Phòng Mới</h2>
            
            <div className="form-group">
              <label htmlFor="username">Tên của bạn</label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Nhập tên của bạn"
                required
                autoFocus
              />
            </div>

            <button type="submit" className="btn-primary">
              Tạo Phòng & Nhận Mã
            </button>

            <button 
              type="button"
              onClick={() => setIsJoining(true)}
              className="btn-link"
            >
              Đã có mã phòng? Tham gia ngay
            </button>
          </form>
        ) : (
          // Join Room Form
          <form onSubmit={handleJoinRoom}>
            <h2>Tham Gia Phòng</h2>
            
            <div className="form-group">
              <label htmlFor="username-join">Tên của bạn</label>
              <input
                type="text"
                id="username-join"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Nhập tên của bạn"
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="roomCode">Mã phòng</label>
              <input
                type="text"
                id="roomCode"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="VD: ABC123"
                required
                maxLength="6"
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <button type="submit" className="btn-primary">
              Tham Gia Phòng
            </button>

            <button 
              type="button"
              onClick={() => setIsJoining(false)}
              className="btn-link"
            >
              Quay lại tạo phòng mới
            </button>
          </form>
        )}

        <div className="feature-card">
          <h3>
            <Sparkles className="icon-sparkle" size={24} strokeWidth={2.5} />
            Tính năng
          </h3>
          <ul>
            <li>
              <Video size={20} strokeWidth={2} className="feature-icon" />
              Video call chất lượng cao với WebRTC
            </li>
            <li>
              <Languages size={20} strokeWidth={2} className="feature-icon" />
              Dịch thuật tự động real-time
            </li>
            <li>
              <MessageSquare size={20} strokeWidth={2} className="feature-icon" />
              Hỗ trợ đa ngôn ngữ (Việt, Anh, ...)
            </li>
            <li>
              <MessageSquare size={20} strokeWidth={2} className="feature-icon" />
              Chat trong cuộc gọi
            </li>
            <li>
              <Monitor size={20} strokeWidth={2} className="feature-icon" />
              Screen sharing
            </li>
            <li className="feature-upcoming">
              <Mic size={20} strokeWidth={2} className="feature-icon feature-icon-upcoming" />
              Voice cloning (đang phát triển)
            </li>
          </ul>

          <div className="feature-note">
            <Info size={18} className="note-icon" />
            <p>
              <strong>Lưu ý:</strong> Không cần đăng ký tài khoản. 
              Chỉ cần tên và mã phòng để bắt đầu!
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

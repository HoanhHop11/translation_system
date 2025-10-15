// WebSocket Service cho Signaling
class SignalingService {
  constructor() {
    this.ws = null
    this.roomId = null
    this.userId = null
    this.listeners = {}
  }

  // Kết nối đến signaling server
  connect(roomId, userId, username) {
    const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8001'
    const wsUrl = `${WS_URL}/ws/${roomId}/${userId}?username=${encodeURIComponent(username)}`

    this.roomId = roomId
    this.userId = userId

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        console.log('✅ Connected to signaling server')
        resolve()
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          this.handleMessage(data)
        } catch (error) {
          console.error('Error parsing message:', error)
        }
      }

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error)
        reject(error)
      }

      this.ws.onclose = () => {
        console.log('🔌 Disconnected from signaling server')
        this.emit('disconnected')
      }
    })
  }

  // Đóng kết nối
  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  // Gửi message
  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    } else {
      console.error('WebSocket is not connected')
    }
  }

  // Xử lý message nhận được
  handleMessage(data) {
    const { type } = data

    switch (type) {
      case 'room_state':
        this.emit('room_state', data.users)
        break
      case 'user_joined':
        this.emit('user_joined', data)
        break
      case 'user_left':
        this.emit('user_left', data)
        break
      case 'offer':
        this.emit('offer', data)
        break
      case 'answer':
        this.emit('answer', data)
        break
      case 'ice_candidate':
        this.emit('ice_candidate', data)
        break
      case 'chat':
        this.emit('chat', data)
        break
      default:
        console.warn('Unknown message type:', type)
    }
  }

  // Gửi WebRTC offer
  sendOffer(targetUserId, sdp) {
    this.send({
      type: 'offer',
      target_user_id: targetUserId,
      sdp: sdp,
    })
  }

  // Gửi WebRTC answer
  sendAnswer(targetUserId, sdp) {
    this.send({
      type: 'answer',
      target_user_id: targetUserId,
      sdp: sdp,
    })
  }

  // Gửi ICE candidate
  sendIceCandidate(targetUserId, candidate) {
    this.send({
      type: 'ice_candidate',
      target_user_id: targetUserId,
      candidate: candidate,
    })
  }

  // Gửi chat message
  sendChatMessage(message) {
    this.send({
      type: 'chat',
      message: message,
    })
  }

  // Event listener system
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(callback)
  }

  off(event, callback) {
    if (!this.listeners[event]) return
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback)
  }

  emit(event, data) {
    if (!this.listeners[event]) return
    this.listeners[event].forEach(callback => callback(data))
  }
}

export default new SignalingService()

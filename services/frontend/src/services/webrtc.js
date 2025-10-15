// WebRTC Service
class WebRTCService {
  constructor() {
    this.localStream = null
    this.peerConnections = new Map() // userId -> RTCPeerConnection
    this.iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    }
  }

  // Lấy local media stream (camera + mic)
  async getLocalStream(constraints = { video: true, audio: true }) {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints)
      console.log('✅ Got local stream')
      return this.localStream
    } catch (error) {
      console.error('❌ Error getting local stream:', error)
      throw error
    }
  }

  // Tạo peer connection cho một user
  createPeerConnection(userId, signalingService) {
    const pc = new RTCPeerConnection(this.iceServers)

    // Thêm local tracks vào peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream)
      })
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signalingService.sendIceCandidate(userId, event.candidate)
      }
    }

    // Handle remote stream
    pc.ontrack = (event) => {
      console.log('📹 Received remote track from', userId)
      this.emit('remoteStream', {
        userId,
        stream: event.streams[0],
      })
    }

    // Connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${userId}:`, pc.connectionState)
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.closePeerConnection(userId)
      }
    }

    this.peerConnections.set(userId, pc)
    return pc
  }

  // Tạo và gửi offer
  async createOffer(userId, signalingService) {
    const pc = this.peerConnections.get(userId) || this.createPeerConnection(userId, signalingService)

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      signalingService.sendOffer(userId, offer)
      console.log('📤 Sent offer to', userId)
    } catch (error) {
      console.error('Error creating offer:', error)
    }
  }

  // Xử lý offer nhận được
  async handleOffer(userId, offer, signalingService) {
    const pc = this.peerConnections.get(userId) || this.createPeerConnection(userId, signalingService)

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      signalingService.sendAnswer(userId, answer)
      console.log('📤 Sent answer to', userId)
    } catch (error) {
      console.error('Error handling offer:', error)
    }
  }

  // Xử lý answer nhận được
  async handleAnswer(userId, answer) {
    const pc = this.peerConnections.get(userId)
    if (!pc) {
      console.error('No peer connection for', userId)
      return
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer))
      console.log('✅ Set remote description for', userId)
    } catch (error) {
      console.error('Error handling answer:', error)
    }
  }

  // Xử lý ICE candidate nhận được
  async handleIceCandidate(userId, candidate) {
    const pc = this.peerConnections.get(userId)
    if (!pc) {
      console.error('No peer connection for', userId)
      return
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (error) {
      console.error('Error adding ICE candidate:', error)
    }
  }

  // Đóng peer connection
  closePeerConnection(userId) {
    const pc = this.peerConnections.get(userId)
    if (pc) {
      pc.close()
      this.peerConnections.delete(userId)
      console.log('🔌 Closed connection with', userId)
    }
  }

  // Đóng tất cả connections
  closeAllConnections() {
    this.peerConnections.forEach((pc, userId) => {
      pc.close()
    })
    this.peerConnections.clear()
  }

  // Stop local stream
  stopLocalStream() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop())
      this.localStream = null
    }
  }

  // Toggle audio
  toggleAudio() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        return audioTrack.enabled
      }
    }
    return false
  }

  // Toggle video
  toggleVideo() {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled
        return videoTrack.enabled
      }
    }
    return false
  }

  // Event system
  listeners = {}

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

export default new WebRTCService()

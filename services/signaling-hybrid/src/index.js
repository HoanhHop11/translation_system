import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 8001;

// Service URLs
const STT_SERVICE_URL = process.env.STT_SERVICE_URL || 'http://translation_stt:8000';
const TRANSLATION_SERVICE_URL = process.env.TRANSLATION_SERVICE_URL || 'http://translation_translation:8002';
const TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || 'http://translation_tts:8003';

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST']
};

app.use(cors(corsOptions));
app.use(express.json());

// Socket.IO setup
const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Room management
const rooms = new Map(); // roomId -> Set of socket IDs
const users = new Map(); // socket.id -> { roomId, userId, language, targetLanguage }

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'signaling-hybrid',
    timestamp: new Date().toISOString(),
    connections: io.engine.clientsCount,
    rooms: rooms.size,
    activeUsers: users.size
  });
});

// Helper functions
const addUserToRoom = (socketId, roomId, userInfo = {}) => {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
    console.log(`🏠 Room created: ${roomId}`);
  }
  rooms.get(roomId).add(socketId);
  users.set(socketId, { roomId, ...userInfo });
  
  console.log(`👥 User ${socketId} joined room ${roomId}. Room size: ${rooms.get(roomId).size}`);
};

const removeUserFromRoom = (socketId) => {
  const user = users.get(socketId);
  if (user && user.roomId) {
    const room = rooms.get(user.roomId);
    if (room) {
      room.delete(socketId);
      if (room.size === 0) {
        rooms.delete(user.roomId);
        console.log(`🗑️  Room ${user.roomId} deleted (empty)`);
      } else {
        console.log(`👋 User ${socketId} left room ${user.roomId}. Room size: ${room.size}`);
      }
    }
  }
  users.delete(socketId);
};

const getRoomParticipants = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) return [];
  
  return Array.from(room).map(socketId => {
    const user = users.get(socketId);
    return {
      id: socketId,
      userId: user?.userId,
      language: user?.language,
      targetLanguage: user?.targetLanguage
    };
  });
};

const broadcastRoomUpdate = (roomId) => {
  const participants = getRoomParticipants(roomId);
  io.to(roomId).emit('room-participants', {
    roomId,
    participants,
    count: participants.length
  });
  console.log(`📊 Room ${roomId} update broadcasted: ${participants.length} participants`);
};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // ========================================
  // P2P SIGNALING EVENTS
  // ========================================

  // Join room for P2P video call
  socket.on('join_room', (data) => {
    const { roomId, userId, language = 'vi', targetLanguage = 'en' } = data;
    
    console.log(`🚪 Join room request: ${roomId} from user ${userId} (${socket.id})`);
    
    // Add user to room
    socket.join(roomId);
    addUserToRoom(socket.id, roomId, { userId, language, targetLanguage });
    
    // Notify client
    socket.emit('joined', {
      roomId,
      userId: socket.id,
      participants: getRoomParticipants(roomId)
    });
    
    // Notify other participants
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      roomId
    });
    
    // Broadcast room update
    broadcastRoomUpdate(roomId);
  });

  // P2P Offer
  socket.on('offer', (data) => {
    const { roomId, targetUserId, offer } = data;
    console.log(`📞 Offer from ${socket.id} to ${targetUserId || 'room'} in room ${roomId}`);
    
    if (targetUserId) {
      socket.to(targetUserId).emit('offer', {
        from: socket.id,
        roomId,
        offer
      });
    } else {
      socket.to(roomId).emit('offer', {
        from: socket.id,
        roomId,
        offer
      });
    }
  });

  // P2P Answer
  socket.on('answer', (data) => {
    const { roomId, targetUserId, answer } = data;
    console.log(`📞 Answer from ${socket.id} to ${targetUserId || 'room'} in room ${roomId}`);
    
    if (targetUserId) {
      socket.to(targetUserId).emit('answer', {
        from: socket.id,
        roomId,
        answer
      });
    } else {
      socket.to(roomId).emit('answer', {
        from: socket.id,
        roomId,
        answer
      });
    }
  });

  // ICE Candidate
  socket.on('ice-candidate', (data) => {
    const { roomId, targetUserId, candidate } = data;
    
    if (targetUserId) {
      socket.to(targetUserId).emit('ice-candidate', {
        from: socket.id,
        roomId,
        candidate
      });
    } else {
      socket.to(roomId).emit('ice-candidate', {
        from: socket.id,
        roomId,
        candidate
      });
    }
  });

  // ========================================
  // AUDIO TRANSLATION PIPELINE
  // ========================================

  // Receive audio data for translation
  socket.on('audio-data', async (data) => {
    const { roomId, audioData, language = 'vi', targetLanguage = 'en' } = data;
    const user = users.get(socket.id);
    
    console.log(`🎤 Audio data received from ${socket.id} in room ${roomId} (${language} → ${targetLanguage})`);
    
    try {
      // Step 1: Speech-to-Text
      console.log(`📤 Sending to STT service: ${STT_SERVICE_URL}`);
      const sttResponse = await axios.post(`${STT_SERVICE_URL}/transcribe`, {
        audio_data: audioData,
        language: language
      }, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });

      const transcribedText = sttResponse.data.text || sttResponse.data.transcription;
      console.log(`✅ STT result: "${transcribedText}"`);

      if (!transcribedText || transcribedText.trim() === '') {
        console.log(`⚠️  Empty transcription, skipping translation`);
        return;
      }

      // Step 2: Translation
      console.log(`📤 Sending to Translation service: ${TRANSLATION_SERVICE_URL}`);
      const translationResponse = await axios.post(`${TRANSLATION_SERVICE_URL}/translate`, {
        text: transcribedText,
        source_lang: language,
        target_lang: targetLanguage
      }, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });

      const translatedText = translationResponse.data.translated_text || translationResponse.data.translation;
      console.log(`✅ Translation result: "${translatedText}"`);

      // Step 3: Text-to-Speech
      console.log(`📤 Sending to TTS service: ${TTS_SERVICE_URL}`);
      const ttsResponse = await axios.post(`${TTS_SERVICE_URL}/synthesize`, {
        text: translatedText,
        language: targetLanguage
      }, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
      });

      const synthesizedAudio = ttsResponse.data.audio_data || ttsResponse.data.audio;
      console.log(`✅ TTS complete, audio size: ${synthesizedAudio?.length || 0} chars`);

      // Step 4: Send translated audio to OTHER participants in room
      const room = rooms.get(roomId);
      if (room) {
        room.forEach(participantSocketId => {
          // Don't send back to sender
          if (participantSocketId !== socket.id) {
            io.to(participantSocketId).emit('translated-audio', {
              from: socket.id,
              roomId,
              audioData: synthesizedAudio,
              originalText: transcribedText,
              translatedText: translatedText,
              language: targetLanguage
            });
            console.log(`📡 Sent translated audio to ${participantSocketId}`);
          }
        });
      }

      // Also send transcription back to sender for display
      socket.emit('transcription', {
        text: transcribedText,
        language: language
      });

    } catch (error) {
      console.error(`❌ Audio pipeline error:`, error.message);
      if (error.response) {
        console.error(`   Response status: ${error.response.status}`);
        console.error(`   Response data:`, error.response.data);
      }
      
      socket.emit('error', {
        message: 'Audio translation pipeline failed',
        details: error.message,
        step: error.response?.config?.url || 'unknown'
      });
    }
  });

  // ========================================
  // DISCONNECT HANDLING
  // ========================================

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
    
    const user = users.get(socket.id);
    if (user && user.roomId) {
      // Notify other participants
      socket.to(user.roomId).emit('user-left', {
        userId: socket.id,
        roomId: user.roomId
      });
      
      // Remove user from room
      removeUserFromRoom(socket.id);
      
      // Broadcast room update
      if (rooms.has(user.roomId)) {
        broadcastRoomUpdate(user.roomId);
      }
    }
  });

  socket.on('leave-room', () => {
    const user = users.get(socket.id);
    if (user && user.roomId) {
      console.log(`👋 User ${socket.id} leaving room ${user.roomId}`);
      socket.leave(user.roomId);
      removeUserFromRoom(socket.id);
      
      socket.to(user.roomId).emit('user-left', {
        userId: socket.id,
        roomId: user.roomId
      });
      
      if (rooms.has(user.roomId)) {
        broadcastRoomUpdate(user.roomId);
      }
    }
  });
  
  // Chat message handler
  socket.on('chat-message', (data) => {
    const user = users.get(socket.id);
    if (user && user.roomId) {
      console.log(`💬 Chat message in room ${user.roomId} from ${data.sender}`);
      
      // Broadcast message to all users in room (including sender for confirmation)
      io.to(user.roomId).emit('chat-message', {
        sender: data.sender,
        text: data.text,
        timestamp: data.timestamp || Date.now(),
        roomId: user.roomId
      });
    }
  });
  
  // Ping/Pong for latency measurement
  socket.on('ping', (callback) => {
    if (typeof callback === 'function') {
      callback();
    }
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Hybrid Signaling Server running on port ${PORT}`);
  console.log(`📊 Services:`);
  console.log(`   - STT: ${STT_SERVICE_URL}`);
  console.log(`   - Translation: ${TRANSLATION_SERVICE_URL}`);
  console.log(`   - TTS: ${TTS_SERVICE_URL}`);
  console.log(`✅ Ready for P2P video + server-side audio translation`);
});

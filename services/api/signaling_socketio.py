"""
Signaling Service với Socket.IO + MediaSoup Integration
"""
from fastapi import FastAPI
import socketio
import httpx
import logging
from typing import Dict, Set
from datetime import datetime
import os

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
MEDIASOUP_URL = os.getenv('MEDIASOUP_SERVICE_URL', 'http://mediasoup:4000')
CORS_ORIGIN = os.getenv('CORS_ORIGIN', '*')

# FastAPI app
app = FastAPI(
    title="JB Calling Signaling Service",
    description="Socket.IO Signaling Server với MediaSoup integration + Transport Cleanup",
    version="2.4.0"
)

# Socket.IO Server
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins=['https://www.jbcalling.site', 'https://jbcalling.site'],  # ✅ Specific origins cho credentials
    logger=True,
    engineio_logger=True,  # Enable Engine.IO logging để debug routing
    ping_timeout=60,
    ping_interval=25,
)

# HTTP Client cho MediaSoup Service
mediasoup_client = httpx.AsyncClient(
    base_url=MEDIASOUP_URL,
    timeout=30.0
)

# State Management
class RoomState:
    """Quản lý state của rooms"""
    def __init__(self):
        # rooms: {room_id: {user_id: {socket_id, username, ...}}}
        self.rooms: Dict[str, Dict[str, dict]] = {}
        # socket_to_user: {socket_id: {room_id, user_id}}
        self.socket_to_user: Dict[str, dict] = {}
        # user_transports: {user_id: [transport_ids]}
        self.user_transports: Dict[str, list] = {}
    
    def add_user(self, room_id: str, user_id: str, socket_id: str, username: str):
        """Thêm user vào room"""
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
        
        self.rooms[room_id][user_id] = {
            'socket_id': socket_id,
            'username': username,
            'joined_at': datetime.utcnow().isoformat(),
            'producers': [],  # List of producer IDs
        }
        
        self.socket_to_user[socket_id] = {
            'room_id': room_id,
            'user_id': user_id,
        }
        
        # Initialize transport tracking for user
        if user_id not in self.user_transports:
            self.user_transports[user_id] = []
        
        logger.info(f"✅ User {username} ({user_id}) joined room {room_id}")
    
    def remove_user(self, socket_id: str):
        """Xóa user khỏi room"""
        if socket_id not in self.socket_to_user:
            return None, None, []
        
        user_data = self.socket_to_user[socket_id]
        room_id = user_data['room_id']
        user_id = user_data['user_id']
        
        # Get user's transports for cleanup
        transports_to_cleanup = self.user_transports.get(user_id, [])
        
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            username = self.rooms[room_id][user_id]['username']
            del self.rooms[room_id][user_id]
            
            # Xóa room nếu rỗng
            if not self.rooms[room_id]:
                del self.rooms[room_id]
                logger.info(f"🗑️  Room {room_id} deleted (empty)")
            
            logger.info(f"👋 User {username} ({user_id}) left room {room_id}")
        
        # Cleanup transport tracking
        if user_id in self.user_transports:
            del self.user_transports[user_id]
        
        del self.socket_to_user[socket_id]
        
        return room_id, user_id, transports_to_cleanup
    
    def add_transport(self, user_id: str, transport_id: str):
        """Track transport cho user"""
        if user_id not in self.user_transports:
            self.user_transports[user_id] = []
        
        self.user_transports[user_id].append(transport_id)
        logger.info(f"📊 Transport {transport_id} tracked for user {user_id} (total: {len(self.user_transports[user_id])})")
    
    def get_room_users(self, room_id: str) -> list:
        """Lấy danh sách users trong room"""
        if room_id not in self.rooms:
            return []
        
        return [
            {
                'user_id': user_id,
                **user_data
            }
            for user_id, user_data in self.rooms[room_id].items()
        ]
    
    def add_producer(self, room_id: str, user_id: str, producer_id: str):
        """Thêm producer ID cho user"""
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            self.rooms[room_id][user_id]['producers'].append(producer_id)

# Global state
room_state = RoomState()

# ==================== Socket.IO Events ====================

@sio.event
async def connect(sid, environ):
    """Client connected"""
    logger.info(f"🔌 Client connected: {sid}")
    await sio.emit('connected', {'socket_id': sid}, room=sid)

@sio.event
async def disconnect(sid):
    """
    Client disconnected - CRITICAL: Cleanup transports để giải phóng ports
    Best practice: Delete empty rooms → auto cleanup ALL transports/producers/consumers
    """
    logger.info(f"🔌 Client disconnected: {sid}")
    
    # Remove user and get info
    room_id, user_id, transports = room_state.remove_user(sid)
    
    if room_id and user_id:
        # Check if room is now empty
        remaining_users = room_state.get_room_users(room_id)
        
        if not remaining_users:
            # Room empty → Delete room to free ALL resources
            logger.info(f"🗑️  Room {room_id} is empty, deleting to free all transports...")
            
            try:
                response = await mediasoup_client.delete(f'/room/{room_id}')
                
                if response.status_code == 200:
                    logger.info(f"✅ Room {room_id} deleted - all transports freed")
                else:
                    logger.warning(f"⚠️  Room delete failed: {room_id} - {response.text}")
                    
            except Exception as e:
                logger.error(f"❌ Error deleting room {room_id}: {e}")
        else:
            logger.info(f"👥 Room {room_id} still has {len(remaining_users)} users")
        
        # Notify other users
        await sio.emit('user-left', {
            'user_id': user_id,
            'timestamp': datetime.utcnow().isoformat()
        }, room=room_id, skip_sid=sid)

@sio.event
async def join_room(sid, data):
    """
    User join room
    Payload: {roomId: str, name: str}
    """
    try:
        room_id = data.get('roomId')
        name = data.get('name', 'Anonymous')
        user_id = sid  # Use socket ID as user ID
        
        logger.info(f"📥 join-room: {name} → {room_id}")
        
        # Add user to room state
        room_state.add_user(room_id, user_id, sid, name)
        
        # Join Socket.IO room
        await sio.enter_room(sid, room_id)
        
        # Get MediaSoup router RTP capabilities
        try:
            response = await mediasoup_client.get(f'/router/{room_id}/capabilities')
            response.raise_for_status()
            rtp_capabilities = response.json()['rtpCapabilities']
        except Exception as e:
            logger.error(f"❌ Failed to get router capabilities: {e}")
            await sio.emit('error', {
                'message': 'Failed to get router capabilities'
            }, room=sid)
            return
        
        # Notify user: room joined
        await sio.emit('room-joined', {
            'roomId': room_id,
            'userId': user_id,
            'rtpCapabilities': rtp_capabilities,
            'users': room_state.get_room_users(room_id),
        }, room=sid)
        
        # Notify other users: new user joined
        await sio.emit('user-joined', {
            'userId': user_id,
            'name': name,
            'timestamp': datetime.utcnow().isoformat()
        }, room=room_id, skip_sid=sid)
        
        logger.info(f"✅ {name} joined room {room_id} successfully")
        
    except Exception as e:
        logger.error(f"❌ Error in join-room: {e}", exc_info=True)
        await sio.emit('error', {'message': str(e)}, room=sid)

@sio.event
async def getRouterRtpCapabilities(sid, data):
    """
    Lấy RTP capabilities của router
    Payload: {roomId: str}
    Response: {rtpCapabilities: object} hoặc {error: str}
    """
    try:
        room_id = data.get('roomId')
        
        logger.info(f"📥 getRouterRtpCapabilities: room {room_id}")
        
        response = await mediasoup_client.get(f'/router/{room_id}/capabilities')
        response.raise_for_status()
        result = response.json()
        
        logger.info(f"✅ Router RTP capabilities retrieved for room {room_id}")
        
        # Return để trigger callback ở frontend
        return result
            
    except Exception as e:
        logger.error(f"❌ Error getting RTP capabilities: {e}")
        return {'error': str(e)}

@sio.event
@sio.event
async def createWebRtcTransport(sid, data):
    """
    Tạo WebRTC Transport
    Payload: {roomId: str, type: 'send'|'recv'}
    Response: Transport parameters hoặc {error: str}
    """
    try:
        room_id = data.get('roomId')
        transport_type = data.get('type', 'send')
        
        logger.info(f"📥 createWebRtcTransport: {transport_type} for room {room_id}")
        
        response = await mediasoup_client.post('/transport/create', json={
            'roomId': room_id,
            'type': transport_type
        })
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            # Bubble up error body for better visibility on the frontend
            body = e.response.text if e.response is not None else str(e)
            logger.error(f"❌ MediaSoup /transport/create failed: {e} | body={body}")
            return {'error': f"{e}: {body}"}
        result = response.json()
        
        logger.info(f"✅ Transport created: {result['id']}")
        
        # Track transport for cleanup
        user_info = room_state.socket_to_user.get(sid)
        if user_info:
            room_state.add_transport(user_info['user_id'], result['id'])
        
        return result
            
    except Exception as e:
        logger.error(f"❌ Error creating transport: {e}")
        return {'error': str(e)}

@sio.event
async def connectWebRtcTransport(sid, data):
    """
    Connect WebRTC Transport
    Payload: {roomId: str, transportId: str, dtlsParameters: dict}
    Response: {connected: bool} hoặc {error: str}
    """
    try:
        room_id = data.get('roomId')
        transport_id = data.get('transportId')
        dtls_parameters = data.get('dtlsParameters')
        
        logger.info(f"📥 connectWebRtcTransport: {transport_id}")
        
        response = await mediasoup_client.post('/transport/connect', json={
            'roomId': room_id,
            'transportId': transport_id,
            'dtlsParameters': dtls_parameters
        })
        response.raise_for_status()
        result = response.json()
        
        logger.info(f"✅ Transport connected: {transport_id}")
        
        return result
            
    except Exception as e:
        logger.error(f"❌ Error connecting transport: {e}")
        return {'error': str(e)}

@sio.event
async def produce(sid, data):
    """
    Create Producer
    Payload: {roomId: str, transportId: str, kind: 'audio'|'video', rtpParameters: dict}
    Response: {id: str} hoặc {error: str}
    """
    try:
        room_id = data.get('roomId')
        transport_id = data.get('transportId')
        kind = data.get('kind')
        rtp_parameters = data.get('rtpParameters')
        
        logger.info(f"📥 produce: {kind} for room {room_id}")
        
        response = await mediasoup_client.post('/producer/create', json={
            'roomId': room_id,
            'transportId': transport_id,
            'kind': kind,
            'rtpParameters': rtp_parameters
        })
        response.raise_for_status()
        result = response.json()
        
        producer_id = result['id']
        
        # Save producer ID
        user_data = room_state.socket_to_user.get(sid)
        if user_data:
            room_state.add_producer(
                user_data['room_id'],
                user_data['user_id'],
                producer_id
            )
        
        logger.info(f"✅ Producer created: {producer_id} ({kind})")
        
        # Notify other users: new producer (CRITICAL: use producerSocketId not userId)
        await sio.emit('new-producer', {
            'producerId': producer_id,
            'producerSocketId': sid,  # Frontend expects producerSocketId
            'kind': kind
        }, room=room_id, skip_sid=sid)
        
        return result
            
    except Exception as e:
        logger.error(f"❌ Error producing: {e}")
        return {'error': str(e)}

@sio.event
async def consume(sid, data):
    """
    Create Consumer
    Payload: {roomId: str, transportId: str, producerId: str, rtpCapabilities: dict}
    Response: Consumer params hoặc {error: str}
    """
    try:
        room_id = data.get('roomId')
        transport_id = data.get('transportId')
        producer_id = data.get('producerId')
        rtp_capabilities = data.get('rtpCapabilities')
        
        logger.info(f"📥 consume: producer {producer_id}")
        
        response = await mediasoup_client.post('/consumer/create', json={
            'roomId': room_id,
            'transportId': transport_id,
            'producerId': producer_id,
            'rtpCapabilities': rtp_capabilities
        })
        response.raise_for_status()
        result = response.json()
        
        logger.info(f"✅ Consumer created: {result['id']}")
        
        return result
            
    except Exception as e:
        logger.error(f"❌ Error consuming: {e}")
        return {'error': str(e)}

@sio.event
async def resume_consumer(sid, data):
    """
    Resume Consumer
    Payload: {roomId: str, consumerId: str}
    Response: {resumed: bool} hoặc {error: str}
    """
    try:
        room_id = data.get('roomId')
        consumer_id = data.get('consumerId')
        
        logger.info(f"📥 resume-consumer: {consumer_id}")
        
        response = await mediasoup_client.post(f'/consumer/{consumer_id}/resume', json={
            'roomId': room_id
        })
        response.raise_for_status()
        result = response.json()
        
        logger.info(f"✅ Consumer resumed: {consumer_id}")
        
        return result
            
    except Exception as e:
        logger.error(f"❌ Error resuming consumer: {e}")
        return {'error': str(e)}

@sio.event
async def producer_closed(sid, data):
    """
    Producer closed notification
    Payload: {roomId: str, producerId: str}
    """
    try:
        room_id = data.get('roomId')
        producer_id = data.get('producerId')
        
        logger.info(f"📥 producer-closed: {producer_id}")
        
        # Notify other users
        await sio.emit('producer-closed', {
            'userId': sid,
            'producerId': producer_id
        }, room=room_id, skip_sid=sid)
        
    except Exception as e:
        logger.error(f"❌ Error in producer-closed: {e}")

# ==================== HTTP Endpoints ====================

@app.get("/health")
async def health_check():
    """Health check"""
    return {
        "status": "healthy",
        "service": "signaling-socketio",
        "version": "2.4.0",
        "active_rooms": len(room_state.rooms),
        "active_users": len(room_state.socket_to_user),
        "tracked_transports": sum(len(t) for t in room_state.user_transports.values()),
    }

@app.get("/rooms")
async def list_rooms():
    """List active rooms"""
    return {
        "rooms": [
            {
                "room_id": room_id,
                "users": room_state.get_room_users(room_id)
            }
            for room_id in room_state.rooms.keys()
        ]
    }

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "JB Calling Signaling Service",
        "version": "2.4.0",
        "socket_io": "/socket.io/",
        "mediasoup_url": MEDIASOUP_URL,
        "features": ["transport-auto-cleanup", "port-management"]
    }

# Cleanup on shutdown
@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup resources"""
    await mediasoup_client.aclose()
    logger.info("✅ Signaling Service shutdown complete")

# Wrap FastAPI app với Socket.IO (theo documentation chính thức)
# Socket.IO sẽ handle /socket.io/* paths, còn lại forward đến FastAPI
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)

# Debug: Confirm socket_app type
print(f"🔍 DEBUG: socket_app type = {type(socket_app)}")
print(f"🔍 DEBUG: socket_app.engineio_path = {socket_app.engineio_path}")
print(f"🔍 DEBUG: sio = {sio}")
print(f"🔍 DEBUG: app = {app}")

# Export socket_app cho uvicorn
# uvicorn signaling_socketio:socket_app --host 0.0.0.0 --port 8001

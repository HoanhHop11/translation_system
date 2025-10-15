# WebSocket Signaling Server - WebRTC Signaling
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Set
from pydantic import BaseModel
from datetime import datetime
import json
import logging
import asyncio

logger = logging.getLogger(__name__)

app = FastAPI(
    title="JB Calling Signaling Server",
    description="WebSocket server cho WebRTC signaling",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Connection Management
class ConnectionManager:
    """
    Quản lý các WebSocket connections và rooms.
    """
    def __init__(self):
        # rooms: {room_id: {user_id: websocket}}
        self.rooms: Dict[str, Dict[str, WebSocket]] = {}
        # user_info: {user_id: {username, room_id}}
        self.user_info: Dict[str, dict] = {}
    
    async def connect(self, websocket: WebSocket, room_id: str, user_id: str, username: str):
        """
        Kết nối user vào room.
        """
        await websocket.accept()
        
        # Tạo room nếu chưa tồn tại
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
            logger.info(f"📦 Room mới được tạo: {room_id}")
        
        # Thêm user vào room
        self.rooms[room_id][user_id] = websocket
        self.user_info[user_id] = {
            "username": username,
            "room_id": room_id,
            "joined_at": datetime.utcnow().isoformat()
        }
        
        logger.info(f"👤 User {username} ({user_id}) joined room {room_id}")
        
        # Thông báo cho các users khác trong room
        await self.broadcast_to_room(
            room_id,
            {
                "type": "user_joined",
                "user_id": user_id,
                "username": username,
                "timestamp": datetime.utcnow().isoformat()
            },
            exclude_user=user_id
        )
        
        # Gửi danh sách users hiện tại cho user mới
        current_users = [
            {"user_id": uid, **self.user_info[uid]}
            for uid in self.rooms[room_id].keys()
            if uid != user_id
        ]
        await websocket.send_json({
            "type": "room_state",
            "users": current_users
        })
    
    async def disconnect(self, user_id: str):
        """
        Ngắt kết nối user khỏi room.
        """
        if user_id not in self.user_info:
            return
        
        user_data = self.user_info[user_id]
        room_id = user_data["room_id"]
        username = user_data["username"]
        
        # Xóa user khỏi room
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            del self.rooms[room_id][user_id]
            logger.info(f"👋 User {username} ({user_id}) left room {room_id}")
            
            # Thông báo cho các users khác
            await self.broadcast_to_room(
                room_id,
                {
                    "type": "user_left",
                    "user_id": user_id,
                    "username": username,
                    "timestamp": datetime.utcnow().isoformat()
                }
            )
            
            # Xóa room nếu không còn user
            if len(self.rooms[room_id]) == 0:
                del self.rooms[room_id]
                logger.info(f"🗑️  Room {room_id} đã bị xóa (no users)")
        
        # Xóa user info
        del self.user_info[user_id]
    
    async def broadcast_to_room(self, room_id: str, message: dict, exclude_user: str = None):
        """
        Broadcast message đến tất cả users trong room.
        """
        if room_id not in self.rooms:
            return
        
        disconnected_users = []
        
        for user_id, websocket in self.rooms[room_id].items():
            if user_id == exclude_user:
                continue
            
            try:
                await websocket.send_json(message)
            except Exception as e:
                logger.error(f"Lỗi khi gửi message đến user {user_id}: {e}")
                disconnected_users.append(user_id)
        
        # Cleanup disconnected users
        for user_id in disconnected_users:
            await self.disconnect(user_id)
    
    async def send_to_user(self, user_id: str, message: dict):
        """
        Gửi message đến một user cụ thể.
        """
        if user_id not in self.user_info:
            return False
        
        room_id = self.user_info[user_id]["room_id"]
        if room_id not in self.rooms or user_id not in self.rooms[room_id]:
            return False
        
        try:
            await self.rooms[room_id][user_id].send_json(message)
            return True
        except Exception as e:
            logger.error(f"Lỗi khi gửi message đến user {user_id}: {e}")
            await self.disconnect(user_id)
            return False

# Global connection manager
manager = ConnectionManager()

# WebSocket endpoint
@app.websocket("/ws/{room_id}/{user_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_id: str,
    user_id: str,
    username: str = "Anonymous"
):
    """
    WebSocket endpoint cho signaling.
    
    - **room_id**: ID của room
    - **user_id**: ID của user
    - **username**: Tên hiển thị của user
    """
    await manager.connect(websocket, room_id, user_id, username)
    
    try:
        while True:
            # Nhận message từ client
            data = await websocket.receive_json()
            message_type = data.get("type")
            
            logger.debug(f"📨 Received from {user_id}: {message_type}")
            
            # Xử lý các loại message
            if message_type == "offer":
                # WebRTC offer - forward đến target user
                target_user = data.get("target_user_id")
                await manager.send_to_user(target_user, {
                    "type": "offer",
                    "from_user_id": user_id,
                    "sdp": data.get("sdp"),
                    "timestamp": datetime.utcnow().isoformat()
                })
            
            elif message_type == "answer":
                # WebRTC answer - forward đến target user
                target_user = data.get("target_user_id")
                await manager.send_to_user(target_user, {
                    "type": "answer",
                    "from_user_id": user_id,
                    "sdp": data.get("sdp"),
                    "timestamp": datetime.utcnow().isoformat()
                })
            
            elif message_type == "ice_candidate":
                # ICE candidate - forward đến target user
                target_user = data.get("target_user_id")
                await manager.send_to_user(target_user, {
                    "type": "ice_candidate",
                    "from_user_id": user_id,
                    "candidate": data.get("candidate"),
                    "timestamp": datetime.utcnow().isoformat()
                })
            
            elif message_type == "chat":
                # Chat message - broadcast đến room
                await manager.broadcast_to_room(
                    room_id,
                    {
                        "type": "chat",
                        "from_user_id": user_id,
                        "username": username,
                        "message": data.get("message"),
                        "timestamp": datetime.utcnow().isoformat()
                    },
                    exclude_user=user_id
                )
            
            else:
                logger.warning(f"Unknown message type: {message_type}")
    
    except WebSocketDisconnect:
        logger.info(f"🔌 WebSocket disconnected: {user_id}")
        await manager.disconnect(user_id)
    except Exception as e:
        logger.error(f"❌ Error in WebSocket handler: {e}", exc_info=True)
        await manager.disconnect(user_id)

# HTTP endpoints
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "signaling-server",
        "active_rooms": len(manager.rooms),
        "active_users": len(manager.user_info)
    }

@app.get("/rooms")
async def list_rooms():
    """Liệt kê các rooms đang hoạt động"""
    rooms_info = []
    for room_id, users in manager.rooms.items():
        rooms_info.append({
            "room_id": room_id,
            "user_count": len(users),
            "users": [
                {
                    "user_id": uid,
                    **manager.user_info.get(uid, {})
                }
                for uid in users.keys()
            ]
        })
    
    return {"rooms": rooms_info}

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "JB Calling Signaling Server",
        "version": "1.0.0",
        "websocket": "/ws/{room_id}/{user_id}?username=YourName"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "signaling:app",
        host="0.0.0.0",
        port=8001,
        reload=True,
        log_level="info"
    )

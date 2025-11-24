"""
Simple test để verify Socket.IO ASGI app
Run: uvicorn test_socketio:app --host 0.0.0.0 --port 9000
"""
import socketio

# Socket.IO server
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    logger=True,
    engineio_logger=True,
)

# ASGI app
app = socketio.ASGIApp(sio)

@sio.event
async def connect(sid, environ):
    print(f"✅ Client connected: {sid}")
    await sio.emit('connected', {'socket_id': sid}, room=sid)

@sio.event
async def disconnect(sid):
    print(f"👋 Client disconnected: {sid}")

@sio.event
async def test_event(sid, data):
    print(f"📥 Received test_event: {data}")
    await sio.emit('test_response', {'received': data}, room=sid)

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=9000)

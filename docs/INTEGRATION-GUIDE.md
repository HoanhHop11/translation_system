# Hướng dẫn Tích hợp Video Call vào Hệ thống Ngoài

**Date**: October 6, 2025  
**Version**: 1.0  
**Purpose**: Hướng dẫn tích hợp hệ thống video call translation vào hệ thống PHP/MySQL hiện có

---

## 📋 Tổng quan

Hệ thống video call được thiết kế như một **microservice độc lập** có thể tích hợp vào bất kỳ hệ thống nào qua:
- JWT shared secret authentication
- Session token validation
- Iframe/embed integration
- REST API calls

**Không cần database riêng** - tất cả auth được xử lý bởi hệ thống cha.

---

## 🏗️ Kiến trúc Tích hợp

```
┌─────────────────────────────────────────────────────────────┐
│          HỆ THỐNG CHA (PHP + MySQL/phpMyAdmin)             │
│                                                             │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────┐    │
│  │   Users DB  │   │  Auth/Login  │   │  Sessions   │    │
│  │  (MySQL)    │───│   (PHP)      │───│  (Session)  │    │
│  └─────────────┘   └──────────────┘   └─────────────┘    │
│                            │                               │
│                            │ Generate JWT Token            │
│                            ▼                               │
│                    [JWT with user info]                    │
└─────────────────────────────────────────────────────────────┘
                             │
                             │ Pass token via iframe/API
                             ▼
┌─────────────────────────────────────────────────────────────┐
│       VIDEO CALL MICROSERVICE (Docker Swarm)               │
│                                                             │
│  Frontend → API → Validate JWT → Allow/Deny access         │
│                                                             │
│  Services: WebRTC, STT, Translation, TTS                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Phương pháp Tích hợp

### **Option 1: JWT Shared Secret** (KHUYẾN NGHỊ)

**Ưu điểm:**
- ✅ Stateless, không cần API call
- ✅ Fast - validation local
- ✅ Secure nếu secret được bảo vệ tốt
- ✅ Offline validation (không cần network)

**Flow:**

```php
// 1. Hệ thống PHP tạo JWT token
<?php
use Firebase\JWT\JWT;

$secret_key = "YOUR_SHARED_SECRET_KEY"; // Same secret với video call service
$payload = [
    'user_id' => $user['id'],
    'username' => $user['username'],
    'display_name' => $user['display_name'],
    'email' => $user['email'],
    'avatar' => $user['avatar_url'],
    'role' => $user['role'],
    'iat' => time(),
    'exp' => time() + (60 * 60) // 1 hour expiration
];

$jwt_token = JWT::encode($payload, $secret_key, 'HS256');

// 2. Embed video call với token
echo '<iframe 
    src="https://videocall.jbcalling.site?token=' . $jwt_token . '" 
    width="100%" 
    height="600px"
    frameborder="0"
    allow="camera; microphone; fullscreen"
></iframe>';
?>
```

**Video Call Service sẽ validate:**
```python
# FastAPI validates JWT with same secret
from fastapi import Security, HTTPException
from fastapi_jwt import JwtAuthorizationCredentials, JwtAccessBearer

access_security = JwtAccessBearer(
    secret_key="YOUR_SHARED_SECRET_KEY",  # Same secret
    auto_error=True
)

@app.get("/rooms/join")
def join_room(
    credentials: JwtAuthorizationCredentials = Security(access_security)
):
    # Access user info from JWT
    user_id = credentials["user_id"]
    username = credentials["username"]
    
    # Create/join room
    return {"room_id": "...", "user": username}
```

---

### **Option 2: API Callback Validation**

**Ưu điểm:**
- ✅ Full control - có thể revoke token anytime
- ✅ Real-time user status check
- ✅ Không cần shared secret

**Nhược điểm:**
- ⚠️ Cần maintain PHP API endpoint
- ⚠️ Thêm latency (~50-100ms per validation)
- ⚠️ Network dependency

**Flow:**

```php
// 1. PHP tạo session token (có thể là session ID từ database)
<?php
session_start();
$session_token = session_id();

// Store token in DB với user info
$db->query("INSERT INTO active_sessions (token, user_id, expires_at) 
            VALUES ('$session_token', '$user_id', DATE_ADD(NOW(), INTERVAL 1 HOUR))");

// 2. Tạo API endpoint để validate token
// File: /api/verify-token.php
<?php
header('Content-Type: application/json');

$token = $_GET['token'] ?? '';

// Check token in database
$result = $db->query("SELECT users.* FROM active_sessions 
                      JOIN users ON active_sessions.user_id = users.id
                      WHERE active_sessions.token = '$token' 
                      AND active_sessions.expires_at > NOW()");

if ($user = $result->fetch_assoc()) {
    echo json_encode([
        'valid' => true,
        'user' => [
            'id' => $user['id'],
            'username' => $user['username'],
            'display_name' => $user['display_name'],
            'email' => $user['email']
        ]
    ]);
} else {
    http_response_code(401);
    echo json_encode(['valid' => false, 'error' => 'Invalid or expired token']);
}
?>
```

**Video Call Service sẽ call API:**
```python
import httpx

@app.get("/rooms/join")
async def join_room(token: str):
    # Call PHP API to validate token
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://your-php-system.com/api/verify-token.php",
            params={"token": token}
        )
    
    if response.status_code == 200:
        data = response.json()
        if data['valid']:
            user = data['user']
            # Proceed with room join
            return {"room_id": "...", "user": user}
    
    raise HTTPException(status_code=401, detail="Invalid token")
```

---

## 🔧 Cấu hình

### **1. Environment Variables**

Thêm vào file `.env` của video call service:

```bash
# Auth Configuration
DEMO_MODE=false                          # Set to false for production
EXTERNAL_AUTH_ENABLED=true               # Enable external auth
JWT_SECRET_KEY=your_shared_secret_key    # Same as PHP system
JWT_ALGORITHM=HS256                      # JWT algorithm

# For API callback method (optional)
EXTERNAL_AUTH_URL=https://your-php-system.com/api/verify-token.php
```

### **2. CORS Configuration**

Đảm bảo PHP system được whitelist trong CORS:

```yaml
# stack-with-ssl.yml
environment:
  - CORS_ORIGINS=https://your-php-system.com,https://videocall.jbcalling.site
```

---

## 📱 Frontend Integration

### **Phương pháp 1: Iframe Embed**

```html
<!-- Trong trang PHP của bạn -->
<!DOCTYPE html>
<html>
<head>
    <title>Video Call</title>
</head>
<body>
    <h1>Welcome, <?php echo $user['display_name']; ?></h1>
    
    <!-- Embed video call -->
    <iframe 
        id="videocall-frame"
        src="https://videocall.jbcalling.site?token=<?php echo $jwt_token; ?>" 
        width="100%" 
        height="600px"
        frameborder="0"
        allow="camera; microphone; fullscreen; display-capture"
        allowfullscreen
    ></iframe>
</body>
</html>
```

### **Phương pháp 2: JavaScript Integration**

```html
<div id="videocall-container"></div>

<script>
// Get JWT token from your PHP backend
fetch('/api/get-videocall-token.php')
    .then(res => res.json())
    .then(data => {
        const token = data.jwt_token;
        
        // Create iframe dynamically
        const iframe = document.createElement('iframe');
        iframe.src = `https://videocall.jbcalling.site?token=${token}`;
        iframe.width = '100%';
        iframe.height = '600px';
        iframe.allow = 'camera; microphone; fullscreen';
        
        document.getElementById('videocall-container').appendChild(iframe);
    });
</script>
```

### **Phương pháp 3: Popup Window**

```javascript
function openVideoCall(jwt_token) {
    const width = 1200;
    const height = 800;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;
    
    window.open(
        `https://videocall.jbcalling.site?token=${jwt_token}`,
        'videocall',
        `width=${width},height=${height},left=${left},top=${top},` +
        `toolbar=no,menubar=no,scrollbars=no,resizable=yes`
    );
}
```

---

## 🔐 Security Best Practices

### **1. JWT Secret Key**

```bash
# Generate strong secret key
openssl rand -base64 32
# Example: 8f3Kd9Ls2Mn4Pq7Rt1Vw6Yx8Za0Bc3Ef

# NEVER commit to git - use environment variables
```

### **2. Token Expiration**

```php
$payload = [
    // ... user data
    'exp' => time() + (60 * 60)  // 1 hour - adjust as needed
];
```

**Khuyến nghị:**
- Meeting calls: 2-4 hours
- Quick calls: 30-60 minutes
- Support calls: 1 hour

### **3. HTTPS Only**

```yaml
# Force HTTPS in production
- "traefik.http.routers.api.entrypoints=websecure"
- "traefik.http.routers.api.tls.certresolver=letsencrypt"
```

### **4. Rate Limiting**

Implement rate limiting on PHP side:
```php
// Limit token generation per user
$tokens_created = get_user_token_count($user_id, last_hour);
if ($tokens_created > 10) {
    die('Rate limit exceeded');
}
```

---

## 🧪 Testing

### **Test 1: Generate JWT Token**

```php
<?php
// test-jwt.php
require 'vendor/autoload.php';
use Firebase\JWT\JWT;

$secret_key = "your_shared_secret_key";
$payload = [
    'user_id' => 1,
    'username' => 'testuser',
    'display_name' => 'Test User',
    'iat' => time(),
    'exp' => time() + 3600
];

$token = JWT::encode($payload, $secret_key, 'HS256');
echo "JWT Token: " . $token . "\n";

// Test URL
echo "\nTest URL: https://videocall.jbcalling.site?token=" . $token . "\n";
?>
```

### **Test 2: Validate Token**

```bash
# Test validation endpoint
curl -X GET "https://api.jbcalling.site/auth/validate" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected response:
# {
#   "valid": true,
#   "user": {
#     "user_id": 1,
#     "username": "testuser"
#   }
# }
```

---

## 🎯 Demo Mode

Hiện tại hệ thống đang chạy **DEMO MODE** - không cần authentication:

```bash
# .env
DEMO_MODE=true
```

**Features:**
- ✅ Random room codes (e.g., "DEMO-ABC123")
- ✅ No login required
- ✅ Share room code để join
- ✅ Nickname-based (không cần user account)

**Access:**
```
https://videocall.jbcalling.site
```

**To disable demo mode:**
```bash
DEMO_MODE=false
EXTERNAL_AUTH_ENABLED=true
```

---

## 📊 Room Management

### **Redis-based Room Storage**

Rooms được lưu trong Redis với TTL tự động:

```python
# Room structure
{
    "room_id": "ABC123",
    "created_at": "2025-10-06T10:30:00Z",
    "created_by": "user_123",
    "participants": [
        {
            "user_id": "user_123",
            "username": "john_doe",
            "joined_at": "2025-10-06T10:30:00Z"
        }
    ],
    "settings": {
        "max_participants": 10,
        "translation_enabled": true,
        "languages": ["en", "vi"]
    }
}
```

**TTL:** 24 hours (tự động xóa sau 24h không hoạt động)

---

## 🔗 API Endpoints

### **1. Create Room**

```http
POST /rooms/create
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "name": "My Meeting Room",
  "max_participants": 10,
  "translation_enabled": true
}

Response:
{
  "room_id": "ABC123",
  "join_url": "https://videocall.jbcalling.site/room/ABC123"
}
```

### **2. Join Room**

```http
POST /rooms/{room_id}/join
Authorization: Bearer {jwt_token}

Response:
{
  "success": true,
  "room": {
    "room_id": "ABC123",
    "participants_count": 2
  }
}
```

### **3. Leave Room**

```http
POST /rooms/{room_id}/leave
Authorization: Bearer {jwt_token}

Response:
{
  "success": true
}
```

---

## 🛠️ Troubleshooting

### **Issue 1: "Invalid token" error**

**Cause:** Secret key mismatch hoặc token expired

**Solution:**
```bash
# Check secret keys match
# PHP side
echo getenv('JWT_SECRET_KEY');

# Video call side
docker exec $(docker ps -q -f name=translation_api) env | grep JWT_SECRET_KEY
```

### **Issue 2: CORS errors**

**Cause:** PHP domain không được whitelist

**Solution:**
```yaml
# Add your domain to CORS_ORIGINS
CORS_ORIGINS=https://your-php-system.com,https://videocall.jbcalling.site
```

### **Issue 3: Camera/Microphone not working in iframe**

**Solution:**
```html
<!-- Add allow attribute -->
<iframe 
    allow="camera; microphone; fullscreen; display-capture"
    ...
></iframe>
```

---

## 📚 Dependencies

### **PHP Side**

```bash
composer require firebase/php-jwt
```

### **Video Call Side**

Already included in Docker image:
- fastapi-jwt
- python-jose[cryptography]
- redis

---

## 🚀 Deployment Checklist

- [ ] Generate strong JWT secret key
- [ ] Configure `.env` với EXTERNAL_AUTH_ENABLED=true
- [ ] Update CORS_ORIGINS với PHP domain
- [ ] Test JWT token generation
- [ ] Test token validation
- [ ] Deploy updated stack
- [ ] Test iframe integration
- [ ] Monitor logs

---

## 📞 Support

**Issues:** https://github.com/yourusername/jbcalling_translation_realtime/issues  
**Docs:** https://github.com/yourusername/jbcalling_translation_realtime/docs

---

**Last Updated:** October 6, 2025  
**Version:** 1.0  
**Author:** JB Calling Team

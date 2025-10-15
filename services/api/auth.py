# Authentication Router - JWT & User Management
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime, timedelta
import jwt
import secrets
import os
import hashlib
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# Security
security = HTTPBearer()

# JWT Configuration từ environment variables
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "default-secret-key-change-in-production")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

# Pydantic Models
class UserRegister(BaseModel):
    """Model cho đăng ký user mới"""
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8)
    full_name: Optional[str] = None

class UserLogin(BaseModel):
    """Model cho đăng nhập"""
    username: str
    password: str

class Token(BaseModel):
    """Model cho JWT token response"""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int

class TokenData(BaseModel):
    """Data được lưu trong JWT token"""
    user_id: str
    username: str
    email: str

class UserResponse(BaseModel):
    """Model cho user response (không trả về password)"""
    id: str
    username: str
    email: str
    full_name: Optional[str]
    created_at: datetime
    is_active: bool

# Helper Functions
def hash_password(password: str) -> str:
    """
    Hash password bằng SHA256.
    Trong production nên dùng bcrypt hoặc argon2.
    """
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password"""
    return hash_password(plain_password) == hashed_password

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Tạo JWT access token.
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token(data: dict) -> str:
    """
    Tạo JWT refresh token.
    """
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def decode_token(token: str) -> dict:
    """
    Decode và verify JWT token.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token đã hết hạn",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token không hợp lệ",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> TokenData:
    """
    Dependency để lấy thông tin user hiện tại từ JWT token.
    """
    token = credentials.credentials
    payload = decode_token(token)
    
    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token type không hợp lệ"
        )
    
    return TokenData(
        user_id=payload.get("sub"),
        username=payload.get("username"),
        email=payload.get("email")
    )

# API Endpoints
@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user: UserRegister):
    """
    Đăng ký user mới.
    
    - **email**: Email hợp lệ
    - **username**: Tên đăng nhập (3-50 ký tự)
    - **password**: Mật khẩu (tối thiểu 8 ký tự)
    - **full_name**: Tên đầy đủ (optional)
    """
    # TODO: Kiểm tra user đã tồn tại trong database
    # TODO: Lưu user vào database
    
    logger.info(f"Đăng ký user mới: {user.username}")
    
    # Mock response (trong production sẽ lưu vào PostgreSQL)
    return UserResponse(
        id=secrets.token_hex(16),
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        created_at=datetime.utcnow(),
        is_active=True
    )

@router.post("/login", response_model=Token)
async def login(credentials: UserLogin):
    """
    Đăng nhập và nhận JWT tokens.
    
    Returns access token và refresh token.
    """
    # TODO: Verify credentials với database
    
    logger.info(f"User đăng nhập: {credentials.username}")
    
    # Mock user data (trong production sẽ query từ database)
    user_data = {
        "sub": secrets.token_hex(16),  # user_id
        "username": credentials.username,
        "email": f"{credentials.username}@example.com"
    }
    
    access_token = create_access_token(user_data)
    refresh_token = create_refresh_token(user_data)
    
    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )

@router.post("/refresh", response_model=Token)
async def refresh_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Làm mới access token bằng refresh token.
    """
    token = credentials.credentials
    payload = decode_token(token)
    
    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token type không hợp lệ. Cần refresh token."
        )
    
    user_data = {
        "sub": payload.get("sub"),
        "username": payload.get("username"),
        "email": payload.get("email")
    }
    
    new_access_token = create_access_token(user_data)
    new_refresh_token = create_refresh_token(user_data)
    
    return Token(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )

@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: TokenData = Depends(get_current_user)):
    """
    Lấy thông tin user hiện tại.
    Yêu cầu authentication.
    """
    # TODO: Query user info từ database
    
    return UserResponse(
        id=current_user.user_id,
        username=current_user.username,
        email=current_user.email,
        full_name=None,
        created_at=datetime.utcnow(),
        is_active=True
    )

@router.post("/logout")
async def logout(current_user: TokenData = Depends(get_current_user)):
    """
    Đăng xuất user.
    
    Note: Với JWT, thường client sẽ xóa token.
    Server có thể implement token blacklist nếu cần.
    """
    logger.info(f"User đăng xuất: {current_user.username}")
    
    return {"message": "Đăng xuất thành công"}

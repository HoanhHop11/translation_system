# API Gateway Service - Main Application
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import time
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Quản lý lifecycle của ứng dụng.
    Được gọi khi start và shutdown app.
    """
    logger.info("🚀 API Gateway đang khởi động...")
    # Startup logic
    yield
    # Shutdown logic
    logger.info("🛑 API Gateway đang tắt...")

# Khởi tạo FastAPI app
app = FastAPI(
    title="JB Calling API Gateway",
    description="API Gateway cho hệ thống videocall dịch thuật realtime",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: Cập nhật với domains thực tế trong production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Trusted Host Middleware (bảo vệ chống Host header attacks)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"]  # TODO: Cập nhật với hosts thực tế trong production
)

# Middleware để đo thời gian xử lý request
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """
    Thêm header X-Process-Time để đo thời gian xử lý request.
    Hữu ích cho monitoring và debugging.
    """
    start_time = time.perf_counter()
    response = await call_next(request)
    process_time = time.perf_counter() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response

# Exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Handler toàn cục cho tất cả exceptions.
    """
    logger.error(f"Lỗi không xử lý được: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "Internal Server Error",
            "message": "Đã xảy ra lỗi. Vui lòng thử lại sau.",
            "detail": str(exc) if app.debug else None
        }
    )

# Health check endpoint
@app.get("/health", tags=["System"])
async def health_check():
    """
    Kiểm tra tình trạng sức khỏe của service.
    """
    return {
        "status": "healthy",
        "service": "api-gateway",
        "version": "1.0.0"
    }

# Root endpoint
@app.get("/", tags=["System"])
async def root():
    """
    Root endpoint - thông tin cơ bản về API.
    """
    return {
        "message": "JB Calling API Gateway",
        "version": "1.0.0",
        "docs": "/api/docs",
        "health": "/health"
    }

# API Router placeholder
# TODO: Import và include các routers từ modules khác
# from .routers import auth, rooms, users
# app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
# app.include_router(rooms.router, prefix="/api/v1/rooms", tags=["Rooms"])
# app.include_router(users.router, prefix="/api/v1/users", tags=["Users"])

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )

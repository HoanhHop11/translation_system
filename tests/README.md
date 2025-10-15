# Tests Directory

Comprehensive test suite cho hệ thống.

## Cấu trúc

```
tests/
├── unit/                   # Unit tests
│   ├── test_api/
│   ├── test_transcription/
│   ├── test_translation/
│   ├── test_voice_cloning/
│   └── test_shared/
├── integration/            # Integration tests
│   ├── test_api_db/
│   ├── test_api_redis/
│   ├── test_ai_pipeline/
│   └── test_webrtc/
├── e2e/                    # End-to-end tests
│   ├── test_user_flow/
│   ├── test_room_flow/
│   └── test_translation_flow/
├── load/                   # Load tests
│   ├── locustfile.py
│   └── scenarios/
├── fixtures/               # Test fixtures
│   ├── audio/
│   ├── documents/
│   └── data.py
├── mocks/                  # Mock services
│   └── __init__.py
├── conftest.py            # Pytest configuration
├── pytest.ini             # Pytest settings
└── README.md              # This file
```

## Test Categories

### Unit Tests
Test individual components in isolation:
```python
# tests/unit/test_transcription/test_whisper_service.py
import pytest
from services.transcription.whisper_service import WhisperService

def test_transcribe_audio():
    """Test Whisper transcription"""
    service = WhisperService()
    audio = load_test_audio("sample.wav")
    
    result = service.transcribe(audio)
    
    assert result.text != ""
    assert result.language == "en"
    assert result.confidence > 0.8
```

### Integration Tests
Test interactions giữa components:
```python
# tests/integration/test_api_db/test_user_api.py
import pytest
from fastapi.testclient import TestClient
from services.api.main import app

@pytest.fixture
def client():
    return TestClient(app)

def test_create_user(client):
    """Test user creation API với database"""
    response = client.post("/api/v1/users", json={
        "email": "test@example.com",
        "password": "SecurePass123!",
        "name": "Test User"
    })
    
    assert response.status_code == 201
    assert response.json()["email"] == "test@example.com"
```

### End-to-End Tests
Test complete user flows:
```python
# tests/e2e/test_translation_flow/test_full_pipeline.py
import pytest
import asyncio

async def test_full_translation_flow():
    """Test complete flow: audio → transcription → translation → voice"""
    # 1. Create room
    room = await create_room()
    
    # 2. Join room
    user1 = await join_room(room.id, "user1")
    user2 = await join_room(room.id, "user2")
    
    # 3. Send audio
    audio = load_test_audio("vietnamese.wav")
    await user1.send_audio(audio)
    
    # 4. Wait for transcription
    transcription = await user2.wait_for_transcription(timeout=5)
    assert transcription.language == "vi"
    
    # 5. Wait for translation
    translation = await user2.wait_for_translation(timeout=5)
    assert translation.language == "en"
    
    # 6. Verify voice synthesis
    synthesized = await user2.wait_for_audio(timeout=5)
    assert len(synthesized) > 0
```

### Load Tests
Stress testing với Locust:
```python
# tests/load/locustfile.py
from locust import HttpUser, task, between

class TranslationUser(HttpUser):
    wait_time = between(1, 3)
    
    @task(3)
    def transcribe_audio(self):
        """Transcribe audio - high frequency task"""
        with open("fixtures/audio/sample.wav", "rb") as f:
            self.client.post("/api/v1/transcribe", files={"audio": f})
    
    @task(2)
    def translate_text(self):
        """Translate text - medium frequency"""
        self.client.post("/api/v1/translate", json={
            "text": "Hello world",
            "source": "en",
            "target": "vi"
        })
    
    @task(1)
    def list_rooms(self):
        """List rooms - low frequency"""
        self.client.get("/api/v1/rooms")
```

## Fixtures

### Audio Fixtures
```python
# tests/fixtures/data.py
import pytest
import numpy as np

@pytest.fixture
def sample_audio():
    """Generate test audio"""
    sr = 16000
    duration = 5  # seconds
    t = np.linspace(0, duration, sr * duration)
    audio = np.sin(2 * np.pi * 440 * t)  # 440 Hz sine wave
    return audio

@pytest.fixture
def audio_files():
    """Real audio files for testing"""
    return {
        "en": "fixtures/audio/english.wav",
        "vi": "fixtures/audio/vietnamese.wav",
        "zh": "fixtures/audio/chinese.wav"
    }
```

### Database Fixtures
```python
# tests/conftest.py
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

@pytest.fixture(scope="function")
def db_session():
    """Create test database session"""
    engine = create_engine("sqlite:///:memory:")
    Session = sessionmaker(bind=engine)
    session = Session()
    
    # Create tables
    Base.metadata.create_all(engine)
    
    yield session
    
    # Cleanup
    session.close()
    Base.metadata.drop_all(engine)
```

### Redis Fixtures
```python
@pytest.fixture
def redis_client():
    """Test Redis client"""
    client = redis.Redis(host='localhost', port=6379, db=15)
    yield client
    client.flushdb()  # Cleanup
```

## Mocking

### External Services
```python
# tests/mocks/__init__.py
from unittest.mock import Mock

class MockWhisperModel:
    """Mock Whisper model cho testing"""
    def transcribe(self, audio):
        return {
            "text": "This is a test transcription",
            "language": "en",
            "segments": [
                {"start": 0.0, "end": 2.5, "text": "This is a test"}
            ]
        }

@pytest.fixture
def mock_whisper(monkeypatch):
    """Mock Whisper model"""
    monkeypatch.setattr(
        "services.transcription.whisper_service.WhisperModel",
        MockWhisperModel
    )
```

## Running Tests

### All Tests
```bash
pytest
```

### Specific Category
```bash
# Unit tests only
pytest tests/unit/

# Integration tests
pytest tests/integration/

# E2E tests
pytest tests/e2e/
```

### With Coverage
```bash
# Run với coverage report
pytest --cov=services --cov=shared --cov-report=html

# View report
open htmlcov/index.html
```

### Load Tests
```bash
# Start Locust
locust -f tests/load/locustfile.py

# Access web UI
# Open http://localhost:8089
```

### Specific Test
```bash
# Run single test file
pytest tests/unit/test_api/test_auth.py

# Run single test function
pytest tests/unit/test_api/test_auth.py::test_login_success

# Run với markers
pytest -m slow  # Run slow tests only
pytest -m "not slow"  # Skip slow tests
```

## Test Configuration

### pytest.ini
```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*

# Markers
markers =
    slow: marks tests as slow (deselect with '-m "not slow"')
    integration: marks tests as integration tests
    e2e: marks tests as end-to-end tests
    load: marks tests as load tests

# Coverage
addopts =
    --strict-markers
    --tb=short
    --cov-report=term-missing
    --cov-branch

# Timeouts
timeout = 300
```

### conftest.py
```python
# tests/conftest.py
import pytest
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

# Fixtures
@pytest.fixture(scope="session")
def test_data_dir():
    """Path to test data"""
    return Path(__file__).parent / "fixtures"

@pytest.fixture(autouse=True)
def reset_singletons():
    """Reset singleton instances between tests"""
    from shared.utils.redis_client import RedisClient
    RedisClient._instance = None
```

## CI/CD Integration

### GitHub Actions
```yaml
# .github/workflows/tests.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
      redis:
        image: redis:7
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'
      
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install -r requirements-dev.txt
      
      - name: Run tests
        run: pytest --cov --cov-report=xml
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

## Best Practices

### Test Structure (AAA Pattern)
```python
def test_something():
    # Arrange - Setup
    service = MyService()
    input_data = prepare_test_data()
    
    # Act - Execute
    result = service.process(input_data)
    
    # Assert - Verify
    assert result.success
    assert result.value == expected_value
```

### Test Naming
```python
# Good names
def test_transcribe_returns_text_for_valid_audio():
    pass

def test_translate_raises_error_for_unsupported_language():
    pass

# Bad names
def test_1():
    pass

def test_stuff():
    pass
```

### Parametrization
```python
@pytest.mark.parametrize("language,expected", [
    ("en", "Hello"),
    ("vi", "Xin chào"),
    ("zh", "你好"),
])
def test_translate_to_english(language, expected):
    result = translate(expected, language, "en")
    assert "hello" in result.lower()
```

### Async Tests
```python
@pytest.mark.asyncio
async def test_async_function():
    result = await some_async_function()
    assert result is not None
```

## Coverage Goals

### Minimum Coverage
- Overall: 80%
- Critical paths: 100%
- New code: 90%

### Check Coverage
```bash
# Generate report
pytest --cov --cov-report=html

# Fail if below threshold
pytest --cov --cov-fail-under=80
```

## Performance Testing

### Benchmarking
```python
import pytest

def test_transcription_performance(benchmark):
    """Benchmark transcription speed"""
    audio = load_test_audio()
    service = TranscriptionService()
    
    result = benchmark(service.transcribe, audio)
    
    # Assert performance
    assert benchmark.stats['mean'] < 0.5  # <500ms average
```

## Documentation

Each test PHẢI có:
- Descriptive name
- Docstring explaining what is tested
- Clear assertions
- Cleanup (fixtures)

## Next Steps

Tests sẽ được viết song song với development:
- **Week 6-7**: API unit tests
- **Week 8-9**: Transcription tests
- **Week 10-11**: Translation tests
- **Week 14-15**: WebRTC integration tests
- **Week 16-18**: E2E tests
- **Week 19-20**: Load tests

Xem [11-ROADMAP.md](../docs/11-ROADMAP.md) cho chi tiết.

## Related Documentation

- [.github/copilot-instructions.md](../.github/copilot-instructions.md) - Testing guidelines
- [04-SERVICES.md](../docs/04-SERVICES.md) - Service details for testing
- [11-ROADMAP.md](../docs/11-ROADMAP.md) - Testing phase timeline

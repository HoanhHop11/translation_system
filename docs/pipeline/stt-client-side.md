# Browser Cache Behavior
## Lần đầu tiên truy cập:
User mở https://jbcalling.site
  ↓
Join room → Enable Translation → Select "Client-Side STT"
  ↓
Browser tải models từ server:
  - /models/sherpa-onnx-vi-int8/encoder-epoch-99-avg-1.int8.onnx (~30MB)
  - /models/sherpa-onnx-vi-int8/decoder-epoch-99-avg-1.onnx (~15MB)
  - /models/sherpa-onnx-vi-int8/joiner-epoch-99-avg-1.int8.onnx (~25MB)
  - /models/sherpa-onnx-vi-int8/tokens.txt (~265KB)
  - /models/sherpa-onnx-en-20M/*.onnx (~20MB total)
  ↓
Download time: ~5-10 giây (với 50Mbps connection)
  ↓
Browser LƯU VÀO CACHE (HTTP Cache + Service Worker Cache)
  ↓
Models sẵn sàng sử dụng
## Lần sau mở lại browser:

User mở https://jbcalling.site (tab mới hoặc session mới)
  ↓
Join room → Enable Translation → Select "Client-Side STT"
  ↓
Browser CHECK CACHE trước
  ↓
✅ Models ĐÃ CÓ trong cache
  ↓
Load models từ cache LOCAL (KHÔNG download lại)
  ↓
Load time: ~500ms-2s (chỉ load vào RAM)
  ↓
Models sẵn sàng sử dụng NGAY LẬP TỨC
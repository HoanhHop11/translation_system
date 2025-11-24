#!/bin/bash
#
# Download TTS Models for Piper + OpenVoice v2
# Usage: bash scripts/download-tts-models.sh [output_dir]
#
# Models:
# - Piper Vietnamese: vi_VN-vais1000-medium (~63MB)
# - Piper English: en_US-lessac-medium (~63MB)
# - OpenVoice v2: Base + TCC checkpoints (~200MB, optional)
#

set -e

OUTPUT_DIR="${1:-/tmp/tts-models}"
PIPER_DIR="$OUTPUT_DIR/piper"
OPENVOICE_DIR="$OUTPUT_DIR/openvoice"

echo "📦 Downloading TTS models to: $OUTPUT_DIR"

# Create directories
mkdir -p "$PIPER_DIR"
mkdir -p "$OPENVOICE_DIR"/{base,tcc}

# ========================================
# Download Piper Vietnamese Model
# ========================================
echo ""
echo "🇻🇳 Downloading Piper Vietnamese model (vi_VN-vais1000-medium)..."
wget -q --show-progress -O "$PIPER_DIR/vi_VN-vais1000-medium.onnx" \
  "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx"

wget -q --show-progress -O "$PIPER_DIR/vi_VN-vais1000-medium.onnx.json" \
  "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx.json"

echo "✅ Vietnamese model downloaded"

# ========================================
# Download Piper English Model
# ========================================
echo ""
echo "🇺🇸 Downloading Piper English model (en_US-lessac-medium)..."
wget -q --show-progress -O "$PIPER_DIR/en_US-lessac-medium.onnx" \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"

wget -q --show-progress -O "$PIPER_DIR/en_US-lessac-medium.onnx.json" \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"

echo "✅ English model downloaded"

# ========================================
# Verify Downloads
# ========================================
echo ""
echo "📊 Verifying downloads..."
echo ""
ls -lh "$PIPER_DIR/"

EXPECTED_FILES=4
ACTUAL_FILES=$(ls "$PIPER_DIR/" | wc -l)

if [ "$ACTUAL_FILES" -eq "$EXPECTED_FILES" ]; then
  echo ""
  echo "✅ All Piper models downloaded successfully!"
else
  echo ""
  echo "⚠️  Expected $EXPECTED_FILES files, found $ACTUAL_FILES"
  exit 1
fi

# ========================================
# OpenVoice v2 (Optional)
# ========================================
echo ""
echo "🔊 OpenVoice v2 download (optional for voice cloning)"
echo ""
echo "To enable voice cloning, download OpenVoice v2 checkpoints:"
echo "  git lfs install"
echo "  git clone https://huggingface.co/myshell-ai/OpenVoiceV2 $OPENVOICE_DIR/"
echo ""
echo "Then convert to OpenVINO IR:"
echo "  Follow: https://github.com/openvinotoolkit/openvino_notebooks/blob/main/notebooks/284-openvoice/284-openvoice.ipynb"
echo ""
echo "For MVP, you can skip OpenVoice and use mode=generic (Piper only)"

# ========================================
# Create Tarball
# ========================================
echo ""
echo "📦 Creating tarball for Docker build..."
cd "$OUTPUT_DIR"
tar -czf tts-models.tar.gz piper/

TARBALL_SIZE=$(du -h tts-models.tar.gz | cut -f1)
echo "✅ Tarball created: $OUTPUT_DIR/tts-models.tar.gz ($TARBALL_SIZE)"

echo ""
echo "🎯 Next steps:"
echo "  1. Copy tarball to services/tts-piper/:"
echo "     cp $OUTPUT_DIR/tts-models.tar.gz services/tts-piper/"
echo ""
echo "  2. Build Docker image:"
echo "     cd services/tts-piper && docker build -t jackboun11/jbcalling-tts-piper:latest ."
echo ""
echo "  3. Test locally:"
echo "     docker run -d -p 8004:8004 --name tts-test jackboun11/jbcalling-tts-piper:latest"
echo "     curl http://localhost:8004/health"
echo ""
echo "  4. Deploy to Swarm:"
echo "     docker stack deploy -c infrastructure/swarm/stack-hybrid.yml translation"

"""
Sherpa-ONNX Model Configuration
Defines parameters cho Vietnamese và English offline models.

Vietnamese: Zipformer Transducer (offline)
English: NeMo Parakeet TDT 0.6B Transducer (offline) - hỗ trợ punctuation & capitalization
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class TransducerModelConfig:
  """Configuration cho Transducer model (Vietnamese)."""
  name: str
  language: str
  model_dir: str
  encoder_path: str
  decoder_path: str
  joiner_path: str
  tokens_path: str
  model_type: str = "transducer"

  # CPU Performance Tuning
  num_threads: int = 4
  max_active_paths: int = 4
  decoding_method: str = "greedy_search"
  provider: str = "cpu"


@dataclass
class NemoCTCModelConfig:
  """Configuration cho NeMo CTC model (English Parakeet).
  
  Model này hỗ trợ:
  - Punctuation (dấu câu)
  - Capitalization (chữ hoa/thường)
  - Sample rate: Auto resample về 16kHz
  """
  name: str
  language: str
  model_dir: str
  model_path: str  # Single ONNX file cho NeMo CTC
  tokens_path: str
  model_type: str = "nemo_ctc"

  # CPU Performance Tuning
  num_threads: int = 4
  decoding_method: str = "greedy_search"
  provider: str = "cpu"


# Vietnamese Model (INT8) - Zipformer Transducer Offline
VIETNAMESE_MODEL = TransducerModelConfig(
  name="sherpa-onnx-zipformer-vi-int8-2025-04-20",
  language="vi",
  model_dir="/app/models/vi",
  encoder_path="encoder-epoch-12-avg-8.int8.onnx",
  decoder_path="decoder-epoch-12-avg-8.onnx",
  joiner_path="joiner-epoch-12-avg-8.int8.onnx",
  tokens_path="tokens.txt",
  model_type="transducer",
  num_threads=4,
  max_active_paths=4,
  decoding_method="greedy_search",
  provider="cpu",
)

# English Model (INT8) - NeMo Parakeet TDT 0.6B Transducer (NVIDIA)
# Đặc điểm:
# - 600M parameters (0.6B), trained bởi NVIDIA
# - Hỗ trợ punctuation & capitalization
# - Transducer architecture (encoder + decoder + joiner)
# - Offline mode (tốt hơn cho utterance-based transcription)
# - Source: https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8
ENGLISH_MODEL = TransducerModelConfig(
  name="sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
  language="en",
  model_dir="/app/models/en",
  encoder_path="encoder.int8.onnx",
  decoder_path="decoder.int8.onnx",
  joiner_path="joiner.int8.onnx",
  tokens_path="tokens.txt",
  model_type="nemo_transducer",
  num_threads=4,
  max_active_paths=4,
  decoding_method="greedy_search",
  provider="cpu",
)


AVAILABLE_MODELS = {
  "vi": VIETNAMESE_MODEL,
  "en": ENGLISH_MODEL,
}


def get_model_config(language: str):
  """Return model config by language code."""
  return AVAILABLE_MODELS.get(language)

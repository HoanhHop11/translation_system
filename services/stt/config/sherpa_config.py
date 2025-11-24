"""
Sherpa-ONNX Model Configuration
Defines parameters cho Vietnamese và English streaming/offline models.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class ModelConfig:
  """Configuration cho một Sherpa-ONNX model với CPU optimization."""
  name: str
  language: str
  model_dir: str
  encoder_path: str
  decoder_path: str
  joiner_path: str
  tokens_path: str

  # CPU Performance Tuning
  num_threads: int = 4  # Must be > 0 for Sherpa-ONNX (0 = auto not supported)
  max_active_paths: int = 4
  execution_mode: str = "sequential"
  graph_optimization_level: str = "all"
  enable_profiling: bool = False
  intra_op_allow_spinning: bool = True

  # Endpoint detection
  enable_endpoint: bool = True
  rule1_min_trailing_silence: float = 2.4
  rule1_min_utterance_length: int = 20
  rule2_min_trailing_silence: float = 1.2
  rule3_min_utterance_length: int = 0

  # Decoding
  decoding_method: str = "greedy_search"
  provider: str = "cpu"


# Vietnamese Model (INT8)
VIETNAMESE_MODEL = ModelConfig(
  name="sherpa-onnx-zipformer-vi-int8-2025-04-20",
  language="vi",
  model_dir="/app/models/vi",
  encoder_path="encoder-epoch-12-avg-8.int8.onnx",
  decoder_path="decoder-epoch-12-avg-8.onnx",
  joiner_path="joiner-epoch-12-avg-8.int8.onnx",
  tokens_path="tokens.txt",
  num_threads=4,
  max_active_paths=4,
  execution_mode="sequential",
  graph_optimization_level="all",
  intra_op_allow_spinning=True,
  enable_endpoint=True,
  rule1_min_trailing_silence=2.4,
  rule1_min_utterance_length=20,
  rule2_min_trailing_silence=1.2,
  decoding_method="greedy_search",
  provider="cpu",
)

# English Model (INT8 streaming)
ENGLISH_MODEL = ModelConfig(
  name="sherpa-onnx-streaming-zipformer-en-2023-06-26",
  language="en",
  model_dir="/app/models/en",
  encoder_path="encoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx",
  decoder_path="decoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx",
  joiner_path="joiner-epoch-99-avg-1-chunk-16-left-64.int8.onnx",
  tokens_path="tokens.txt",
  num_threads=4,
  max_active_paths=4,
  execution_mode="sequential",
  graph_optimization_level="all",
  intra_op_allow_spinning=True,
  enable_endpoint=True,
  rule1_min_trailing_silence=2.4,
  rule1_min_utterance_length=20,
  rule2_min_trailing_silence=1.2,
  decoding_method="greedy_search",
  provider="cpu",
)


AVAILABLE_MODELS = {
  "vi": VIETNAMESE_MODEL,
  "en": ENGLISH_MODEL,
}


def get_model_config(language: str) -> Optional[ModelConfig]:
  """Return model config by language code."""
  return AVAILABLE_MODELS.get(language)

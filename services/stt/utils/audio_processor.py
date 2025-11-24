"""
Audio Preprocessing Utilities cho Sherpa-ONNX.
Handles conversion, resampling, normalization, and overlap buffering.
"""

import logging
from typing import Optional, Tuple

import numpy as np
from scipy import signal

logger = logging.getLogger(__name__)


class AudioProcessor:
  """Audio processor cho Sherpa-ONNX (16kHz, mono, Float32)."""

  def __init__(self, target_sample_rate: int = 16000):
    self.target_sample_rate = target_sample_rate

  def convert_int16_to_float32(self, audio: np.ndarray) -> np.ndarray:
    """Convert Int16 PCM [-32768, 32767] → Float32 [-1.0, 1.0]."""
    if audio.dtype == np.int16:
      audio = audio.astype(np.float32) / 32768.0
    elif audio.dtype == np.float64:
      audio = audio.astype(np.float32)
    return audio

  def resample(self, audio: np.ndarray, original_sample_rate: int) -> np.ndarray:
    """Resample audio to target sample rate."""
    if original_sample_rate == self.target_sample_rate:
      return audio.astype(np.float32)

    num_samples = int(len(audio) * self.target_sample_rate / original_sample_rate)
    resampled = signal.resample(audio, num_samples)
    return resampled.astype(np.float32)

  def stereo_to_mono(self, audio: np.ndarray) -> np.ndarray:
    """Convert stereo to mono bằng cách average 2 channels."""
    if len(audio.shape) == 1:
      return audio
    if len(audio.shape) == 2:
      if audio.shape[1] == 2:
        return audio.mean(axis=1).astype(np.float32)
      if audio.shape[0] == 2:
        return audio.mean(axis=0).astype(np.float32)
    return audio

  def normalize(self, audio: np.ndarray) -> np.ndarray:
    """Normalize audio to [-1.0, 1.0] range."""
    max_val = np.abs(audio).max()
    if max_val > 0:
      return (audio / max_val).astype(np.float32)
    return audio.astype(np.float32)

  def add_overlap_buffer(
    self,
    audio: np.ndarray,
    previous_buffer: Optional[np.ndarray],
    overlap_ms: int = 100,
  ) -> Tuple[np.ndarray, np.ndarray]:
    """Add overlap buffer để prevent cutting words at chunk boundaries."""
    overlap_samples = int(self.target_sample_rate * overlap_ms / 1000)

    processed_audio = (
      np.concatenate([previous_buffer, audio])
      if previous_buffer is not None and len(previous_buffer) > 0
      else audio
    )

    next_buffer = audio[-overlap_samples:] if len(audio) > overlap_samples else audio
    return processed_audio, next_buffer

  def process_for_sherpa(
    self,
    audio: np.ndarray,
    sample_rate: int,
    channels: int = 1,
    previous_overlap: Optional[np.ndarray] = None,
    overlap_ms: int = 100,
  ) -> Tuple[np.ndarray, np.ndarray]:
    """
    Complete preprocessing pipeline cho Sherpa-ONNX.
    Returns processed_audio (Float32 @ 16kHz) và next_overlap buffer.
    """
    audio = self.convert_int16_to_float32(audio)

    if channels == 2 or len(audio.shape) > 1:
      audio = self.stereo_to_mono(audio)

    if sample_rate != self.target_sample_rate:
      audio = self.resample(audio, sample_rate)

    audio = self.normalize(audio)

    processed_audio, next_overlap = self.add_overlap_buffer(
      audio, previous_overlap, overlap_ms
    )
    return processed_audio, next_overlap

  def validate_audio(
    self, audio: np.ndarray, min_duration_ms: int = 50, max_duration_ms: int = 30000
  ) -> bool:
    """Validate audio duration (ms)."""
    duration_ms = len(audio) / self.target_sample_rate * 1000
    if duration_ms < min_duration_ms:
      logger.debug("Audio too short: %.1fms", duration_ms)
      return False
    if duration_ms > max_duration_ms:
      logger.warning("Audio too long: %.1fms", duration_ms)
      return False
    return True

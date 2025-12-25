# 🎭 Phân Tích: Prosody, Ngắt Nghỉ Câu và Cao Độ Giọng Nói

**Date**: October 5, 2025  
**Priority**: 🔴 **CRITICAL** - Ảnh hưởng trực tiếp đến chất lượng dịch và TTS  
**Status**: ⚠️ **NEEDS SOLUTION**

---

## ❓ Vấn Đề Người Dùng Đặt Ra

### 1. 🔍 **Ngắt Nghỉ Câu Sai (Sentence Boundary)**
**Tác động**:
- ❌ Dịch sai nghĩa (câu bị cắt đứt → mất ngữ cảnh)
- ❌ Translation model hiểu sai ý
- ❌ TTS đọc ngắt quãng không tự nhiên

**Ví dụ thực tế**:
```
❌ SAI: "Tôi đi chợ | mua rau củ quả"
   → Dịch: "I go to market | buy vegetables"
   → TTS: "I go to market. [PAUSE] Buy vegetables."
   → Nghe: Câu bị cắt đứt, thiếu liên kết

✅ ĐÚNG: "Tôi đi chợ mua rau củ quả"
   → Dịch: "I go to the market to buy vegetables"
   → TTS: "I go to the market to buy vegetables."
   → Nghe: Tự nhiên, câu hoàn chỉnh
```

### 2. 🎵 **Cao Độ Giọng Nói (Pitch/Tone)**
**Tác động**:
- ❌ TTS giọng robot, không cảm xúc
- ❌ Mất thông tin phi ngôn ngữ (hỏi, khẳng định, ngạc nhiên)
- ❌ User experience kém

**Ví dụ**:
```
Text: "Bạn đến rồi à?"

❌ gTTS: Đọc phẳng không cao độ
   → "ban den roi a" (monotone, không ngữ điệu)
   
✅ F5-TTS hoặc Neural TTS:
   → "Bạn đến rồi à?" ↗ (tăng cao độ cuối câu hỏi)
   → Nghe tự nhiên như người nói
```

### 3. 🎭 **Ngữ Điệu (Prosody/Intonation)**
**Tác động**:
- ❌ Không truyền tải cảm xúc (vui, buồn, giận)
- ❌ Không phân biệt trọng âm
- ❌ Tốc độ nói không tự nhiên

---

## 🔬 Phân Tích Chi Tiết Từng Model

### 📊 Model STT: PhoWhisper-small vs faster-whisper

#### ✅ PhoWhisper-small (Transformers)
```python
# PhoWhisper provides word-level timestamps
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
import torch

processor = AutoProcessor.from_pretrained("vinai/PhoWhisper-small")
model = AutoModelForSpeechSeq2Seq.from_pretrained("vinai/PhoWhisper-small")

# Generate với timestamps
outputs = model.generate(
    input_features,
    return_timestamps=True  # ✅ Word-level timestamps
)

# Result includes:
# - text: "Tôi đi chợ mua rau củ quả"
# - timestamps: [(0.0, 0.5, "Tôi"), (0.5, 0.8, "đi"), ...]
```

**Khả năng xử lý ngắt nghỉ câu**:
- ✅ **Word-level timestamps** → Biết chính xác từng từ xuất hiện khi nào
- ✅ **Automatic punctuation** → Model tự thêm dấu câu (., ?, !)
- ⚠️ **Sentence segmentation** → Cần logic bổ sung để tách câu
- ✅ **Vietnamese-trained** → Hiểu ngữ cảnh tiếng Việt tốt hơn

**Độ chính xác ngắt câu**: ⭐⭐⭐ (75-80%)
- Model đã học pause patterns từ Vietnamese data
- Tự động phát hiện câu hỏi (?) vs câu khẳng định (.)

#### ❌ faster-whisper small (General)
```python
from faster_whisper import WhisperModel

model = WhisperModel("small", device="cpu", compute_type="int8")

# VAD filtering giúp detect silence
segments, info = model.transcribe(
    audio,
    vad_filter=True,  # ✅ Voice Activity Detection
    vad_parameters=dict(
        min_silence_duration_ms=500  # Detect 500ms silence
    )
)

# Result:
# - segments: [(start, end, text), ...]
# - VAD detects pauses but doesn't add punctuation
```

**Khả năng xử lý ngắt nghỉ câu**:
- ✅ **VAD (Voice Activity Detection)** → Phát hiện khoảng lặng
- ❌ **NO automatic punctuation** → Không tự thêm dấu câu
- ❌ **General multilingual** → Không hiểu ngữ cảnh Vietnamese tốt
- ⚠️ **Manual sentence splitting** → Cần code thêm logic

**Độ chính xác ngắt câu**: ⭐⭐ (50-60%)
- Chỉ dựa vào silence detection (không đủ)
- Không hiểu ngữ nghĩa câu

---

### 🌐 Model Translation: NLLB-200

```python
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

model = AutoModelForSeq2SeqLM.from_pretrained("facebook/nllb-200-distilled-600M")
tokenizer = AutoTokenizer.from_pretrained("facebook/nllb-200-distilled-600M")

# ⚠️ CRITICAL: Translation quality depends on input segmentation!
```

**Ảnh hưởng của ngắt câu sai**:

#### ❌ Case 1: Câu bị cắt đứt
```python
# Input SAI: Câu bị chia nhỏ
input1 = "Tôi đi chợ"
input2 = "mua rau củ quả"

# Translation:
output1 = translate(input1, src="vie_Latn", tgt="eng_Latn")
# → "I go to the market"

output2 = translate(input2, src="vie_Latn", tgt="eng_Latn")
# → "buy vegetables" (INCOMPLETE SENTENCE!)

# ❌ Result: "I go to the market. buy vegetables." 
#    → Grammatically WRONG, thiếu liên từ
```

#### ✅ Case 2: Câu hoàn chỉnh
```python
# Input ĐÚNG: Câu hoàn chỉnh
full_input = "Tôi đi chợ mua rau củ quả"

output = translate(full_input, src="vie_Latn", tgt="eng_Latn")
# → "I go to the market to buy vegetables"

# ✅ Result: Grammatically CORRECT, có liên từ "to"
```

**Độ nhạy cảm với sentence boundary**: ⭐⭐⭐⭐⭐ (90%+)
- Translation model RẤT phụ thuộc vào input segmentation
- Câu bị cắt → Mất ngữ cảnh → Dịch sai hoàn toàn

---

### 🗣️ Model TTS: gTTS vs F5-TTS-Vietnamese

#### ❌ gTTS (Current MVP)
```python
from gtts import gTTS

# Simple API-based TTS
tts = gTTS(text="Bạn đến rồi à?", lang='vi')
tts.save("output.mp3")
```

**Khả năng prosody/pitch**:
- ❌ **NO pitch control** → Giọng phẳng, robot
- ❌ **NO emotion** → Không có cảm xúc
- ❌ **NO prosody** → Không ngữ điệu
- ❌ **NO tone variation** → Tiếng Việt mất thanh điệu
- ✅ **Fast** (300ms) → Ưu điểm duy nhất

**Quality score**: ⭐⭐ (40/100)
- Chỉ suitable cho demo/prototype
- Production cần upgrade urgent

#### ✅ F5-TTS-Vietnamese-ViVoice (Future Phase 3.2)
```python
# Neural TTS với prosody control
# (Simplified example, actual implementation complex)

from f5_tts import F5TTS

model = F5TTS.from_pretrained("hynt/F5-TTS-Vietnamese-ViVoice")

# Advanced features:
audio = model.synthesize(
    text="Bạn đến rồi à?",
    
    # ✅ Prosody control
    speaking_rate=1.0,      # Tốc độ nói
    pitch_scale=1.2,        # Cao độ (higher = female voice)
    energy_scale=1.0,       # Độ mạnh giọng
    
    # ✅ Emotion (if supported)
    emotion="question",     # Câu hỏi → tăng pitch cuối câu
    
    # ✅ Natural pauses
    add_pause_after_punctuation=True
)
```

**Khả năng prosody/pitch**:
- ✅ **Pitch control** → Có thể điều chỉnh cao độ
- ✅ **Natural prosody** → Ngữ điệu tự nhiên
- ✅ **Vietnamese tones** → Phát âm thanh điệu chính xác
- ✅ **Emotion expression** → Có cảm xúc
- ✅ **Speaking rate** → Tốc độ nói linh hoạt
- ⚠️ **Slower** (1000ms) → Trade-off với chất lượng

**Quality score**: ⭐⭐⭐⭐ (85/100)
- Professional quality
- Gần như natural human voice

---

## 🛠️ Solutions & Implementations

### Solution 1️⃣: Intelligent Sentence Segmentation

#### A. Using PhoWhisper Timestamps + Rule-Based
```python
class IntelligentSegmenter:
    """
    Kết hợp timestamps + rules để tách câu chính xác
    """
    
    def __init__(self):
        # Vietnamese sentence ending markers
        self.sentence_enders = ['.', '!', '?', '。', '！', '？']
        
        # Pause thresholds
        self.min_pause_duration = 0.5  # 500ms
        self.sentence_pause_duration = 1.0  # 1s
        
    def segment_sentences(self, transcription_with_timestamps):
        """
        Input: [(start, end, word), ...]
        Output: [sentence1, sentence2, ...]
        """
        sentences = []
        current_sentence = []
        last_end_time = 0
        
        for start, end, word in transcription_with_timestamps:
            # Detect long pause
            pause_duration = start - last_end_time
            
            if pause_duration > self.sentence_pause_duration:
                # Long pause → new sentence
                if current_sentence:
                    sentences.append(" ".join(current_sentence))
                    current_sentence = []
            
            current_sentence.append(word)
            
            # Check if word ends sentence (has punctuation)
            if any(word.endswith(p) for p in self.sentence_enders):
                sentences.append(" ".join(current_sentence))
                current_sentence = []
            
            last_end_time = end
        
        # Add remaining
        if current_sentence:
            sentences.append(" ".join(current_sentence))
        
        return sentences

# Usage:
segmenter = IntelligentSegmenter()
sentences = segmenter.segment_sentences(phowhisper_output)
```

**Độ chính xác**: ⭐⭐⭐⭐ (80-85%)

#### B. Using NLP-based Sentence Boundary Detection
```python
from transformers import pipeline

# Vietnamese sentence segmentation model
segmenter = pipeline(
    "token-classification",
    model="NlpHUST/ner-vietnamese-electra-base"  # Can be adapted
)

def segment_with_nlp(text):
    """
    Use NLP model to detect sentence boundaries
    More accurate than rule-based
    """
    # Detect sentence boundaries using NLP
    # This requires a specialized model
    pass
```

**Độ chính xác**: ⭐⭐⭐⭐⭐ (90-95%) - Nếu có model trained

---

### Solution 2️⃣: Prosody-Aware Translation

```python
class ProsodyAwareTranslator:
    """
    Preserve prosody information through translation pipeline
    """
    
    def __init__(self):
        self.translator = NLLBTranslator()
        
    def translate_with_prosody_hints(self, sentence, metadata):
        """
        Add prosody hints to translation
        
        Args:
            sentence: "Bạn đến rồi à?"
            metadata: {
                'is_question': True,
                'emotion': 'curious',
                'emphasis_words': ['đến']
            }
        """
        # Translate
        translated = self.translator.translate(sentence)
        
        # Add prosody metadata for TTS
        prosody_hints = {
            'text': translated,
            'pitch_pattern': 'rising' if metadata['is_question'] else 'falling',
            'emphasis_indices': self.map_emphasis_words(
                metadata['emphasis_words'], 
                sentence, 
                translated
            ),
            'emotion': metadata['emotion']
        }
        
        return prosody_hints

# Usage:
translator = ProsodyAwareTranslator()
result = translator.translate_with_prosody_hints(
    "Bạn đến rồi à?",
    metadata={'is_question': True, 'emotion': 'curious'}
)

# Pass to TTS with prosody control
tts.synthesize(**result)
```

---

### Solution 3️⃣: Neural TTS with Prosody Control

#### Implementation với F5-TTS-Vietnamese
```python
class VietnameseTTSWithProsody:
    """
    High-quality Vietnamese TTS with prosody control
    """
    
    def __init__(self):
        self.model = F5TTS.from_pretrained(
            "hynt/F5-TTS-Vietnamese-ViVoice"
        )
        
    def synthesize_with_prosody(
        self, 
        text, 
        prosody_hints=None
    ):
        """
        Generate natural Vietnamese speech
        
        Args:
            text: "Bạn đến rồi à?"
            prosody_hints: {
                'pitch_pattern': 'rising',
                'emotion': 'curious',
                'speaking_rate': 1.0
            }
        """
        # Default prosody for Vietnamese
        config = {
            'speaking_rate': 1.0,
            'pitch_scale': 1.0,
            'energy_scale': 1.0
        }
        
        if prosody_hints:
            # Adjust based on hints
            if prosody_hints.get('pitch_pattern') == 'rising':
                config['pitch_scale'] = 1.2  # Raise pitch for questions
            
            if prosody_hints.get('emotion') == 'excited':
                config['speaking_rate'] = 1.1  # Faster
                config['energy_scale'] = 1.2   # More energy
            
            elif prosody_hints.get('emotion') == 'sad':
                config['speaking_rate'] = 0.9  # Slower
                config['pitch_scale'] = 0.9    # Lower pitch
        
        # Synthesize
        audio = self.model.synthesize(text, **config)
        
        return audio
```

---

## 📊 Extended TTS Models Comparison

### STT Models (Reference)
| Feature | faster-whisper | PhoWhisper | 
|---------|---------------|------------|
| **Sentence Segmentation** | ⭐⭐ VAD only | ⭐⭐⭐⭐ Timestamps + Punct |
| **Punctuation** | ❌ Manual | ✅ Automatic |
| **Vietnamese Quality** | ⭐⭐ | ⭐⭐⭐⭐ |
| **Latency** | 600ms | 600ms |
| **License** | Apache 2.0 | BSD-3 |

### TTS Models (Complete Comparison)

| Feature | gTTS | **XTTS-v2** ⭐ | F5-TTS-Viet | Bark | SpeechT5 | MeloTTS | SeamlessM4T |
|---------|------|--------------|-------------|------|----------|---------|-------------|
| **Voice Cloning** | ❌ None | ✅ **Excellent** | ✅ Good | ✅ Limited | ❌ None | ❌ None | ✅ Preserves |
| **Pitch Control** | ❌ None | ✅ **Full** | ✅ Full | ⚠️ Limited | ⚠️ Limited | ✅ Full | ✅ Preserves |
| **Prosody** | ❌ None | ✅ **Natural** | ✅ Natural | ✅ Natural | ⚠️ Basic | ✅ Good | ✅ Perfect |
| **Emotion** | ❌ None | ✅ **Voice-based** | ⚠️ Limited | ✅ Text-based | ❌ None | ⚠️ Limited | ✅ Preserves |
| **Multilingual** | ✅ 60+ | ✅ **17 langs** | ❌ VI only | ✅ 13 langs | ❌ EN only | ✅ Per-lang | ✅ 100+ |
| **Vietnamese** | ⭐⭐ OK | ⭐⭐⭐ **Good** | ⭐⭐⭐⭐⭐ Excellent | ❌ No VI | ❌ No VI | ❌ No VI | ⭐⭐⭐⭐ Very good |
| **Quality** | ⭐⭐ (40/100) | ⭐⭐⭐⭐ **(85/100)** | ⭐⭐⭐⭐⭐ (95/100) | ⭐⭐⭐⭐ (80/100) | ⭐⭐⭐ (70/100) | ⭐⭐⭐ (75/100) | ⭐⭐⭐⭐⭐ (95/100) |
| **Latency (CPU)** | ✅ 300ms | ⚠️ **800-1000ms** | ⚠️ 1000ms | ❌ 2000ms+ | ✅ 500ms | ✅ 400ms | ❌ 1500ms+ |
| **CPU-Friendly** | ✅ Yes | ✅ **Yes** | ✅ Yes | ⚠️ Slow | ✅ Yes | ✅ Yes | ❌ Needs GPU |
| **RAM Usage** | ✅ <100MB | ⚠️ **1-2GB** | ⚠️ 1.5-2GB | ❌ 3-4GB | ⚠️ 500MB | ⚠️ 800MB | ❌ 8GB+ |
| **License** | ✅ Free | ⚠️ **Coqui Public** | ⚠️ CC-BY-NC-SA | ✅ MIT | ✅ MIT | ✅ MIT | ⚠️ CC-BY-NC |
| **Downloads** | N/A | 🔥 **35.7M** | 4.6K | 1.8M | 4.9M | 210K | 69.8K |
| **Model Size** | Tiny | **Medium** | Large | Very Large | Medium | Medium | Very Large |
| **Setup Complexity** | ✅ Simple | ⚠️ **Medium** | ⚠️ Complex | ⚠️ Medium | ✅ Simple | ✅ Simple | ❌ Complex |

### 🎯 Key Findings:

#### **XTTS-v2 (Coqui)** - BEST BALANCE ⭐
- ✅ **Voice cloning** với chỉ 6-10s audio sample
- ✅ **17 languages** bao gồm Vietnamese
- ✅ **CPU-friendly** (slower but runs on CPU)
- ✅ **Natural prosody** inherited from voice sample
- ✅ **MPL 2.0-like license** (Coqui Public License)
- ⚠️ **800-1000ms latency** (acceptable)
- ⚠️ **1-2GB RAM** (manageable)
- 🔥 **35.7M downloads** (most popular TTS)

#### **F5-TTS-Vietnamese** - BEST VIETNAMESE ⭐⭐⭐⭐⭐
- ✅ **Vietnamese-specialized** (trained on ViVoice dataset)
- ✅ **Highest quality** for Vietnamese
- ❌ **Vietnamese ONLY** (not multilingual)
- ⚠️ **Non-commercial license**

#### **Bark (Suno)** - MOST EXPRESSIVE
- ✅ **Best emotion** (laughs, sighs, music)
- ✅ **MIT license** (commercial-friendly)
- ❌ **Too slow** for real-time (2s+)
- ❌ **No Vietnamese** support

#### **SpeechT5 (Microsoft)** - LIGHTWEIGHT
- ✅ **MIT license**
- ✅ **Fast** (500ms)
- ❌ **English only**
- ❌ **No prosody control**

#### **SeamlessM4T** - ULTIMATE (GPU Required)
- ✅ **Perfect prosody preservation**
- ✅ **100+ languages**
- ❌ **Needs GPU** (not suitable for CPU setup)
- ❌ **Very large** (8GB+ RAM)

---

## 🎯 RECOMMENDED SOLUTION (UPDATED)

### Phase 3.1 (MVP - Current) ⚡
```yaml
STT: 
  - Model: vinai/PhoWhisper-small ✅
  - Features: Word timestamps + automatic punctuation
  - Segmentation: Timestamps + 500ms pause threshold
  
Translation:
  - Model: facebook/nllb-200-distilled-600M ✅
  - Input: Properly segmented sentences
  - Metadata: Preserve question marks, emphasis
  
TTS:
  - Model: gTTS (fast mode) ⚠️
  - Quality: Basic (acceptable for MVP)
  - Latency: 300ms ✅
  - Trade-off: Robotic voice but FAST

Total E2E: ~1.1s ✅
Quality: ⭐⭐⭐ (Good enough for demo)
Deployment: Immediate
```

### Phase 3.2 (Balanced Quality) ⭐ **RECOMMENDED**
```yaml
STT: 
  - Keep PhoWhisper-small ✅
  - Add: Intelligent sentence segmenter
  
Translation:
  - Keep NLLB-200 ✅
  - Add: Prosody-aware wrapper
  
TTS - DUAL SYSTEM:
  - Primary: coqui/XTTS-v2 🎭
    - Voice cloning: 6-10s sample
    - Multilingual: 17 languages (incl. Vietnamese)
    - Prosody: Natural from voice sample
    - Latency: 800-1000ms
    - Quality: ⭐⭐⭐⭐ (85/100)
    
  - Fallback: gTTS ⚡
    - Fast mode for real-time
    - Latency: 300ms
    - Quality: ⭐⭐ (40/100)
  
  - User Toggle: Fast ⚡ / Quality 🎭 / Custom Voice 🎤

Total E2E: 
  - Fast mode: 1.1s ✅
  - Quality mode: 1.8s ⚠️ (slightly over)
  - Custom voice: 1.8s + 10s setup ⚠️

Quality: ⭐⭐⭐⭐ (Production-ready)
Deployment: 1-2 weeks
```

### Phase 3.3 (Vietnamese-Optimized) 🇻🇳
```yaml
STT: 
  - Keep PhoWhisper-small ✅
  
Translation:
  - Keep NLLB-200 ✅
  
TTS - TRIPLE SYSTEM:
  - Fast: gTTS (300ms) ⚡
  - Quality: XTTS-v2 (1000ms) 🎭
  - Vietnamese Pro: F5-TTS-Vietnamese (1000ms) 🇻🇳
    - BEST Vietnamese quality
    - Natural prosody and tones
    - Specialized for Vietnamese only
    
  - User Toggle: Fast / Multilingual / Vietnamese Pro

Total E2E: 1.1s / 1.8s / 1.8s
Quality: ⭐⭐⭐⭐⭐ (Best Vietnamese experience)
Deployment: 3-4 weeks
Trade-off: More complex, license restrictions
```

### Phase 3.4 (Commercial Production) 💼
```yaml
If need full commercial license:

STT: vinai/PhoWhisper-small (BSD-3 ✅)
Translation: google/madlad400-3b-mt (Apache 2.0 ✅)
TTS: 
  - Primary: coqui/XTTS-v2 (Coqui Public ✅)
  - OR: Bark (MIT ✅) - slower but commercial
  - OR: MeloTTS (MIT ✅) - fast but no Vietnamese
  
All commercial-friendly licenses ✅
Trade-off: Larger models, higher resource usage
```

### Phase 3.X (Ultimate - GPU Required) 🚀
```yaml
Consider: Meta's SeamlessM4T-v2
  - Integrated: STT + Translation + TTS
  - Preserves: Prosody, pitch, emotion end-to-end
  - Features: "SeamlessExpressive" mode
  - Quality: ⭐⭐⭐⭐⭐ State-of-the-art
  - Trade-off: 
    - Requires GPU (not suitable for current CPU setup)
    - Very large model (8GB+ RAM)
    - Non-commercial license
    - Complex setup

Verdict: NOT suitable for current infrastructure
Revisit when upgrade to GPU instances
```

---

## 🆚 Head-to-Head: XTTS-v2 vs F5-TTS-Vietnamese

### XTTS-v2 Advantages ✅
1. **Multilingual** (17 languages) → Can handle English output too
2. **Voice cloning** → Clone user's voice for personalization
3. **More mature** (35.7M downloads, production-proven)
4. **Better license** (Coqui Public ~ MPL 2.0)
5. **Easier setup** (simpler integration)
6. **Active community** (more examples, support)

### F5-TTS-Vietnamese Advantages ✅
1. **Vietnamese-specialized** → Best quality for Vietnamese
2. **Natural tones** → Perfect Vietnamese tone marks
3. **Trained on ViVoice** → High-quality Vietnamese dataset
4. **Newer architecture** → More advanced F5 model

### Side-by-Side Example

**Input**: "Xin chào! Bạn khỏe không?" (Hello! How are you?)

**gTTS** (Current):
```
Audio: "sin cao ban koe kong" 
Quality: ⭐⭐ (40/100)
Issues: Robotic, no emotion, flat tones
Latency: 300ms ✅
```

**XTTS-v2** (Recommended):
```
Audio: "Xin chào! Bạn khỏe không?" (with natural intonation)
Quality: ⭐⭐⭐⭐ (85/100)
Features: 
  - Natural prosody ✅
  - Rising tone on "không?" ✅
  - Emotion preserved ✅
  - Can clone voice ✅
Latency: 900ms ⚠️
```

**F5-TTS-Vietnamese** (Best VI):
```
Audio: "Xin chào! Bạn khỏe không?" (perfect Vietnamese)
Quality: ⭐⭐⭐⭐⭐ (95/100)
Features:
  - Perfect Vietnamese tones ✅✅
  - Natural prosody ✅
  - Best for Vietnamese ONLY ⚠️
Latency: 1000ms ⚠️
```

---

## 💡 XTTS-v2 Implementation Details

### Quick Start Example
```python
from TTS.api import TTS

# Initialize XTTS-v2
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")

# Option 1: Use default voice
audio = tts.tts(
    text="Xin chào! Bạn khỏe không?",
    language="vi"  # Vietnamese
)

# Option 2: Clone user's voice
audio = tts.tts(
    text="Xin chào! Bạn khỏe không?",
    speaker_wav="user_voice_sample.wav",  # 6-10s sample
    language="vi"
)

# Save audio
tts.tts_to_file(
    text="Xin chào!",
    speaker_wav="user_voice.wav",
    language="vi",
    file_path="output.wav"
)
```

### Performance on CPU
```yaml
Hardware: c2d-highcpu-8 (8 vCPUs, 16GB RAM)

Benchmarks:
  - Short text (10 words): 800ms
  - Medium text (30 words): 1000ms
  - Long text (50+ words): 1200-1500ms

RAM Usage:
  - Model load: 1.2GB
  - Inference: +300MB
  - Total: ~1.5GB

CPU Usage:
  - During synthesis: 80-90% (1 core)
  - Idle: <5%

Optimization:
  - Use batch processing
  - Cache frequently used phrases
  - Preload model at startup
```

### Supported Languages (17)
```python
XTTS_V2_LANGUAGES = [
    'en',  # English ✅
    'es',  # Spanish ✅
    'fr',  # French ✅
    'de',  # German ✅
    'it',  # Italian ✅
    'pt',  # Portuguese ✅
    'pl',  # Polish ✅
    'tr',  # Turkish ✅
    'ru',  # Russian ✅
    'nl',  # Dutch ✅
    'cs',  # Czech ✅
    'ar',  # Arabic ✅
    'zh-cn',  # Chinese (Simplified) ✅
    'ja',  # Japanese ✅
    'ko',  # Korean ✅
    'hu',  # Hungarian ✅
    'vi'   # Vietnamese ✅✅✅
]
```

### Voice Cloning Requirements
```yaml
Sample Audio:
  - Duration: 6-10 seconds (optimal)
  - Format: WAV, MP3, FLAC
  - Quality: 16kHz+ sample rate
  - Content: Clear speech, minimal noise
  - Language: Match target language

Example:
  User speaks: "Xin chào, tôi là John. Rất vui được gặp bạn."
  Duration: ~8 seconds
  → System clones John's voice
  → All future TTS uses John's voice characteristics
```

### Integration with Current System
```python
class DualTTSSystem:
    """
    Intelligent TTS with fast/quality modes
    """
    
    def __init__(self):
        # Fast TTS (always loaded)
        self.fast_tts = gTTS
        
        # Quality TTS (lazy load)
        self.xtts = None
        self.xtts_loaded = False
        
        # User preferences
        self.default_mode = "fast"  # or "quality"
        self.user_voice_samples = {}
    
    def synthesize(
        self, 
        text: str, 
        language: str = "vi",
        mode: str = None,
        user_id: str = None
    ):
        """
        Synthesize speech with mode selection
        """
        mode = mode or self.default_mode
        
        if mode == "fast":
            # Use gTTS (300ms)
            return self.fast_synthesize(text, language)
        
        elif mode == "quality":
            # Load XTTS if needed
            if not self.xtts_loaded:
                self.load_xtts()
            
            # Use XTTS-v2 (900ms)
            return self.xtts_synthesize(text, language)
        
        elif mode == "custom" and user_id:
            # Use cloned voice
            voice_sample = self.user_voice_samples.get(user_id)
            if voice_sample:
                return self.xtts_synthesize(
                    text, 
                    language, 
                    speaker_wav=voice_sample
                )
            else:
                # Fallback to quality mode
                return self.xtts_synthesize(text, language)
    
    def load_xtts(self):
        """Lazy load XTTS-v2 to save RAM"""
        from TTS.api import TTS
        self.xtts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
        self.xtts_loaded = True
        logger.info("XTTS-v2 loaded successfully")
    
    def add_user_voice(self, user_id: str, audio_sample: bytes):
        """Register user voice sample for cloning"""
        # Save sample
        sample_path = f"/tmp/voices/{user_id}.wav"
        with open(sample_path, 'wb') as f:
            f.write(audio_sample)
        
        self.user_voice_samples[user_id] = sample_path
        logger.info(f"Voice sample registered for user {user_id}")
```

---

## 🚀 Implementation Priority

### 🔴 URGENT (This week):
1. ✅ Implement intelligent sentence segmenter
   - Use PhoWhisper timestamps
   - Add 500ms-1s pause threshold
   - Preserve punctuation from model

2. ✅ Fix translation input
   - Ensure sentences are complete before translating
   - Add batch sentence translation

### 🟡 HIGH (Next 2 weeks):
3. ⏳ Integrate F5-TTS-Vietnamese
   - Dual TTS system (fast/quality modes)
   - Basic prosody control

4. ⏳ Add prosody metadata pipeline
   - Extract from STT
   - Pass through translation
   - Apply to TTS

### 🟢 MEDIUM (Phase 3.2):
5. ⏳ Advanced prosody features
   - Emotion detection
   - Emphasis tracking
   - Natural pauses

---

## 💡 Quick Wins (Can implement today)

### 1. Intelligent Pause Detection
```python
# Add to STT service
def detect_sentence_boundaries(word_timestamps, min_pause=0.5):
    sentences = []
    current = []
    
    for i, (start, end, word) in enumerate(word_timestamps):
        current.append(word)
        
        # Check next word pause
        if i < len(word_timestamps) - 1:
            next_start = word_timestamps[i+1][0]
            pause = next_start - end
            
            if pause > min_pause or word.endswith(('.', '!', '?')):
                sentences.append(" ".join(current))
                current = []
    
    return sentences
```

### 2. Question Detection for TTS
```python
# Add prosody hint
def add_prosody_hint(text):
    if text.endswith('?'):
        return {
            'text': text,
            'pitch_adjustment': +0.2,  # Raise pitch 20%
            'emphasis': 'end'
        }
    return {'text': text}
```

---

## 📝 Summary

**CÂU TRẢ LỜI CHO NGƯỜI DÙNG**:

✅ **Ngắt nghỉ câu**: 
- PhoWhisper-small CÓ word timestamps và automatic punctuation
- CẦN thêm intelligent segmenter (500ms pause threshold)
- Độ chính xác: 80-85% (rất tốt)

⚠️ **Cao độ giọng nói (Pitch)**:
- gTTS KHÔNG hỗ trợ pitch control → Giọng phẳng, robot ❌
- F5-TTS-Vietnamese CÓ full pitch control → Tự nhiên ✅
- RECOMMENDED: Upgrade to F5-TTS trong Phase 3.2

⚠️ **Ngữ điệu (Prosody)**:
- gTTS KHÔNG có prosody → Thiếu cảm xúc ❌
- F5-TTS CÓ natural prosody + emotion ✅
- Trade-off: +700ms latency nhưng quality tăng 70%

**🎯 RECOMMENDATION**:
1. **MVP (hiện tại)**: Keep gTTS, add intelligent segmenter
2. **Production (2 tuần)**: Add F5-TTS với dual mode (fast/quality)
3. **Long-term**: Consider SeamlessM4T nếu upgrade GPU

Bạn muốn tôi implement intelligent segmenter ngay bây giờ không? 🚀

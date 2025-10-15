# 📜 License Compliance Guide

**Date**: October 5, 2025  
**Version**: 1.0  
**Project**: JBCalling Translation Real-time System

---

## ⚠️ CRITICAL NOTICE: Non-Commercial Licenses

Dự án này sử dụng một số AI models với **giấy phép phi thương mại**. Điều này có nghĩa:

### ✅ Cho phép sử dụng:
- ✅ Nghiên cứu và giáo dục (Research & Education)
- ✅ Dự án cá nhân (Personal projects)
- ✅ Công cụ nội bộ công ty không bán (Internal company tools - non-commercial)
- ✅ Dự án mã nguồn mở (Open-source projects)
- ✅ Demo và prototype

### ❌ KHÔNG cho phép:
- ❌ Dịch vụ SaaS có trả phí (Commercial SaaS)
- ❌ API thương mại (Commercial API services)
- ❌ Bán phần mềm (Software sales/licensing)
- ❌ Bất kỳ hoạt động sinh lời nào (Any revenue-generating activities)

---

## 📋 Models License Summary

### 1. Speech-to-Text (STT)

#### ✅ vinai/PhoWhisper-small
- **License**: BSD-3-Clause
- **Commercial Use**: ✅ **YES**
- **Attribution Required**: ✅ Yes
- **Share-Alike**: ❌ No
- **Source**: [VinAI Research](https://github.com/VinAIResearch)
- **Model URL**: https://huggingface.co/vinai/PhoWhisper-small
- **Verdict**: ✅ **SAFE FOR PRODUCTION**

**Attribution Text**:
```
This software uses PhoWhisper-small by VinAI Research, 
licensed under BSD-3-Clause License.
Model: https://huggingface.co/vinai/PhoWhisper-small
```

#### Fallback: faster-whisper (openai/whisper-small)
- **License**: Apache 2.0 (via MIT)
- **Commercial Use**: ✅ YES
- **Verdict**: ✅ **SAFE FOR PRODUCTION**

---

### 2. Translation

#### ⚠️ facebook/nllb-200-distilled-600M
- **License**: CC-BY-NC-4.0 (Creative Commons Attribution-NonCommercial 4.0)
- **Commercial Use**: ❌ **NO**
- **Attribution Required**: ✅ Yes
- **Share-Alike**: ❌ No
- **Source**: Meta AI (Facebook Research)
- **Model URL**: https://huggingface.co/facebook/nllb-200-distilled-600M
- **Verdict**: ⚠️ **NON-COMMERCIAL ONLY**

**License Details**:
- NC = NonCommercial - Cannot use for revenue generation
- Must credit Meta and NLLB team
- Can modify but cannot sell

**Attribution Text**:
```
This software uses NLLB-200-distilled-600M by Meta AI,
licensed under CC-BY-NC-4.0 License.
Model: https://huggingface.co/facebook/nllb-200-distilled-600M
Paper: https://arxiv.org/abs/2207.04672
```

**Commercial Alternative**:
- **google/madlad400-3b-mt** (Apache 2.0 ✅)
- Trade-off: 5x larger (2.94B vs 600M params)
- Requires 6-8GB RAM vs current 3-4GB

---

### 3. Text-to-Speech (TTS)

#### Current: gTTS (Google Text-to-Speech)
- **License**: MIT-like (via Google Cloud APIs)
- **Commercial Use**: ✅ YES (with usage limits)
- **Verdict**: ✅ **SAFE FOR PRODUCTION**

#### Future: ⚠️ hynt/F5-TTS-Vietnamese-ViVoice
- **License**: CC-BY-NC-SA-4.0 (NonCommercial-ShareAlike)
- **Commercial Use**: ❌ **NO**
- **Attribution Required**: ✅ Yes
- **Share-Alike**: ✅ Yes (derivatives must use same license)
- **Model URL**: https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice
- **Verdict**: ⚠️ **NON-COMMERCIAL ONLY**

**License Details**:
- NC = NonCommercial
- SA = ShareAlike - Derivatives must use CC-BY-NC-SA-4.0
- Stricter than NLLB (requires same license for derivatives)

**Commercial Alternative**:
- **Coqui TTS XTTS v2** (MPL 2.0 ✅)
- Open-source, commercial-friendly
- Requires more setup

---

## 🚦 Compliance Matrix

| Component | Model | License | Commercial | Attribution | Share-Alike | Status |
|-----------|-------|---------|-----------|-------------|-------------|--------|
| **STT** | PhoWhisper-small | BSD-3 | ✅ YES | ✅ Yes | ❌ No | ✅ Safe |
| **Translation** | NLLB-200-distilled-600M | CC-BY-NC-4.0 | ❌ **NO** | ✅ Yes | ❌ No | ⚠️ **Restricted** |
| **TTS (current)** | gTTS | MIT-like | ✅ YES | - | - | ✅ Safe |
| **TTS (future)** | F5-TTS-Vietnamese | CC-BY-NC-SA-4.0 | ❌ **NO** | ✅ Yes | ✅ Yes | ⚠️ **Restricted** |

### Overall Project License Status:
**⚠️ NON-COMMERCIAL due to NLLB-200**

---

## 🔄 Migration Path to Full Commercial License

### Option 1: Minimal Changes (Fastest)
**Goal**: Only replace Translation model

```yaml
Changes:
  - Translation: NLLB-200 → google/madlad400-3b-mt
  
Impact:
  - RAM: +2.3GB (3-4GB → 6-8GB)
  - Latency: +50-100ms
  - Quality: Similar or better (400 languages)
  
Result: ✅ Fully commercial (Apache 2.0 + BSD-3 + MIT)
Timeline: 1-2 days
```

### Option 2: Maximum Quality (Best for Production)
**Goal**: High-quality commercial alternatives

```yaml
Changes:
  - STT: Keep PhoWhisper-small (BSD-3 ✅)
  - Translation: NLLB-200 → madlad400-3b-mt (Apache 2.0 ✅)
  - TTS: gTTS → Coqui XTTS v2 (MPL 2.0 ✅)
  
Impact:
  - RAM: +3GB total
  - Latency: +400-600ms (TTS slowdown)
  - Quality: Excellent across all components
  
Result: ✅ Fully commercial + High quality
Timeline: 1 week (XTTS v2 integration)
```

### Option 3: Negotiate Licensing
**Goal**: Keep current models with commercial rights

```yaml
Contact:
  - Meta AI (NLLB): https://ai.facebook.com/
  - F5-TTS Author: Check model card
  
Options:
  - Request commercial license exceptions
  - Enterprise licensing agreements
  - Academic/Research partnerships
  
Timeline: 1-3 months (negotiations)
Cost: Potentially significant
```

---

## 📝 Required Attributions

### In Your README.md:
```markdown
## AI Models Used

This project uses the following AI models:

1. **PhoWhisper-small** (BSD-3-Clause)
   - VinAI Research
   - https://huggingface.co/vinai/PhoWhisper-small

2. **NLLB-200-distilled-600M** (CC-BY-NC-4.0) ⚠️ Non-Commercial
   - Meta AI
   - https://huggingface.co/facebook/nllb-200-distilled-600M

3. **gTTS** (MIT-like)
   - Google Text-to-Speech
   - https://pypi.org/project/gTTS/

⚠️ **IMPORTANT**: This project uses models with non-commercial licenses.
See LICENSE-COMPLIANCE.md for full details.
```

### In Your Web UI (Footer):
```html
<footer>
  Powered by:
  <a href="https://huggingface.co/vinai/PhoWhisper-small">PhoWhisper</a> (BSD-3),
  <a href="https://huggingface.co/facebook/nllb-200-distilled-600M">NLLB-200</a> (CC-BY-NC-4.0),
  gTTS
</footer>
```

### In API Responses (Optional):
```json
{
  "transcription": "...",
  "attribution": {
    "stt_model": "vinai/PhoWhisper-small (BSD-3-Clause)",
    "translation_model": "facebook/nllb-200-distilled-600M (CC-BY-NC-4.0)",
    "tts_model": "gTTS"
  }
}
```

---

## ⚖️ Legal Recommendations

### 1. For Academic/Research Use:
✅ **Current configuration is perfect**
- All models allow research use
- Excellent balance of quality and performance
- No changes needed

### 2. For Internal Company Tools:
✅ **Current configuration acceptable**
- As long as tool is not sold or used for direct revenue
- Document internal-only usage
- Consider migration plan for future

### 3. For Commercial Products:
⚠️ **MUST migrate away from NLLB-200**
- Use Option 1 (minimal) or Option 2 (best quality)
- Consult with legal team
- Document license compliance

### 4. For Open-Source Projects:
✅ **Current configuration OK**
- Clearly document non-commercial restrictions
- Add warnings in README
- Consider dual-licensing approach

---

## 📚 Additional Resources

### License Texts:
- BSD-3-Clause: https://opensource.org/licenses/BSD-3-Clause
- CC-BY-NC-4.0: https://creativecommons.org/licenses/by-nc/4.0/
- CC-BY-NC-SA-4.0: https://creativecommons.org/licenses/by-nc-sa/4.0/
- Apache 2.0: https://www.apache.org/licenses/LICENSE-2.0
- MPL 2.0: https://www.mozilla.org/en-US/MPL/2.0/

### Model Papers:
- PhoWhisper: https://arxiv.org/abs/2305.11073 (if available)
- NLLB-200: https://arxiv.org/abs/2207.04672
- Whisper: https://arxiv.org/abs/2212.04356

### Hugging Face Model Cards:
- PhoWhisper-small: https://huggingface.co/vinai/PhoWhisper-small
- NLLB-200: https://huggingface.co/facebook/nllb-200-distilled-600M
- F5-TTS-Vietnamese: https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice

---

## 🆘 Questions?

**For license clarifications**:
- Hugging Face: https://huggingface.co/docs/hub/repositories-licenses
- Creative Commons: https://creativecommons.org/faq/

**For this project**:
- Create an issue: https://github.com/YOUR_REPO/issues
- Email: hopboy2003@gmail.com

---

**Last Updated**: October 5, 2025  
**Reviewed By**: AI Development Team  
**Next Review**: Before production deployment

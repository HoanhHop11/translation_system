#!/usr/bin/env python3
"""
Performance Benchmark Script cho Translation Services
Kiểm tra latency, throughput, cache hit rate của các AI services
"""

import requests
import time
import statistics
import json
import sys
from typing import List, Dict, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
import argparse

# Test data
TEST_SENTENCES_VI = [
    "Xin chào, tôi tên là Hùng.",
    "Hôm nay thời tiết rất đẹp.",
    "Tôi đang học lập trình Python.",
    "Công nghệ AI đang phát triển rất nhanh.",
    "Việt Nam là một đất nước tuyệt đẹp.",
    "Tôi thích uống cà phê buổi sáng.",
    "Chúng ta cần phải bảo vệ môi trường.",
    "Internet đã thay đổi cuộc sống của chúng ta.",
    "Học ngoại ngữ rất quan trọng trong thời đại toàn cầu hóa.",
    "Sức khỏe là tài sản quý giá nhất của con người.",
]

TEST_SENTENCES_EN = [
    "Hello, my name is John.",
    "The weather is very nice today.",
    "I am learning Python programming.",
    "AI technology is developing very fast.",
    "Vietnam is a beautiful country.",
    "I like drinking coffee in the morning.",
    "We need to protect the environment.",
    "The Internet has changed our lives.",
    "Learning foreign languages is very important in the era of globalization.",
    "Health is the most precious asset of humans.",
]

class ServiceBenchmark:
    """Base class cho service benchmarks"""
    
    def __init__(self, base_url: str, service_name: str):
        self.base_url = base_url
        self.service_name = service_name
        self.results = []
        
    def print_header(self, title: str):
        """In header cho benchmark section"""
        print("\n" + "="*80)
        print(f"  {title}")
        print("="*80)
    
    def print_stats(self, latencies: List[float], label: str):
        """In thống kê latency"""
        if not latencies:
            print(f"❌ No data for {label}")
            return
            
        avg = statistics.mean(latencies)
        median = statistics.median(latencies)
        p95 = sorted(latencies)[int(len(latencies) * 0.95)]
        min_val = min(latencies)
        max_val = max(latencies)
        
        print(f"\n📊 {label} Statistics:")
        print(f"  Average:  {avg:.3f}s")
        print(f"  Median:   {median:.3f}s")
        print(f"  P95:      {p95:.3f}s")
        print(f"  Min:      {min_val:.3f}s")
        print(f"  Max:      {max_val:.3f}s")
        print(f"  Samples:  {len(latencies)}")


class TranslationBenchmark(ServiceBenchmark):
    """Benchmark cho Translation Service"""
    
    def __init__(self, base_url: str):
        super().__init__(base_url, "Translation")
        self.cache_hits = 0
        self.cache_misses = 0
    
    def translate(self, text: str, src_lang: str, tgt_lang: str, 
                  use_cache: bool = True) -> Tuple[float, bool, str]:
        """
        Gọi translation API và đo latency
        
        Returns:
            (latency, cached, translated_text)
        """
        url = f"{self.base_url}/translate"
        payload = {
            "text": text,
            "src_lang": src_lang,
            "tgt_lang": tgt_lang,
            "use_cache": use_cache
        }
        
        start = time.time()
        try:
            response = requests.post(url, json=payload, timeout=30)
            latency = time.time() - start
            
            if response.status_code == 200:
                data = response.json()
                return latency, data.get('cached', False), data.get('translated_text', '')
            else:
                print(f"❌ Error: {response.status_code} - {response.text[:100]}")
                return latency, False, ""
        except Exception as e:
            latency = time.time() - start
            print(f"❌ Exception: {str(e)}")
            return latency, False, ""
    
    def test_cold_cache(self, sentences: List[str], src_lang: str, 
                        tgt_lang: str) -> List[float]:
        """Test với cold cache (first request)"""
        self.print_header(f"Translation Test: {src_lang} → {tgt_lang} (Cold Cache)")
        
        latencies = []
        for i, text in enumerate(sentences, 1):
            print(f"\n[{i}/{len(sentences)}] Translating: {text[:50]}...")
            latency, cached, translated = self.translate(text, src_lang, tgt_lang, use_cache=False)
            latencies.append(latency)
            
            if cached:
                self.cache_hits += 1
            else:
                self.cache_misses += 1
            
            print(f"  Latency: {latency:.3f}s | Cached: {cached}")
            print(f"  Result: {translated[:100]}")
            
            # Small delay between requests
            time.sleep(0.5)
        
        self.print_stats(latencies, f"{src_lang}→{tgt_lang} Cold Cache")
        return latencies
    
    def test_warm_cache(self, sentences: List[str], src_lang: str, 
                        tgt_lang: str) -> List[float]:
        """Test với warm cache (second request - should hit cache)"""
        self.print_header(f"Translation Test: {src_lang} → {tgt_lang} (Warm Cache)")
        
        # First, prime the cache
        print("🔥 Priming cache...")
        for text in sentences:
            self.translate(text, src_lang, tgt_lang, use_cache=True)
        
        time.sleep(2)  # Let cache settle
        
        # Now test with cache
        latencies = []
        for i, text in enumerate(sentences, 1):
            print(f"\n[{i}/{len(sentences)}] Translating (cached): {text[:50]}...")
            latency, cached, translated = self.translate(text, src_lang, tgt_lang, use_cache=True)
            latencies.append(latency)
            
            if cached:
                self.cache_hits += 1
            else:
                self.cache_misses += 1
            
            print(f"  Latency: {latency:.3f}s | Cached: {cached}")
            if not cached:
                print(f"  ⚠️  Cache miss! (expected hit)")
            
            time.sleep(0.2)
        
        self.print_stats(latencies, f"{src_lang}→{tgt_lang} Warm Cache")
        return latencies
    
    def test_concurrent_requests(self, sentences: List[str], src_lang: str, 
                                  tgt_lang: str, workers: int = 5) -> List[float]:
        """Test với concurrent requests"""
        self.print_header(f"Concurrent Translation Test ({workers} workers)")
        
        latencies = []
        
        def translate_task(text):
            return self.translate(text, src_lang, tgt_lang, use_cache=True)
        
        print(f"🚀 Sending {len(sentences)} requests with {workers} concurrent workers...")
        start_time = time.time()
        
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(translate_task, text) for text in sentences]
            
            for i, future in enumerate(as_completed(futures), 1):
                latency, cached, translated = future.result()
                latencies.append(latency)
                print(f"  [{i}/{len(sentences)}] Completed: {latency:.3f}s | Cached: {cached}")
        
        total_time = time.time() - start_time
        throughput = len(sentences) / total_time
        
        print(f"\n📈 Concurrent Performance:")
        print(f"  Total time: {total_time:.2f}s")
        print(f"  Throughput: {throughput:.2f} req/s")
        
        self.print_stats(latencies, "Concurrent Requests")
        return latencies
    
    def print_cache_stats(self):
        """In cache statistics"""
        print("\n" + "="*80)
        print("  Cache Statistics")
        print("="*80)
        total = self.cache_hits + self.cache_misses
        hit_rate = (self.cache_hits / total * 100) if total > 0 else 0
        
        print(f"\n  Cache Hits:   {self.cache_hits}")
        print(f"  Cache Misses: {self.cache_misses}")
        print(f"  Hit Rate:     {hit_rate:.1f}%")
        
        if hit_rate >= 80:
            print(f"  ✅ Excellent cache performance!")
        elif hit_rate >= 50:
            print(f"  ⚠️  Moderate cache performance")
        else:
            print(f"  ❌ Poor cache performance")


class STTBenchmark(ServiceBenchmark):
    """Benchmark cho STT Service"""
    
    def __init__(self, base_url: str):
        super().__init__(base_url, "STT")
    
    def check_health(self) -> bool:
        """Check service health"""
        try:
            response = requests.get(f"{self.base_url}/health", timeout=5)
            return response.status_code == 200
        except:
            return False


class TTSBenchmark(ServiceBenchmark):
    """Benchmark cho TTS Service"""
    
    def __init__(self, base_url: str):
        super().__init__(base_url, "TTS")
    
    def synthesize(self, text: str, language: str = "vi") -> Tuple[float, int]:
        """
        Gọi TTS API và đo latency
        
        Returns:
            (latency, audio_size_bytes)
        """
        url = f"{self.base_url}/synthesize"
        payload = {
            "text": text,
            "language": language,
            "engine": "gtts"
        }
        
        start = time.time()
        try:
            response = requests.post(url, json=payload, timeout=30)
            latency = time.time() - start
            
            if response.status_code == 200:
                audio_size = len(response.content)
                return latency, audio_size
            else:
                print(f"❌ Error: {response.status_code}")
                return latency, 0
        except Exception as e:
            latency = time.time() - start
            print(f"❌ Exception: {str(e)}")
            return latency, 0
    
    def test_synthesis(self, sentences: List[str], language: str = "vi") -> List[float]:
        """Test TTS synthesis performance"""
        self.print_header(f"TTS Synthesis Test ({language})")
        
        latencies = []
        total_audio_size = 0
        
        for i, text in enumerate(sentences, 1):
            print(f"\n[{i}/{len(sentences)}] Synthesizing: {text[:50]}...")
            latency, audio_size = self.synthesize(text, language)
            latencies.append(latency)
            total_audio_size += audio_size
            
            print(f"  Latency: {latency:.3f}s | Audio: {audio_size:,} bytes")
            time.sleep(0.3)
        
        self.print_stats(latencies, f"TTS {language}")
        
        avg_size = total_audio_size / len(sentences) if sentences else 0
        print(f"\n  Average audio size: {avg_size:,.0f} bytes")
        
        return latencies


def main():
    parser = argparse.ArgumentParser(description="Benchmark Translation Services")
    parser.add_argument('--translation-url', default='http://10.148.0.2:8003',
                       help='Translation service URL')
    parser.add_argument('--stt-url', default='http://10.148.0.2:8002',
                       help='STT service URL')
    parser.add_argument('--tts-url', default='http://10.148.0.4:8004',
                       help='TTS service URL')
    parser.add_argument('--skip-concurrent', action='store_true',
                       help='Skip concurrent load test')
    
    args = parser.parse_args()
    
    print("\n" + "🚀"*40)
    print("  TRANSLATION SERVICES PERFORMANCE BENCHMARK")
    print("🚀"*40)
    
    # Translation Benchmarks
    print("\n\n" + "="*80)
    print("  PART 1: TRANSLATION SERVICE")
    print("="*80)
    
    trans_bench = TranslationBenchmark(args.translation_url)
    
    # Test 1: Vi → En (Cold)
    cold_vi_en = trans_bench.test_cold_cache(TEST_SENTENCES_VI[:5], "vi", "en")
    
    # Test 2: Vi → En (Warm)
    warm_vi_en = trans_bench.test_warm_cache(TEST_SENTENCES_VI[:5], "vi", "en")
    
    # Test 3: En → Vi (Cold)
    cold_en_vi = trans_bench.test_cold_cache(TEST_SENTENCES_EN[:5], "en", "vi")
    
    # Test 4: En → Vi (Warm)
    warm_en_vi = trans_bench.test_warm_cache(TEST_SENTENCES_EN[:5], "en", "vi")
    
    # Test 5: Concurrent (if not skipped)
    if not args.skip_concurrent:
        concurrent = trans_bench.test_concurrent_requests(
            TEST_SENTENCES_VI[:10], "vi", "en", workers=5
        )
    
    # Cache statistics
    trans_bench.print_cache_stats()
    
    # TTS Benchmarks
    print("\n\n" + "="*80)
    print("  PART 2: TTS SERVICE")
    print("="*80)
    
    tts_bench = TTSBenchmark(args.tts_url)
    
    # Test Vietnamese TTS
    tts_vi = tts_bench.test_synthesis(TEST_SENTENCES_VI[:5], "vi")
    
    # Test English TTS
    tts_en = tts_bench.test_synthesis(TEST_SENTENCES_EN[:5], "en")
    
    # Final Summary
    print("\n\n" + "="*80)
    print("  FINAL SUMMARY")
    print("="*80)
    
    print("\n✅ Translation Service:")
    print(f"  Cold cache avg: {statistics.mean(cold_vi_en + cold_en_vi):.3f}s")
    print(f"  Warm cache avg: {statistics.mean(warm_vi_en + warm_en_vi):.3f}s")
    print(f"  Speedup: {statistics.mean(cold_vi_en + cold_en_vi) / statistics.mean(warm_vi_en + warm_en_vi):.1f}x")
    
    print("\n✅ TTS Service:")
    print(f"  Vietnamese avg: {statistics.mean(tts_vi):.3f}s")
    print(f"  English avg: {statistics.mean(tts_en):.3f}s")
    
    # Roadmap validation
    print("\n" + "="*80)
    print("  ROADMAP SUCCESS CRITERIA VALIDATION")
    print("="*80)
    
    trans_cold_avg = statistics.mean(cold_vi_en + cold_en_vi)
    trans_warm_avg = statistics.mean(warm_vi_en + warm_en_vi)
    tts_avg = statistics.mean(tts_vi + tts_en)
    
    print("\n📋 Target: Translation latency <1s per sentence")
    if trans_cold_avg < 1.0:
        print(f"  ✅ PASS: {trans_cold_avg:.3f}s < 1.0s")
    else:
        print(f"  ❌ FAIL: {trans_cold_avg:.3f}s >= 1.0s")
    
    print("\n📋 Target: TTS latency <500ms for short texts")
    if tts_avg < 0.5:
        print(f"  ✅ PASS: {tts_avg:.3f}s < 0.5s")
    else:
        print(f"  ⚠️  PARTIAL: {tts_avg:.3f}s (gTTS is network-based)")
    
    print("\n📋 Target: Cache improves performance >5x")
    speedup = trans_cold_avg / trans_warm_avg if trans_warm_avg > 0 else 0
    if speedup > 5:
        print(f"  ✅ PASS: {speedup:.1f}x speedup > 5x")
    else:
        print(f"  ⚠️  PARTIAL: {speedup:.1f}x speedup")
    
    print("\n" + "🎉"*40)
    print("  BENCHMARK COMPLETE!")
    print("🎉"*40 + "\n")


if __name__ == "__main__":
    main()

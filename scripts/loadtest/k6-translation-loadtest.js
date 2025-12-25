/**
 * k6 Load Test Script - Translation Service
 * JBCalling Translation System
 * 
 * Usage:
 *   k6 run --out json=results.json k6-translation-loadtest.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// Custom metrics
const translationLatency = new Trend('translation_latency_ms');
const translationSuccess = new Rate('translation_success_rate');
const cacheHitRate = new Rate('cache_hit_rate');

// Test configuration
export const options = {
    scenarios: {
        baseline: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '1m', target: 20 },
                { duration: '3m', target: 20 },
                { duration: '30s', target: 0 },
            ],
            gracefulRampDown: '30s',
        },
        peak: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '1m', target: 100 },
                { duration: '5m', target: 100 },
                { duration: '1m', target: 0 },
            ],
            gracefulRampDown: '30s',
            startTime: '5m',
        },
    },
    thresholds: {
        'http_req_duration': ['p(95)<2000'],      // P95 < 2s
        'http_req_failed': ['rate<0.05'],
        'translation_latency_ms': ['p(95)<2000', 'p(99)<3000'],
        'translation_success_rate': ['rate>0.95'],
    },
};

const BASE_URL = __ENV.TRANSLATION_URL || 'https://translation.jbcalling.site';

// Sample texts for translation (mix of lengths)
const SAMPLE_TEXTS = [
    // Short texts
    { text: 'Hello, how are you?', source: 'en', target: 'vi' },
    { text: 'Xin chào', source: 'vi', target: 'en' },
    { text: 'Good morning', source: 'en', target: 'vi' },
    
    // Medium texts
    { text: 'The weather is beautiful today. I think we should go for a walk in the park.', source: 'en', target: 'vi' },
    { text: 'Hôm nay thời tiết rất đẹp. Chúng ta nên đi dạo trong công viên.', source: 'vi', target: 'en' },
    
    // Longer texts
    { text: 'Welcome to our video conferencing platform. This system provides real-time translation between Vietnamese and English, making communication seamless across language barriers.', source: 'en', target: 'vi' },
    { text: 'Chào mừng bạn đến với nền tảng hội nghị video của chúng tôi. Hệ thống này cung cấp dịch thuật thời gian thực giữa tiếng Việt và tiếng Anh.', source: 'vi', target: 'en' },
];

// Track seen texts for cache hit estimation
const seenTexts = new Set();

export function setup() {
    const healthRes = http.get(`${BASE_URL}/health`);
    check(healthRes, {
        'Translation service is healthy': (r) => r.status === 200,
    });
    
    if (healthRes.status !== 200) {
        throw new Error(`Translation service not healthy: ${healthRes.status}`);
    }
    
    console.log(`Starting translation load test against ${BASE_URL}`);
    return { startTime: Date.now() };
}

export default function () {
    group('Translation Request', () => {
        // Select random sample
        const sample = SAMPLE_TEXTS[Math.floor(Math.random() * SAMPLE_TEXTS.length)];
        
        const payload = JSON.stringify({
            text: sample.text,
            source_lang: sample.source,
            target_lang: sample.target,
        });
        
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
        
        const startTime = Date.now();
        
        const response = http.post(
            `${BASE_URL}/translate`,
            payload,
            { headers, timeout: '15s' }
        );
        
        const latency = Date.now() - startTime;
        translationLatency.add(latency);
        
        const isSuccess = check(response, {
            'status is 200': (r) => r.status === 200,
            'has translation': (r) => {
                try {
                    const body = JSON.parse(r.body);
                    return body.translated_text !== undefined || body.translation !== undefined;
                } catch (e) {
                    return false;
                }
            },
            'latency < 2s': () => latency < 2000,
        });
        
        translationSuccess.add(isSuccess ? 1 : 0);
        
        // Estimate cache hit (if text was seen before, likely cached)
        const textKey = `${sample.source}:${sample.target}:${sample.text}`;
        if (seenTexts.has(textKey)) {
            cacheHitRate.add(latency < 100 ? 1 : 0); // Fast response suggests cache hit
        }
        seenTexts.add(textKey);
        
        if (!isSuccess) {
            console.error(`Translation Error: ${response.status} - ${response.body}`);
        }
    });
    
    sleep(Math.random() * 1.5 + 0.5); // 0.5-2 seconds
}

export function teardown(data) {
    const duration = (Date.now() - data.startTime) / 1000;
    console.log(`Translation load test completed in ${duration.toFixed(2)} seconds`);
}

export function handleSummary(data) {
    const summary = {
        timestamp: new Date().toISOString(),
        service: 'Translation',
        baseUrl: BASE_URL,
        duration: data.state.testRunDurationMs,
        metrics: {
            requests: data.metrics.http_reqs?.values?.count || 0,
            requestsPerSecond: data.metrics.http_reqs?.values?.rate || 0,
            latencyP50: data.metrics.http_req_duration?.values?.['p(50)'] || 0,
            latencyP95: data.metrics.http_req_duration?.values?.['p(95)'] || 0,
            latencyP99: data.metrics.http_req_duration?.values?.['p(99)'] || 0,
            errorRate: data.metrics.http_req_failed?.values?.rate || 0,
            translationSuccessRate: data.metrics.translation_success_rate?.values?.rate || 0,
        },
        thresholds: data.thresholds,
    };
    
    return {
        'stdout': JSON.stringify(summary, null, 2),
        './loadtest-results/translation-summary.json': JSON.stringify(summary, null, 2),
    };
}



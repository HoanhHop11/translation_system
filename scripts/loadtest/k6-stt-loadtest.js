/**
 * k6 Load Test Script - STT Service
 * JBCalling Translation System
 * 
 * Usage:
 *   k6 run --out json=results.json k6-stt-loadtest.js
 *   
 * Prerequisites:
 *   - Install k6: https://k6.io/docs/getting-started/installation/
 *   - Prepare test audio file: test-audio.wav (16kHz, mono, PCM)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// Custom metrics
const sttLatency = new Trend('stt_latency_ms');
const sttSuccess = new Rate('stt_success_rate');
const sttRequests = new Counter('stt_total_requests');

// Test configuration
export const options = {
    scenarios: {
        // Scenario 1: Baseline (ramp-up to 10 VUs)
        baseline: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '1m', target: 10 },   // Ramp-up to 10
                { duration: '3m', target: 10 },   // Hold at 10
                { duration: '30s', target: 0 },   // Ramp-down
            ],
            gracefulRampDown: '30s',
            startTime: '0s',
        },
        // Scenario 2: Peak Load (50 VUs)
        peak_load: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '1m', target: 50 },   // Ramp-up to 50
                { duration: '5m', target: 50 },   // Hold at 50
                { duration: '1m', target: 0 },    // Ramp-down
            ],
            gracefulRampDown: '30s',
            startTime: '5m',  // Start after baseline
        },
        // Scenario 3: Stress Test (100+ VUs)
        stress: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '2m', target: 100 },  // Ramp-up to 100
                { duration: '3m', target: 100 },  // Hold at 100
                { duration: '2m', target: 150 },  // Push to 150
                { duration: '2m', target: 150 },  // Hold
                { duration: '1m', target: 0 },    // Ramp-down
            ],
            gracefulRampDown: '30s',
            startTime: '12m', // Start after peak
        },
    },
    thresholds: {
        'http_req_duration': ['p(95)<3000'],      // P95 < 3s
        'http_req_failed': ['rate<0.05'],          // Error rate < 5%
        'stt_latency_ms': ['p(95)<3000', 'p(99)<5000'],
        'stt_success_rate': ['rate>0.95'],
    },
};

// Base URL configuration
const BASE_URL = __ENV.STT_URL || 'https://stt.jbcalling.site';

// Sample audio data (base64 encoded short audio)
// In production, use: const audioData = open('./test-audio.wav', 'b');
const SAMPLE_AUDIO_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

export function setup() {
    // Verify service is healthy
    const healthRes = http.get(`${BASE_URL}/health`);
    check(healthRes, {
        'STT service is healthy': (r) => r.status === 200,
    });
    
    if (healthRes.status !== 200) {
        throw new Error(`STT service not healthy: ${healthRes.status}`);
    }
    
    console.log(`Starting load test against ${BASE_URL}`);
    return { startTime: Date.now() };
}

export default function (data) {
    group('STT Transcription', () => {
        // Option 1: Using form-data with audio file
        const formData = {
            audio: http.file(SAMPLE_AUDIO_BASE64, 'test.wav', 'audio/wav'),
            language: 'en',
        };
        
        const headers = {
            'Accept': 'application/json',
        };
        
        const startTime = Date.now();
        
        const response = http.post(
            `${BASE_URL}/transcribe`,
            formData,
            { headers, timeout: '30s' }
        );
        
        const latency = Date.now() - startTime;
        
        // Record metrics
        sttLatency.add(latency);
        sttRequests.add(1);
        
        const isSuccess = check(response, {
            'status is 200': (r) => r.status === 200,
            'has transcript': (r) => {
                try {
                    const body = JSON.parse(r.body);
                    return body.text !== undefined || body.transcript !== undefined;
                } catch (e) {
                    return false;
                }
            },
            'latency < 3s': () => latency < 3000,
        });
        
        sttSuccess.add(isSuccess ? 1 : 0);
        
        if (!isSuccess && response.status !== 200) {
            console.error(`STT Error: ${response.status} - ${response.body}`);
        }
    });
    
    // Think time between requests (simulate real user behavior)
    sleep(Math.random() * 2 + 1); // 1-3 seconds
}

export function teardown(data) {
    const duration = (Date.now() - data.startTime) / 1000;
    console.log(`Load test completed in ${duration.toFixed(2)} seconds`);
}

export function handleSummary(data) {
    // Generate summary report
    const summary = {
        timestamp: new Date().toISOString(),
        service: 'STT',
        baseUrl: BASE_URL,
        duration: data.state.testRunDurationMs,
        metrics: {
            requests: data.metrics.http_reqs?.values?.count || 0,
            requestsPerSecond: data.metrics.http_reqs?.values?.rate || 0,
            latencyP50: data.metrics.http_req_duration?.values?.['p(50)'] || 0,
            latencyP95: data.metrics.http_req_duration?.values?.['p(95)'] || 0,
            latencyP99: data.metrics.http_req_duration?.values?.['p(99)'] || 0,
            errorRate: data.metrics.http_req_failed?.values?.rate || 0,
            sttSuccessRate: data.metrics.stt_success_rate?.values?.rate || 0,
        },
        thresholds: data.thresholds,
    };
    
    return {
        'stdout': JSON.stringify(summary, null, 2),
        './loadtest-results/stt-summary.json': JSON.stringify(summary, null, 2),
    };
}



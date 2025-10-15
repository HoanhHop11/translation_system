/**
 * Configuration cho MediaSoup Gateway Service
 * 
 * File này chứa tất cả các configuration settings cho MediaSoup,
 * WebRTC, và server infrastructure.
 */

import { types as mediasoupTypes } from 'mediasoup';
import * as os from 'os';

type RtpCodecCapability = mediasoupTypes.RtpCodecCapability;
type TransportListenInfo = mediasoupTypes.TransportListenInfo;
type TransportListenIp = mediasoupTypes.TransportListenIp;

export interface Config {
  // HTTP Server
  server: {
    port: number;
    host: string;
  };

  // MediaSoup Settings
  mediasoup: {
    // Worker settings
    numWorkers: number;
    worker: {
      rtcMinPort: number;
      rtcMaxPort: number;
      logLevel: 'debug' | 'warn' | 'error' | 'none';
      logTags: mediasoupTypes.WorkerLogTag[];
    };

    // Router settings
    router: {
      mediaCodecs: RtpCodecCapability[];
    };

    // WebRTC Transport settings
    webRtcTransport: {
      listenInfos: TransportListenInfo[];
      initialAvailableOutgoingBitrate: number;
      maxIncomingBitrate: number;
      maxOutgoingBitrate: number;
    };
  };

  // Redis Configuration
  redis: {
    host: string;
    port: number;
    password?: string;
  };

  // Audio Processing
  audio: {
    enabled: boolean;
    sampleRate: number;
    channels: number;
  };
}

/**
 * Custom error class cho configuration errors
 */
export class ConfigurationError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: string[]
  ) {
    super(message);
    this.name = 'ConfigurationError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validate log level với type safety
 */
function validateLogLevel(level: string | undefined): 'debug' | 'warn' | 'error' | 'none' {
  const validLevels = ['debug', 'warn', 'error', 'none'];
  const defaultLevel = 'warn';
  
  if (!level || !validLevels.includes(level)) {
    return defaultLevel;
  }
  
  return level as 'debug' | 'warn' | 'error' | 'none';
}

/**
 * Load configuration từ environment variables
 */
export const config: Config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
  },

  mediasoup: {
    // Optimize worker count cho streaming: Sử dụng CPU count - 1 để dành 1 core cho system
    numWorkers: parseInt(
      process.env.WORKER_COUNT || String(Math.max(1, os.cpus().length - 1)),
      10
    ),

    worker: {
      rtcMinPort: parseInt(process.env.RTC_MIN_PORT || '40000', 10),
      rtcMaxPort: parseInt(process.env.RTC_MAX_PORT || '40100', 10),
      logLevel: validateLogLevel(process.env.LOG_LEVEL),
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp',
        'rtx',
        'bwe',
        'score',
        'simulcast',
        'svc',
        'sctp',
      ],
    },

    router: {
      mediaCodecs: [
        // Audio codecs
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
        // Video codecs
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/VP9',
          clockRate: 90000,
          parameters: {
            'profile-id': 2,
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '4d0032',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000,
          },
        },
      ],
    },

    webRtcTransport: {
      listenInfos: [
        {
          protocol: 'udp',
          ip: '0.0.0.0',
          announcedAddress: process.env.ANNOUNCED_IP || undefined,
        },
        {
          protocol: 'tcp',
          ip: '0.0.0.0',
          announcedAddress: process.env.ANNOUNCED_IP || undefined,
        },
      ],
      initialAvailableOutgoingBitrate: 1000000,
      maxIncomingBitrate: 15000000,
      maxOutgoingBitrate: 15000000,
    },
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  audio: {
    enabled: process.env.ENABLE_AUDIO_PROCESSING === 'true',
    sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE || '48000', 10),
    channels: parseInt(process.env.AUDIO_CHANNELS || '1', 10),
  },
};

/**
 * Validate configuration với error codes chuẩn hóa
 */
export function validateConfig(): void {
  const errors: string[] = [];

  // Validate port range
  if (config.server.port < 1024 || config.server.port > 65535) {
    errors.push('PORT phải trong khoảng 1024-65535');
  }

  // Validate RTC port range cho WebRTC streaming
  if (config.mediasoup.worker.rtcMinPort >= config.mediasoup.worker.rtcMaxPort) {
    errors.push('RTC_MIN_PORT phải nhỏ hơn RTC_MAX_PORT');
  }

  if (config.mediasoup.worker.rtcMinPort < 1024) {
    errors.push('RTC_MIN_PORT phải >= 1024');
  }

  if (config.mediasoup.worker.rtcMaxPort > 65535) {
    errors.push('RTC_MAX_PORT phải <= 65535');
  }

  // Validate worker count cho streaming optimization
  if (config.mediasoup.numWorkers < 1) {
    errors.push('WORKER_COUNT phải >= 1');
  }

  // Validate bitrate settings cho video streaming
  if (config.mediasoup.webRtcTransport.initialAvailableOutgoingBitrate < 100000) {
    errors.push('initialAvailableOutgoingBitrate phải >= 100kbps cho streaming');
  }

  // Validate audio settings cho STT streaming pipeline
  if (config.audio.enabled) {
    if (config.audio.sampleRate !== 48000 && config.audio.sampleRate !== 16000) {
      errors.push('AUDIO_SAMPLE_RATE phải là 48000 hoặc 16000 Hz');
    }
    if (config.audio.channels < 1 || config.audio.channels > 2) {
      errors.push('AUDIO_CHANNELS phải là 1 (mono) hoặc 2 (stereo)');
    }
  }

  // Critical warning cho ANNOUNCED_IP (required cho WebRTC NAT traversal)
  if (!process.env.ANNOUNCED_IP) {
    console.warn(
      '⚠️  WARNING: ANNOUNCED_IP chưa được set. WebRTC có thể không hoạt động đúng!\n' +
      '   Set ANNOUNCED_IP=<public-ip> trong environment variables.'
    );
  }

  // Throw ConfigurationError nếu có lỗi
  if (errors.length > 0) {
    throw new ConfigurationError(
      'ERR_INVALID_CONFIG',
      'Configuration không hợp lệ',
      errors
    );
  }

  console.log('✅ Configuration validated successfully');
  console.log(`   Workers: ${config.mediasoup.numWorkers}`);
  console.log(`   RTC Ports: ${config.mediasoup.worker.rtcMinPort}-${config.mediasoup.worker.rtcMaxPort}`);
  console.log(`   Audio Streaming: ${config.audio.enabled ? 'Enabled' : 'Disabled'}`);
}

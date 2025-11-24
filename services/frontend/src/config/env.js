/**
 * Utility để đọc environment variables từ runtime hoặc build time
 * 
 * Trong production (Docker): Đọc từ window._env_ (injected by docker-entrypoint.sh)
 * Trong development (local): Đọc từ import.meta.env (Vite)
 */

const getEnvMulti = (keys, defaultValue = '') => {
  for (const key of keys) {
    if (window._env_ && window._env_[key]) {
      return window._env_[key];
    }
    if (import.meta.env && import.meta.env[key]) {
      return import.meta.env[key];
    }
  }
  return defaultValue;
};

export const ENV = {
  // Gateway SFU URL (MediaSoup + Socket.IO)
  GATEWAY_URL: getEnvMulti(['REACT_APP_GATEWAY_URL', 'VITE_GATEWAY_URL'], 'wss://api.jbcalling.site'),

  // Signaling Server URL (Deprecated - kept for compatibility)
  SIGNALING_URL: getEnvMulti(['REACT_APP_SIGNALING_URL', 'VITE_WS_URL'], 'http://localhost:8001'),

  // AI Services URLs
  STT_SERVICE_URL: getEnvMulti(['REACT_APP_STT_SERVICE_URL', 'VITE_STT_SERVICE_URL'], 'http://localhost:8002'),
  TRANSLATION_SERVICE_URL: getEnvMulti(['REACT_APP_TRANSLATION_SERVICE_URL', 'VITE_TRANSLATION_SERVICE_URL'], 'http://localhost:8003'),
  TTS_SERVICE_URL: getEnvMulti(['REACT_APP_TTS_SERVICE_URL', 'VITE_TTS_SERVICE_URL'], 'http://localhost:8004'),

  // TURN Server Configuration
  TURN_SERVER: getEnvMulti(['REACT_APP_TURN_SERVER', 'VITE_TURN_SERVER'], 'turn:34.142.190.250:3478'),
  TURN_USERNAME: getEnvMulti(['REACT_APP_TURN_USERNAME', 'VITE_TURN_USERNAME'], 'videocall'),
  TURN_SECRET: getEnvMulti(['REACT_APP_TURN_SECRET', 'VITE_TURN_SECRET'], '4798697923fa54e05ca5a509412bfd03144837b726a2e348149c2fe5e1b9c4dd'),

  // STUN Servers (comma-separated string)
  STUN_SERVERS: getEnvMulti(['REACT_APP_STUN_SERVERS', 'VITE_STUN_SERVERS'], 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478'),

  // Helper: Parse STUN servers string to array
  getStunServers: () => {
    const stunStr = ENV.STUN_SERVERS;
    return stunStr.split(',').map(s => s.trim()).filter(Boolean);
  },

  // Helper: Get TURN configuration object
  getTurnConfig: () => ({
    urls: [
      `${ENV.TURN_SERVER}?transport=udp`,
      `${ENV.TURN_SERVER}?transport=tcp`
    ],
    username: ENV.TURN_USERNAME,
    credential: ENV.TURN_SECRET
  }),

  // Helper: Get all ICE servers
  getIceServers: () => {
    const iceServers = [];

    // Add TURN server
    iceServers.push(ENV.getTurnConfig());

    // Add STUN servers
    ENV.getStunServers().forEach(stunUrl => {
      iceServers.push({ urls: stunUrl });
    });

    // Backup TURN servers (public)
    iceServers.push({
      urls: 'turn:numb.viagenie.ca',
      username: 'webrtc@live.com',
      credential: 'muazkh'
    });

    iceServers.push({
      urls: 'turn:turn.bistri.com:80',
      username: 'homeo',
      credential: 'homeo'
    });

    return iceServers;
  },

  // Debug: Log all environment variables
  debug: () => {
    console.group('🔧 Environment Configuration');
    console.log('GATEWAY_URL:', ENV.GATEWAY_URL);
    console.log('SIGNALING_URL:', ENV.SIGNALING_URL);
    console.log('STT_SERVICE_URL:', ENV.STT_SERVICE_URL);
    console.log('TRANSLATION_SERVICE_URL:', ENV.TRANSLATION_SERVICE_URL);
    console.log('TTS_SERVICE_URL:', ENV.TTS_SERVICE_URL);
    console.log('TURN_SERVER:', ENV.TURN_SERVER);
    console.log('TURN_USERNAME:', ENV.TURN_USERNAME);
    console.log('TURN_SECRET:', ENV.TURN_SECRET ? '***' + ENV.TURN_SECRET.slice(-8) : 'not set');
    console.log('STUN_SERVERS:', ENV.getStunServers());
    console.log('ICE_SERVERS:', ENV.getIceServers());
    console.groupEnd();
  }
};

// Log in development mode
if (import.meta.env.DEV) {
  ENV.debug();
}

export default ENV;

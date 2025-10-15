/**
 * TypeScript Types cho Gateway Service
 * 
 * Định nghĩa types cho streaming architecture với MediaSoup + Socket.IO
 */

import {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  RtpCapabilities,
  DtlsParameters,
  IceParameters,
  IceCandidate,
} from 'mediasoup/node/lib/types';

/**
 * Room state trong Redis cho multi-node streaming
 */
export interface Room {
  id: string;
  createdAt: number;
  participants: Map<string, Participant>;
  router: Router;
}

/**
 * Participant trong room (streaming peer)
 */
export interface Participant {
  id: string;
  socketId: string;
  name: string;
  joinedAt: number;
  
  // WebRTC transports cho bidirectional streaming
  sendTransport?: WebRtcTransport;
  recvTransport?: WebRtcTransport;
  
  // Media streams
  producers: Map<string, Producer>; // audio/video producers
  consumers: Map<string, Consumer>; // consuming other participants' streams
  
  // Capabilities
  rtpCapabilities?: RtpCapabilities;
  
  // Audio streaming cho STT
  audioProducer?: Producer;
  isAudioStreaming: boolean;
}

/**
 * Socket.IO Events cho streaming signaling
 */
export interface ServerToClientEvents {
  // Connection events
  'connected': (data: { socketId: string }) => void;
  'error': (error: ErrorResponse) => void;
  
  // Room streaming events
  'room-created': (data: { roomId: string }) => void;
  'room-joined': (data: RoomJoinedData) => void;
  'participant-joined': (data: ParticipantData) => void;
  'participant-left': (data: { participantId: string }) => void;
  
  // WebRTC streaming setup
  'router-rtp-capabilities': (capabilities: RtpCapabilities) => void;
  'transport-created': (data: TransportData) => void;
  'transport-connected': () => void;
  
  // Media streaming events
  'producer-created': (data: ProducerData) => void;
  'producer-closed': (data: { producerId: string }) => void;
  'consumer-created': (data: ConsumerData) => void;
  'consumer-closed': (data: { consumerId: string }) => void;
  
  // New producer available for consumption (streaming notification)
  'new-producer': (data: { producerId: string; participantId: string; kind: 'audio' | 'video' }) => void;
  
  // STT streaming events
  'transcription': (data: TranscriptionData) => void;
  'translation': (data: TranslationData) => void;
}

export interface ClientToServerEvents {
  // Room management
  'create-room': (callback: (response: RoomResponse) => void) => void;
  'join-room': (data: { roomId: string; name: string }, callback: (response: RoomJoinResponse) => void) => void;
  'leave-room': (callback: () => void) => void;
  
  // WebRTC transport setup cho streaming
  'get-router-rtp-capabilities': (callback: (capabilities: RtpCapabilities) => void) => void;
  'create-webrtc-transport': (
    data: { producing: boolean; consuming: boolean },
    callback: (response: TransportResponse) => void
  ) => void;
  'connect-webrtc-transport': (
    data: { transportId: string; dtlsParameters: DtlsParameters },
    callback: (response: { error?: string }) => void
  ) => void;
  
  // Media streaming
  'produce': (
    data: { transportId: string; kind: 'audio' | 'video'; rtpParameters: any },
    callback: (response: ProduceResponse) => void
  ) => void;
  'consume': (
    data: { producerId: string; rtpCapabilities: RtpCapabilities },
    callback: (response: ConsumeResponse) => void
  ) => void;
  
  // Consumer control
  'resume-consumer': (data: { consumerId: string }, callback: () => void) => void;
  'pause-consumer': (data: { consumerId: string }, callback: () => void) => void;
  'close-producer': (data: { producerId: string }, callback: () => void) => void;
}

/**
 * Response types
 */
export interface ErrorResponse {
  code: string;
  message: string;
  details?: any;
}

export interface RoomResponse {
  roomId?: string;
  error?: ErrorResponse;
}

export interface RoomJoinResponse {
  success: boolean;
  roomId?: string;
  participants?: ParticipantData[];
  rtpCapabilities?: RtpCapabilities;
  error?: ErrorResponse;
}

export interface RoomJoinedData {
  roomId: string;
  participantId: string;
  participants: ParticipantData[];
  rtpCapabilities: RtpCapabilities;
}

export interface ParticipantData {
  id: string;
  name: string;
  joinedAt: number;
  producers: { id: string; kind: 'audio' | 'video' }[];
}

export interface TransportResponse {
  id?: string;
  iceParameters?: IceParameters;
  iceCandidates?: IceCandidate[];
  dtlsParameters?: DtlsParameters;
  error?: ErrorResponse;
}

export interface TransportData {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
}

export interface ProduceResponse {
  producerId?: string;
  error?: ErrorResponse;
}

export interface ProducerData {
  id: string;
  kind: 'audio' | 'video';
  participantId: string;
}

export interface ConsumeResponse {
  id?: string;
  producerId?: string;
  kind?: 'audio' | 'video';
  rtpParameters?: any;
  error?: ErrorResponse;
}

export interface ConsumerData {
  id: string;
  producerId: string;
  kind: 'audio' | 'video';
  rtpParameters: any;
  participantId: string;
}

/**
 * STT/Translation streaming data
 */
export interface TranscriptionData {
  participantId: string;
  text: string;
  language: string;
  confidence: number;
  timestamp: number;
  isFinal: boolean; // streaming: false for interim results
}

export interface TranslationData {
  participantId: string;
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  timestamp: number;
}

/**
 * Worker pool management
 */
export interface WorkerData {
  worker: Worker;
  routers: Map<string, Router>;
  roomCount: number;
}

/**
 * Audio streaming buffer cho STT
 */
export interface AudioStreamBuffer {
  participantId: string;
  producerId: string;
  buffer: Buffer[];
  sampleRate: number;
  channels: number;
  lastProcessedAt: number;
}

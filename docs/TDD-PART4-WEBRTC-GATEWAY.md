# TECHNICAL DESIGN DOCUMENT - PART 4
# WEBRTC & GATEWAY ARCHITECTURE

**Parent Document**: `TDD-JBCALLING-COMPLETE.md`  
**Part**: 4 of 5 - WebRTC Media Pipeline & Gateway Service  
**Date**: November 19, 2025

---

# PART 4: WEBRTC & GATEWAY SERVICE

## 14. WEBRTC ARCHITECTURE OVERVIEW

### 14.1. SFU vs Mesh vs MCU

#### Architecture Decision

```yaml
Chosen Architecture: SFU (Selective Forwarding Unit)

Why SFU over Mesh P2P:
  Mesh P2P (Old Architecture - Deprecated):
    ✅ Pros:
      - No server bandwidth cost
      - Lower latency (direct peer connections)
      - Simpler server logic (just signaling)
    
    ❌ Cons:
      - Client uploads N-1 streams (4 peers = upload 3x video)
      - Mobile devices can't handle >3 participants
      - Hard to inject translation audio (need custom producer)
      - No central control (can't record, moderate, monitor easily)
      - Bandwidth usage grows O(N²) per participant
    
    Result: Deprecated in Phase 5 (November 2025)

  SFU (Current Architecture - MediaSoup):
    ✅ Pros:
      - Client uploads 1 stream (server forwards to others)
      - Scales to 20+ participants per room
      - Central control (recording, moderation, analytics)
      - Easy to inject AI translation audio as producer
      - Bandwidth usage O(N) server-side
      - MediaSoup battle-tested (Jitsi, Mediasoup demos)
    
    ❌ Cons:
      - Server bandwidth cost (but manageable)
      - Higher latency (+30-50ms vs P2P)
      - More complex server logic (MediaSoup workers)
    
    Result: Adopted ✅

  MCU (Not Considered):
    - Server transcodes/mixes all streams
    - Too expensive (CPU cost 10-100x higher than SFU)
    - Only useful for legacy clients (no WebRTC support)

Decision: SFU with MediaSoup (best balance of scalability, control, and cost)
```

### 14.2. MediaSoup Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Gateway Service                        │
│                  (Node.js + MediaSoup)                   │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │            WorkerManager (Load Balancer)           │ │
│  │                                                    │ │
│  │  ┌──────────┐  ┌──────────┐                       │ │
│  │  │ Worker 1 │  │ Worker 2 │ ... (2 workers)       │ │
│  │  │  PID:    │  │  PID:    │                       │ │
│  │  │  12345   │  │  12346   │                       │ │
│  │  └────┬─────┘  └────┬─────┘                       │ │
│  └───────┼─────────────┼────────────────────────────┘ │
│          │             │                               │
│  ┌───────▼─────────────▼────────────────────────────┐ │
│  │            RoomManager (State)                   │ │
│  │                                                  │ │
│  │  Room "xyz123":                                  │ │
│  │    Router (on Worker 1)                          │ │
│  │    Participants:                                 │ │
│  │      - Alice (id: abc, socket: s1)               │ │
│  │        SendTransport (upload video/audio)        │ │
│  │        RecvTransport (download others' streams)  │ │
│  │        Producers: [video, audio]                 │ │
│  │        Consumers: [Bob's video, Bob's audio, ...]│ │
│  │      - Bob (id: def, socket: s2)                 │ │
│  │        SendTransport                             │ │
│  │        RecvTransport                             │ │
│  │        Producers: [video, audio]                 │ │
│  │        Consumers: [Alice's video, Alice's audio]│ │
│  └──────────────────────────────────────────────────┘ │
│                                                          │
│  ┌──────────────────────────────────────────────────┐ │
│  │       AudioProcessor (STT Integration)           │ │
│  │                                                  │ │
│  │  For each audio Producer:                        │ │
│  │    - Tap RTP packets (PlainTransport)           │ │
│  │    - Convert Opus → PCM 16kHz mono              │ │
│  │    - Buffer 3s chunks                            │ │
│  │    - Stream to STT service (WebSocket)          │ │
│  │    - Receive transcription                       │ │
│  │    - Broadcast to room participants              │ │
│  └──────────────────────────────────────────────────┘ │
│                                                          │
│  ┌──────────────────────────────────────────────────┐ │
│  │      SignalingServer (Socket.IO)                 │ │
│  │                                                  │ │
│  │  Socket Events:                                  │ │
│  │    - join-room                                   │ │
│  │    - create-transport (send/recv)                │ │
│  │    - connect-transport                           │ │
│  │    - produce (video/audio)                       │ │
│  │    - consume (existing producers)                │ │
│  │    - resume-consumer                             │ │
│  │    - leave-room                                  │ │
│  └──────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

#### Key Components

**1. Worker (MediaSoup C++ Process)**
```yaml
What: Separate OS process for media handling
Why: Isolate media processing from Node.js event loop
Count: 2 workers (configurable, recommend 1 per CPU core)

Responsibilities:
  - RTP packet processing (receive/forward)
  - Media codec handling (Opus, VP8, H.264)
  - SRTP encryption/decryption
  - Bandwidth estimation (BWE)
  - Packet loss handling (NACK, FEC)

Resources per Worker:
  CPU: ~0.5-1.0 vCPU per 5 concurrent rooms
  RAM: ~100-200 MB per worker process
  
Lifecycle:
  - Start: Created by WorkerManager at Gateway startup
  - Death: Auto-restart if crashed (WorkerManager monitoring)
  - Graceful Shutdown: Close all routers → close worker
```

**2. Router (Logical Room)**
```yaml
What: Logical unit representing one room's media routing
Parent: Created on a Worker
Count: 1 router per room

Responsibilities:
  - Route RTP packets between transports in same room
  - Maintain supported codecs (RTP capabilities)
  - Create transports, producers, consumers

RTP Capabilities:
  Audio Codecs:
    - Opus: 48kHz stereo/mono (preferred)
    - PCMU/PCMA: 8kHz fallback
  
  Video Codecs:
    - VP8: Default (Chrome, Firefox)
    - VP9: Optional (Chrome only)
    - H.264: Fallback (Safari, mobile)

Lifecycle:
  - Create: When first participant joins room
  - Close: When last participant leaves
  - Cascade Cleanup: Router close → all transports/producers/consumers close
```

**3. Transport (WebRTC Connection)**
```yaml
What: WebRTC connection between client and server
Types: 
  - SendTransport: Client → Server (upload video/audio)
  - RecvTransport: Server → Client (download others' streams)

Per Participant: 2 transports (send + recv)

ICE/DTLS Flow:
  1. Server creates transport, returns ICE candidates
  2. Client sets remote description (SDP)
  3. Client performs ICE gathering
  4. Client sends local description (SDP) to server
  5. Server connects transport với client's DTLS parameters
  6. DTLS handshake (encrypted)
  7. Transport ready for RTP

Port Allocation:
  Range: UDP 40000-40019 (20 ports published)
  Strategy: MediaSoup auto-allocates from pool
  Reuse: Ports reused after transport close
  
  Why Only 20 Ports?
    - Docker Swarm limitation on port mappings
    - 20 ports = ~10 concurrent transports
    - Each participant uses 2 transports = ~5 participants max
    - Future: Scale horizontally (add more Gateway instances)

Announced IP:
  IPv4: 34.143.235.114 (translation01 public IP)
  IPv6: 2600:1900:4080:7c:: (dual-stack support)
  
  Why Critical?
    - Clients need to know where to send RTP packets
    - NAT traversal relies on server announcing correct IP
    - Wrong IP = no media flow (common mistake)
```

**4. Producer (Media Source)**
```yaml
What: Represents one media track uploaded by client
Types: Audio or Video
Count: 1-2 per participant (video + audio)

Lifecycle:
  1. Client calls sendTransport.produce({ kind, rtpParameters })
  2. Server creates Producer on Router
  3. Producer emits 'transportclose' if transport dies
  4. Notify other participants (new-producer event)
  5. Other participants create Consumers to receive stream

Audio Producer (for STT):
  - Codec: Opus 48kHz mono (WebRTC default)
  - Bitrate: ~50 kbps
  - Tapped by AudioProcessor for STT processing
  - TODO: Implement PlainTransport tap (currently commented out)

Video Producer:
  - Codec: VP8 or H.264
  - Resolution: 640x480 to 1280x720 (adaptive)
  - Bitrate: 500-1500 kbps (adaptive based on bandwidth)
  - Simulcast: Optional (send multiple resolutions)
```

**5. Consumer (Media Sink)**
```yaml
What: Represents one media track downloaded by client
Parent: Created when participant wants to consume a Producer
Count: N-1 consumers per participant (all other participants' tracks)

Lifecycle:
  1. Client discovers new Producer (via 'new-producer' event)
  2. Client calls socket.emit('consume', { producerId, rtpCapabilities })
  3. Server checks Router.canConsume() (RTP capabilities match)
  4. Server creates Consumer on recv transport
  5. Consumer starts paused (wait for client ready)
  6. Client calls socket.emit('resume-consumer', { consumerId })
  7. Media flows

RTP Capabilities Mismatch (Common Issue):
  Problem: Server-side Router can't find compatible codec
  
  Symptoms:
    - Router.canConsume() returns false
    - Error: "Cannot consume producer with given RTP capabilities"
    - No video/audio received by client
  
  Root Cause:
    - Client RTP capabilities incomplete or wrong format
    - Server Router codecs misconfigured
    - Signaling sent wrong capabilities
  
  Solution (Fixed in Phase 5):
    - Client loads device with Router.rtpCapabilities
    - Client sends device.rtpCapabilities (complete, validated)
    - Server validates format before Router.canConsume()
    - Detailed error logging for debugging
```

---

## 15. GATEWAY SERVICE IMPLEMENTATION

### 15.1. WorkerManager (Worker Pool)

#### Responsibilities
```yaml
1. Worker Lifecycle Management:
   - Create N workers at startup (N = config.mediasoup.numWorkers)
   - Monitor worker health (detect crashes)
   - Auto-restart failed workers
   - Graceful shutdown (close all routers first)

2. Load Balancing:
   - Track room count per worker
   - Allocate new rooms to least-loaded worker
   - Distribute load evenly across workers

3. Resource Monitoring:
   - Track CPU/RAM per worker (future)
   - Detect overloaded workers
   - Trigger scaling alerts (future)
```

#### Implementation (WorkerManager.ts)

```typescript
export class WorkerManager {
  private workers: Map<number, WorkerData> = new Map();
  private currentWorkerIndex = 0;
  private isShuttingDown = false;

  async initialize(): Promise<void> {
    logger.info(`🚀 Initializing ${config.mediasoup.numWorkers} MediaSoup workers...`);

    const workerPromises: Promise<void>[] = [];

    for (let i = 0; i < config.mediasoup.numWorkers; i++) {
      workerPromises.push(this.createWorker(i));
    }

    await Promise.all(workerPromises);

    logger.info(`✅ Worker pool initialized với ${this.workers.size} workers`);
  }

  private async createWorker(index: number): Promise<void> {
    try {
      logger.info(`Creating worker #${index}...`);

      const worker = await mediasoup.createWorker({
        logLevel: config.mediasoup.worker.logLevel,
        logTags: config.mediasoup.worker.logTags,
        rtcMinPort: config.mediasoup.worker.rtcMinPort,
        rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
      });

      // CRITICAL: Worker 'died' event handler
      worker.on('died', (error) => {
        logger.error(`❌ Worker #${index} died unexpectedly:`, {
          error: error?.message || 'Unknown error',
          pid: worker.pid,
        });

        // Cleanup failed worker
        this.workers.delete(index);

        // Auto-restart if not shutting down
        if (!this.isShuttingDown) {
          logger.info(`♻️  Auto-restarting worker #${index}...`);
          this.createWorker(index).catch((err) => {
            logger.error(`Failed to restart worker #${index}:`, err);
          });
        }
      });

      // Store worker data
      this.workers.set(index, {
        worker,
        routers: new Map(),
        roomCount: 0,
      });

      logger.info(`✅ Worker #${index} created (PID: ${worker.pid})`);
    } catch (error) {
      logger.error(`Failed to create worker #${index}:`, error);
      throw error;
    }
  }

  getLeastLoadedWorker(): WorkerData | null {
    if (this.workers.size === 0) {
      logger.error('No workers available');
      return null;
    }

    let leastLoadedWorker: WorkerData | null = null;
    let minRoomCount = Infinity;

    for (const workerData of this.workers.values()) {
      if (workerData.roomCount < minRoomCount) {
        minRoomCount = workerData.roomCount;
        leastLoadedWorker = workerData;
      }
    }

    return leastLoadedWorker;
  }

  async createRouter(workerId?: number): Promise<Router> {
    let workerData: WorkerData | null;

    if (workerId !== undefined) {
      workerData = this.workers.get(workerId) || null;
      if (!workerData) {
        throw new Error(`Worker #${workerId} not found`);
      }
    } else {
      workerData = this.getLeastLoadedWorker();
      if (!workerData) {
        throw new Error('No workers available');
      }
    }

    try {
      const router = await workerData.worker.createRouter({
        mediaCodecs: config.mediasoup.router.mediaCodecs,
      });

      // Router lifecycle events
      router.on('workerclose', () => {
        logger.warn('Router closed due to worker closure', {
          routerId: router.id,
        });
      });

      // Track router
      workerData.routers.set(router.id, router);
      workerData.roomCount++;

      logger.info('Router created', {
        routerId: router.id,
        workerPid: workerData.worker.pid,
      });

      return router;
    } catch (error) {
      logger.error('Failed to create router:', error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down WorkerManager...');
    this.isShuttingDown = true;

    // Close all routers first
    for (const workerData of this.workers.values()) {
      for (const router of workerData.routers.values()) {
        try {
          router.close();
        } catch (error) {
          logger.error('Error closing router during shutdown:', error);
        }
      }
      workerData.routers.clear();
    }

    // Close all workers
    for (const [index, workerData] of this.workers.entries()) {
      try {
        workerData.worker.close();
        logger.info(`Worker #${index} closed (PID: ${workerData.worker.pid})`);
      } catch (error) {
        logger.error(`Error closing worker #${index}:`, error);
      }
    }

    this.workers.clear();
    logger.info('✅ WorkerManager shutdown complete');
  }
}
```

#### Load Balancing Strategy

```yaml
Current: Least Room Count (Simple)
  Algorithm: Assign new room to worker with fewest rooms
  
  Pros:
    - Simple to implement
    - Good enough for small scale (<20 rooms)
    - Predictable behavior
  
  Cons:
    - Doesn't account for room complexity (2 vs 10 participants)
    - Doesn't account for worker CPU usage
    - Can overload one worker if all big rooms assigned to it

Future: Weighted Load Balancing
  Algorithm: Assign new room to worker with lowest score
  
  Score = (roomCount × 10) + (participantCount × 2) + (cpuUsage × 100)
  
  Example:
    Worker 1: 2 rooms, 8 participants, 30% CPU
      Score = (2 × 10) + (8 × 2) + (30 × 100) = 20 + 16 + 30 = 66
    
    Worker 2: 3 rooms, 5 participants, 15% CPU
      Score = (3 × 10) + (5 × 2) + (15 × 100) = 30 + 10 + 15 = 55
    
    Decision: Assign to Worker 2 (lower score)
  
  Benefits:
    - Accounts for room complexity
    - Better resource utilization
    - Prevents hotspots
  
  Implementation:
    - Add getWorkerLoad() method
    - Track participant count per worker
    - Monitor worker CPU via /proc (Linux)
```

---

### 15.2. RoomManager (State Management)

#### Responsibilities
```yaml
1. Room Lifecycle:
   - Create room (Router + metadata)
   - Close room (cleanup cascade)
   - Track room state (participants, producers, consumers)

2. Participant Management:
   - Add participant to room
   - Remove participant (cleanup transports/producers/consumers)
   - Track participant state (transports, producers, consumers)

3. Transport Management:
   - Create WebRTC transports (send/recv)
   - Connect transports (DTLS parameters)
   - Close transports on participant leave

4. Producer/Consumer Management:
   - Create producers (participant uploads media)
   - Create consumers (participant downloads others' media)
   - Handle producer close (notify consumers)
   - Handle consumer close (cleanup)

5. Multi-Node Coordination (Redis):
   - Publish room events (create, close, participant join/leave)
   - Subscribe to events from other Gateway instances
   - Synchronize state across nodes (future)
```

#### Critical: Cascade Cleanup

```yaml
Problem: Memory leaks if resources not properly closed

MediaSoup Resource Hierarchy:
  Worker
    └─ Router
         └─ Transport
              └─ Producer / Consumer

Cascade Cleanup Rule:
  Closing parent → automatically closes all children
  
  Example:
    Worker.close() → closes all Routers
    Router.close() → closes all Transports
    Transport.close() → closes all Producers/Consumers

But: Manual tracking still needed for state management
  - RoomManager must delete from Maps
  - Participant state must be cleaned up
  - Event listeners must be removed

Correct Cleanup Sequence (Participant Leaves):
  1. Close all Consumers (consuming from this participant)
  2. Close all Consumers (owned by this participant)
  3. Close all Producers (owned by this participant)
  4. Close SendTransport (owned by this participant)
  5. Close RecvTransport (owned by this participant)
  6. Remove participant from room.participants Map
  7. If room empty → close Router, delete room

Common Mistakes:
  ❌ Close transport first → crashes (producers/consumers orphaned)
  ❌ Don't delete from Maps → memory leak (weak refs not enough)
  ❌ Don't remove event listeners → memory leak
  ✅ Close children first, then parents (bottom-up cleanup)
```

#### Implementation Highlights (RoomManager.ts)

```typescript
async removeParticipant(roomId: string, participantId: string): Promise<void> {
  const room = this.getRoom(roomId);
  if (!room) return;

  const participant = room.participants.get(participantId);
  if (!participant) return;

  // CRITICAL: Cleanup cascade (bottom-up)
  
  // 1. Close all consumers first (consuming from this participant)
  for (const consumer of participant.consumers.values()) {
    try {
      consumer.close();
    } catch (error) {
      logger.error('Error closing consumer:', { consumerId: consumer.id, error });
    }
  }
  participant.consumers.clear();

  // 2. Close all producers
  for (const producer of participant.producers.values()) {
    try {
      producer.close();
    } catch (error) {
      logger.error('Error closing producer:', { producerId: producer.id, error });
    }
  }
  participant.producers.clear();

  // 3. Close transports (after producers/consumers)
  if (participant.sendTransport) {
    try {
      participant.sendTransport.close();
    } catch (error) {
      logger.error('Error closing send transport:', error);
    }
  }

  if (participant.recvTransport) {
    try {
      participant.recvTransport.close();
    } catch (error) {
      logger.error('Error closing recv transport:', error);
    }
  }

  // 4. Remove participant from Map
  room.participants.delete(participantId);

  // Publish event to Redis (multi-node coordination)
  await this.publishEvent({
    type: 'participant-left',
    roomId,
    participantId,
    timestamp: Date.now(),
  });

  logger.info('Participant left room', {
    roomId,
    participantId,
    remainingParticipants: room.participants.size,
  });

  // Close room if empty
  if (room.participants.size === 0) {
    await this.closeRoom(roomId);
  }
}
```

---

### 15.3. SignalingServer (Socket.IO)

#### Socket Events Flow

```yaml
1. Join Room:
   Client → join-room { roomId, participantId, name }
   Server → room-joined { participants[], rtpCapabilities }
   Server → Broadcast to others: participant-joined { participantId, name }

2. Create Transport (Send):
   Client → create-transport { direction: 'send' }
   Server → transport-created { transportId, iceParameters, iceCandidates, dtlsParameters }

3. Connect Transport:
   Client → connect-transport { transportId, dtlsParameters }
   Server → transport-connected {}

4. Produce Media:
   Client → produce { transportId, kind, rtpParameters }
   Server → produced { producerId }
   Server → Broadcast to others: new-producer { producerId, participantId, kind }

5. Consume Media (from existing producer):
   Client → consume { producerId, rtpCapabilities }
   Server → Check Router.canConsume()
   Server → consumed { consumerId, kind, rtpParameters, producerPaused }

6. Resume Consumer:
   Client → resume-consumer { consumerId }
   Server → consumer-resumed {}
   → Media starts flowing

7. Leave Room:
   Client → leave-room { roomId }
   Server → Cleanup participant
   Server → Broadcast: participant-left { participantId }
```

#### Error Handling

```typescript
// Example: consume event with comprehensive error handling
socket.on('consume', async (data, callback) => {
  try {
    const { producerId, rtpCapabilities } = data;
    
    // Validate input
    if (!producerId || !rtpCapabilities) {
      return callback({
        error: 'Missing required fields: producerId, rtpCapabilities'
      });
    }

    // Get participant context
    const mapping = socketToParticipant.get(socket.id);
    if (!mapping) {
      return callback({ error: 'Participant not found' });
    }

    const room = roomManager.getRoom(mapping.roomId);
    if (!room) {
      return callback({ error: 'Room not found' });
    }

    // Check if can consume (RTP capabilities match)
    const canConsume = room.router.canConsume({ producerId, rtpCapabilities });
    
    if (!canConsume) {
      // Detailed error logging for debugging
      logger.error('❌ canConsume failed:', {
        producerId,
        roomId: mapping.roomId,
        participantId: mapping.participantId,
        clientRtpCapabilities: JSON.stringify(rtpCapabilities, null, 2),
        routerRtpCapabilities: JSON.stringify(room.router.rtpCapabilities, null, 2)
      });
      
      return callback({
        error: 'Cannot consume producer with given RTP capabilities',
        details: 'Codec mismatch or unsupported format'
      });
    }

    // Create consumer
    const consumer = await roomManager.createConsumer(
      mapping.roomId,
      mapping.participantId,
      producerId,
      rtpCapabilities
    );

    callback({
      consumerId: consumer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      producerPaused: consumer.producerPaused,
    });

  } catch (error: any) {
    logger.error('Error in consume event:', error);
    callback({
      error: error.message || 'Failed to consume producer'
    });
  }
});
```

---

## 16. AUDIO PROCESSING FOR STT

### 16.1. Current Status (TODO)

```yaml
Status: Partially Implemented
File: services/gateway/src/mediasoup/AudioProcessor.ts

What Works:
  ✅ AudioProcessor class structure
  ✅ WebSocket connection to STT service
  ✅ Buffer management (3s chunks)
  ✅ Event emission (transcription results)
  ✅ Graceful shutdown

What's Missing:
  ❌ RTP packet tap (Producer doesn't have 'rtp' event)
  ❌ Opus → PCM conversion
  ❌ Integration with RoomManager

Why Not Working Yet:
  MediaSoup v3 Producer API changed:
    - Old: producer.on('rtp', ...) event (doesn't exist in v3)
    - New: Use PlainTransport or custom RTP observer
```

### 16.2. Implementation Plan

#### Option 1: PlainTransport (Recommended)

```yaml
Concept: Create a PlainTransport to "shadow consume" audio

Architecture:
  Client → Producer (audio) → Router
                                 ↓
                          PlainTransport (RTP dump)
                                 ↓
                          AudioProcessor (PCM conversion)
                                 ↓
                          STT Service (WebSocket)

Steps:
  1. When participant produces audio:
     a. Create PlainTransport on same Router
     b. PlainTransport.consume(producerId)
     c. Bind PlainTransport to local UDP port
     d. AudioProcessor listens on UDP port for RTP packets
  
  2. RTP packets arrive at UDP port:
     a. Parse RTP header (sequence number, timestamp)
     b. Extract Opus payload
     c. Decode Opus → PCM 16kHz mono (libopus)
     d. Buffer PCM in 3s chunks
     e. Send to STT service via WebSocket
  
  3. STT returns transcription:
     a. AudioProcessor emits 'transcription' event
     b. SignalingServer broadcasts to room participants

Pros:
  - Official MediaSoup pattern (documented)
  - Reliable (no packet loss)
  - Supports encryption (SRTP)

Cons:
  - Requires local UDP port per audio producer (~100 ports max)
  - Extra process (RTP → UDP socket → AudioProcessor)
  - Opus decoding overhead (~5-10ms per chunk)
```

#### Option 2: Custom RtpObserver (Advanced)

```yaml
Concept: Custom C++ MediaSoup module to tap RTP packets

Architecture:
  Client → Producer (audio) → RtpObserver (custom)
                                     ↓
                              AudioProcessor (direct PCM)
                                     ↓
                              STT Service

Steps:
  1. Build custom MediaSoup RtpObserver module:
     a. C++ code to intercept RTP packets
     b. Decode Opus inline
     c. Emit PCM to Node.js via FFI/NAN
  
  2. Node.js receives PCM chunks:
     a. AudioProcessor buffers 3s
     b. Send to STT service

Pros:
  - Zero overhead (no extra sockets)
  - Direct access to RTP stream
  - Scales better (no port limits)

Cons:
  - Requires C++ development (complex)
  - Custom MediaSoup build (maintenance burden)
  - Not officially supported (can break on MediaSoup updates)

Decision: Use Option 1 (PlainTransport) for simplicity and maintainability
```

#### Implementation Code (Planned)

```typescript
// In AudioProcessor.ts

async startStreaming(
  roomId: string, 
  participantId: string, 
  producer: Producer,
  language: string = 'vi'
): Promise<void> {
  try {
    if (producer.kind !== 'audio') {
      return;
    }

    logger.info('🎤 Starting audio streaming to STT', {
      roomId,
      participantId,
      producerId: producer.id,
      language,
    });

    // Get Router from RoomManager
    const room = roomManager.getRoom(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    // Create PlainTransport for RTP dump
    const plainTransport = await room.router.createPlainTransport({
      listenIp: { ip: '127.0.0.1', announcedIp: null },
      rtcpMux: false,
      comedia: true, // Auto-detect source port
    });

    // Consume audio producer via PlainTransport
    const consumer = await plainTransport.consume({
      producerId: producer.id,
      rtpCapabilities: room.router.rtpCapabilities,
      paused: false,
    });

    logger.info('PlainTransport consuming audio', {
      transportId: plainTransport.id,
      consumerId: consumer.id,
      localPort: plainTransport.tuple.localPort,
    });

    // Start UDP listener for RTP packets
    const udpSocket = dgram.createSocket('udp4');
    udpSocket.bind(plainTransport.tuple.localPort);

    // Initialize buffer for this participant
    const streamBuffer: AudioStreamBuffer = {
      roomId,
      participantId,
      producerId: producer.id,
      buffer: [],
      sampleRate: 16000,
      channels: 1,
      lastProcessedAt: Date.now(),
    };
    this.activeStreams.set(participantId, streamBuffer);

    // Create WebSocket to STT service
    await this.createSTTWebSocket(roomId, participantId, language);

    // Handle incoming RTP packets
    udpSocket.on('message', (msg: Buffer) => {
      try {
        // Parse RTP packet
        const rtpPacket = parseRTPPacket(msg);
        
        // Extract Opus payload
        const opusData = rtpPacket.payload;

        // Decode Opus → PCM (using @discordjs/opus or node-opus)
        const pcmData = opusDecoder.decode(opusData, 480); // 480 samples = 10ms at 48kHz

        // Resample 48kHz → 16kHz (Sherpa expects 16kHz)
        const pcm16k = resample(pcmData, 48000, 16000);

        // Buffer PCM
        streamBuffer.buffer.push(pcm16k);

        // Check if we have 3 seconds buffered
        const totalSamples = streamBuffer.buffer.reduce((acc, buf) => acc + buf.length, 0);
        const duration = totalSamples / 16000; // 16kHz sample rate

        if (duration >= 3.0) {
          // Concatenate buffers
          const audioChunk = Buffer.concat(streamBuffer.buffer);
          
          // Send to STT service
          this.streamToSTT(participantId, audioChunk, roomId);
          
          // Reset buffer
          streamBuffer.buffer = [];
          streamBuffer.lastProcessedAt = Date.now();
        }

      } catch (error) {
        logger.error('Error processing RTP packet:', error);
      }
    });

    // Store transport và socket for cleanup
    this.plainTransports.set(participantId, { plainTransport, consumer, udpSocket });

    logger.info('✅ Audio streaming started', { participantId });

  } catch (error) {
    logger.error('Error starting audio streaming:', error);
    throw error;
  }
}
```

### 16.3. Dependencies Needed

```json
{
  "dependencies": {
    "@discordjs/opus": "^0.9.0",
    "node-opus": "^0.3.3",
    "audio-resampler": "^1.0.0"
  }
}
```

**Opus Decoder**:
- Library: `@discordjs/opus` (well-maintained, Discord.js team)
- Function: Decode Opus frames → PCM samples
- Performance: ~1-2ms per 10ms frame (fast enough)

**Resampler**:
- Library: `audio-resampler` or `libsamplerate` bindings
- Function: Resample 48kHz → 16kHz (Sherpa requirement)
- Performance: ~2-3ms per 3s chunk (negligible)

---

## 17. CLIENT-SIDE WEBRTC (Frontend)

### 17.1. mediasoup-client Setup

```typescript
// File: services/frontend/src/lib/mediasoup.ts

import * as mediasoupClient from 'mediasoup-client';
import { Device, Transport, Producer, Consumer } from 'mediasoup-client/lib/types';

export class MediasoupManager {
  private socket: Socket;
  private device?: Device;
  private sendTransport?: Transport;
  private recvTransport?: Transport;
  private producers: Map<string, Producer> = new Map();
  private consumers: Map<string, Consumer> = new Map();

  constructor(socket: Socket) {
    this.socket = socket;
  }

  async initialize(rtpCapabilities: any): Promise<void> {
    try {
      // Create mediasoup Device
      this.device = new mediasoupClient.Device();

      // Load Router RTP capabilities from server
      await this.device.load({ routerRtpCapabilities: rtpCapabilities });

      console.log('✅ Device loaded', {
        handlerName: this.device.handlerName,
        canProduce: {
          audio: this.device.canProduce('audio'),
          video: this.device.canProduce('video'),
        }
      });

    } catch (error) {
      console.error('Failed to initialize mediasoup device:', error);
      throw error;
    }
  }

  async createSendTransport(): Promise<void> {
    // Request server to create send transport
    const transportParams = await this.socket.emitWithAck('create-transport', {
      direction: 'send'
    });

    if (transportParams.error) {
      throw new Error(transportParams.error);
    }

    // Create local send transport
    this.sendTransport = this.device!.createSendTransport({
      id: transportParams.transportId,
      iceParameters: transportParams.iceParameters,
      iceCandidates: transportParams.iceCandidates,
      dtlsParameters: transportParams.dtlsParameters,
    });

    // Handle 'connect' event (DTLS handshake)
    this.sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await this.socket.emitWithAck('connect-transport', {
          transportId: this.sendTransport!.id,
          dtlsParameters,
        });
        callback();
      } catch (error: any) {
        errback(error);
      }
    });

    // Handle 'produce' event (client wants to send media)
    this.sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
      try {
        const { producerId } = await this.socket.emitWithAck('produce', {
          transportId: this.sendTransport!.id,
          kind,
          rtpParameters,
        });
        callback({ id: producerId });
      } catch (error: any) {
        errback(error);
      }
    });

    console.log('✅ Send transport created', { transportId: this.sendTransport.id });
  }

  async produceVideo(videoTrack: MediaStreamTrack): Promise<Producer> {
    if (!this.sendTransport) {
      throw new Error('Send transport not created');
    }

    const producer = await this.sendTransport.produce({
      track: videoTrack,
      codecOptions: {
        videoGoogleStartBitrate: 1000, // 1 Mbps initial bitrate
      },
    });

    this.producers.set(producer.id, producer);

    console.log('✅ Video producer created', { producerId: producer.id });

    return producer;
  }

  async produceAudio(audioTrack: MediaStreamTrack): Promise<Producer> {
    if (!this.sendTransport) {
      throw new Error('Send transport not created');
    }

    const producer = await this.sendTransport.produce({
      track: audioTrack,
      codecOptions: {
        opusStereo: false,
        opusDtx: true, // Discontinuous transmission (save bandwidth when silent)
      },
    });

    this.producers.set(producer.id, producer);

    console.log('✅ Audio producer created', { producerId: producer.id });

    return producer;
  }

  async createRecvTransport(): Promise<void> {
    // Similar to createSendTransport()
    // ...
  }

  async consume(producerId: string, participantId: string): Promise<MediaStreamTrack> {
    if (!this.recvTransport || !this.device) {
      throw new Error('Recv transport or device not ready');
    }

    // Request server to create consumer
    const consumerParams = await this.socket.emitWithAck('consume', {
      producerId,
      rtpCapabilities: this.device.rtpCapabilities, // CRITICAL: Send correct capabilities
    });

    if (consumerParams.error) {
      throw new Error(consumerParams.error);
    }

    // Create local consumer
    const consumer = await this.recvTransport.consume({
      id: consumerParams.consumerId,
      producerId,
      kind: consumerParams.kind,
      rtpParameters: consumerParams.rtpParameters,
    });

    this.consumers.set(consumer.id, consumer);

    // Resume consumer on server
    await this.socket.emitWithAck('resume-consumer', {
      consumerId: consumer.id,
    });

    console.log('✅ Consumer created và resumed', {
      consumerId: consumer.id,
      producerId,
      participantId,
    });

    return consumer.track;
  }
}
```

### 17.2. Common Client-Side Issues

**1. RTP Capabilities Mismatch**
```yaml
Symptom:
  - Router.canConsume() returns false on server
  - No video/audio received

Root Cause:
  - Client sends wrong/incomplete RTP capabilities
  - Client didn't call device.load() properly

Solution:
  1. Ensure server sends correct Router.rtpCapabilities
  2. Client calls device.load({ routerRtpCapabilities })
  3. Client sends device.rtpCapabilities (complete, validated)

Debug:
  - Log Router.rtpCapabilities on server
  - Log device.rtpCapabilities on client
  - Compare codecs (should match)
```

**2. Transport Not Connecting**
```yaml
Symptom:
  - Transport stuck in 'new' or 'connecting' state
  - No media flow

Root Cause:
  - DTLS parameters not sent correctly
  - ICE candidates unreachable (firewall/NAT)
  - Announced IP incorrect

Solution:
  1. Check server announced IP (34.143.235.114)
  2. Check client can reach UDP ports 40000-40019
  3. Enable TURN server fallback
  4. Log DTLS state changes

Debug:
  - transport.connectionState (should become 'connected')
  - Check browser console for ICE errors
  - Use chrome://webrtc-internals for debugging
```

**3. Producer Track Muted**
```yaml
Symptom:
  - Producer created but no audio/video transmitted
  - Remote participant sees black video or silent audio

Root Cause:
  - MediaStreamTrack.enabled = false
  - Camera/mic permission denied
  - Wrong device selected

Solution:
  1. Check track.readyState === 'live'
  2. Check track.enabled === true
  3. Verify getUserMedia() succeeded
  4. Test track in local <video> element first

Debug:
  - track.getSettings() (resolution, frameRate, deviceId)
  - producer.track.enabled (should be true)
  - producer.paused (should be false)
```

---

**Status**: Part 4 Complete ✅ | Sections 14-17 (WebRTC & Gateway) | ~2,000 lines
**Next**: Part 5 - Deployment & Operations
**Total TDD Lines**: ~8,300 lines (Part 1+2+3+4)

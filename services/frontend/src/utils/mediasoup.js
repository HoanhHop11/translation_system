/**
 * MediaSoup Client Utilities
 * 
 * Xử lý tất cả logic liên quan đến MediaSoup SFU:
 * - Device initialization
 * - Transport creation and management
 * - Producer/Consumer lifecycle
 */

import { Device } from 'mediasoup-client';

/**
 * Initialize MediaSoup Device với RTP capabilities từ Gateway
 */
export async function initializeDevice(routerRtpCapabilities) {
  const device = new Device();
  await device.load({ routerRtpCapabilities });
  console.log('✅ MediaSoup Device loaded');
  return device;
}

/**
 * Create Send Transport để produce local media
 */
export function createSendTransport(device, transportParams, socket, roomId) {
  const sendTransport = device.createSendTransport(transportParams);
  
  // Handle connect event
  sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
    try {
      console.log('🔌 Connecting send transport...');
      socket.emit('connect-webrtc-transport', {
        roomId,
        transportId: sendTransport.id,
        dtlsParameters
      }, (response) => {
        if (response?.error) {
          console.error('❌ Connect transport error:', response.error);
          errback(response.error);
        } else {
          console.log('✅ Send transport connected');
          callback();
        }
      });
    } catch (error) {
      console.error('❌ Connect transport failed:', error);
      errback(error);
    }
  });
  
  // Handle produce event
  sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
    try {
      console.log(`🎥 Producing ${kind}...`);
      socket.emit('produce', {
        roomId,
        transportId: sendTransport.id,
        kind,
        rtpParameters,
        appData
      }, (response) => {
        if (response?.error) {
          console.error('❌ Produce error:', response.error);
          errback(response.error);
        } else {
          console.log(`✅ ${kind} producer created:`, response.producerId);
          callback({ id: response.producerId });
        }
      });
    } catch (error) {
      console.error('❌ Produce failed:', error);
      errback(error);
    }
  });
  
  sendTransport.on('connectionstatechange', (state) => {
    console.log('📡 Send transport state:', state);
  });
  
  return sendTransport;
}

/**
 * Create Receive Transport để consume remote media
 */
export function createRecvTransport(device, transportParams, socket, roomId) {
  const recvTransport = device.createRecvTransport(transportParams);
  
  // Handle connect event
  recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
    try {
      console.log('🔌 Connecting recv transport...');
      socket.emit('connect-webrtc-transport', {
        roomId,
        transportId: recvTransport.id,
        dtlsParameters
      }, (response) => {
        if (response?.error) {
          console.error('❌ Connect transport error:', response.error);
          errback(response.error);
        } else {
          console.log('✅ Recv transport connected');
          callback();
        }
      });
    } catch (error) {
      console.error('❌ Connect transport failed:', error);
      errback(error);
    }
  });
  
  recvTransport.on('connectionstatechange', (state) => {
    console.log('📡 Recv transport state:', state);
  });
  
  return recvTransport;
}

/**
 * Produce video track
 */
export async function produceVideo(sendTransport, videoTrack, device) {
  if (!sendTransport || !videoTrack) {
    throw new Error('Send transport or video track not available');
  }
  
  // Force VP8 codec cho universal browser compatibility
  // VP8 được support bởi tất cả browsers (Chrome, Firefox, Safari)
  const codecOptions = {
    videoGoogleStartBitrate: 1000
  };
  
  const produceOptions = {
    track: videoTrack,
    encodings: [
      { maxBitrate: 100000, scaleResolutionDownBy: 4 },
      { maxBitrate: 300000, scaleResolutionDownBy: 2 },
      { maxBitrate: 900000, scaleResolutionDownBy: 1 }
    ],
    codecOptions,
    appData: { mediaType: 'video' }
  };
  
  // TEMPORARY DISABLE: VP8 forcing để test codec compatibility
  // Prefer VP8 codec nếu device và rtpCapabilities có sẵn
  // if (device && device.rtpCapabilities && device.rtpCapabilities.codecs) {
  //   const videoCodec = device.rtpCapabilities.codecs.find(
  //     codec => codec.mimeType.toLowerCase() === 'video/vp8'
  //   );
  //   
  //   if (videoCodec) {
  //     produceOptions.codec = videoCodec;
  //     console.log('🎥 Using VP8 codec for video');
  //   }
  // }
  
  const videoProducer = await sendTransport.produce(produceOptions);
  
  console.log('✅ Video producer created:', videoProducer.id);
  return videoProducer;
}

/**
 * Produce audio track
 */
export async function produceAudio(sendTransport, audioTrack) {
  if (!sendTransport || !audioTrack) {
    throw new Error('Send transport or audio track not available');
  }
  
  const audioProducer = await sendTransport.produce({
    track: audioTrack,
    appData: { mediaType: 'audio' }
  });
  
  console.log('✅ Audio producer created:', audioProducer.id);
  return audioProducer;
}

/**
 * Consume remote producer
 */
export async function consumeProducer(recvTransport, device, socket, roomId, producerId, participantId) {
  if (!recvTransport || !device) {
    console.warn('⚠️ Cannot consume: transport or device not ready');
    return null;
  }
  
  return new Promise((resolve, reject) => {
    socket.emit('consume', {
      roomId,
      producerId,
      rtpCapabilities: device.rtpCapabilities
    }, async (response) => {
      if (response?.error) {
        console.error('❌ Consume error:', response.error);
        reject(new Error(response.error.message || 'Consume failed'));
        return;
      }
      
      try {
        // Gateway trả về: { id, producerId, kind, rtpParameters }
        const { id: consumerId, kind, rtpParameters, producerPaused } = response;
        
        // Create consumer
        const consumer = await recvTransport.consume({
          id: consumerId,  // consumer.id từ Gateway
          producerId,      // producer.id để track
          kind,
          rtpParameters
        });
        
        console.log(`✅ Consumer created: ${kind} from ${participantId}`);
        
        // Resume consumer
        socket.emit('resume-consumer', { roomId, consumerId }, (resumeResponse) => {
          if (resumeResponse?.error) {
            console.error('❌ Resume consumer error:', resumeResponse.error);
          } else {
            console.log('✅ Consumer resumed:', consumerId);
          }
        });
        
        // Handle consumer events
        consumer.on('transportclose', () => {
          console.log('🔴 Consumer transport closed:', consumerId);
        });
        
        consumer.on('producerclose', () => {
          console.log('🔴 Producer closed for consumer:', consumerId);
        });
        
        consumer.on('producerpause', () => {
          console.log('⏸️ Producer paused for consumer:', consumerId);
        });
        
        consumer.on('producerresume', () => {
          console.log('▶️ Producer resumed for consumer:', consumerId);
        });
        
        resolve({ consumer, participantId, kind });
      } catch (error) {
        console.error('❌ Failed to create consumer:', error);
        reject(error);
      }
    });
  });
}

/**
 * Close producer
 */
export function closeProducer(producer) {
  if (producer && !producer.closed) {
    producer.close();
    console.log('✅ Producer closed:', producer.id);
  }
}

/**
 * Close consumer
 */
export function closeConsumer(consumer) {
  if (consumer && !consumer.closed) {
    consumer.close();
    console.log('✅ Consumer closed:', consumer.id);
  }
}

/**
 * Close transport
 */
export function closeTransport(transport) {
  if (transport && !transport.closed) {
    transport.close();
    console.log('✅ Transport closed:', transport.id);
  }
}

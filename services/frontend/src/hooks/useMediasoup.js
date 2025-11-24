import { useCallback, useRef, useState } from 'react';
import { Device } from 'mediasoup-client';

/**
 * MediaSoup Client Hook
 * Quản lý Device, Transports, Producers, và Consumers
 */
export const useMediasoup = (socket) => {
  const [isDeviceLoaded, setIsDeviceLoaded] = useState(false);
  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const producersRef = useRef(new Map()); // kind -> Producer
  const consumersRef = useRef(new Map()); // consumerId -> Consumer

  /**
   * Initialize MediaSoup Device
   */
  const loadDevice = useCallback(async () => {
    try {
      if (deviceRef.current) {
        console.log('⚠️ Device already loaded');
        return deviceRef.current;
      }

      console.log('🔧 Creating MediaSoup Device...');
      const device = new Device();

      // Get router RTP capabilities from server
      const rtpCapabilities = await new Promise((resolve, reject) => {
        socket.emit('get-router-rtp-capabilities', (response) => {
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response.rtpCapabilities);
          }
        });
      });

      console.log('📡 Loading device with RTP capabilities...');
      await device.load({ routerRtpCapabilities: rtpCapabilities });

      deviceRef.current = device;
      setIsDeviceLoaded(true);

      console.log('✅ MediaSoup Device loaded', {
        canProduceVideo: device.canProduce('video'),
        canProduceAudio: device.canProduce('audio'),
      });

      return device;
    } catch (error) {
      console.error('❌ Error loading device:', error);
      throw error;
    }
  }, [socket]);

  /**
   * Create Send Transport (for producing media)
   */
  const createSendTransport = useCallback(async () => {
    try {
      if (sendTransportRef.current) {
        console.log('⚠️ Send transport already exists');
        return sendTransportRef.current;
      }

      const device = deviceRef.current;
      if (!device) {
        throw new Error('Device not loaded');
      }

      console.log('🚀 Creating send transport...');

      // Request server to create transport
      const transportOptions = await new Promise((resolve, reject) => {
        socket.emit('create-webrtc-transport', { producing: true }, (response) => {
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response);
          }
        });
      });

      const sendTransport = device.createSendTransport(transportOptions);

      // Handle "connect" event
      sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await new Promise((resolve, reject) => {
            socket.emit('connect-webrtc-transport', {
              transportId: sendTransport.id,
              dtlsParameters,
            }, (response) => {
              if (response.error) {
                reject(new Error(response.error.message));
              } else {
                resolve();
              }
            });
          });
          callback();
        } catch (error) {
          errback(error);
        }
      });

      // Handle "produce" event
      sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
        try {
          const { id } = await new Promise((resolve, reject) => {
            socket.emit('produce', {
              transportId: sendTransport.id,
              kind,
              rtpParameters,
              appData,
            }, (response) => {
              if (response.error) {
                reject(new Error(response.error.message));
              } else {
                resolve(response);
              }
            });
          });
          callback({ id });
        } catch (error) {
          errback(error);
        }
      });

      sendTransportRef.current = sendTransport;
      console.log('✅ Send transport created:', sendTransport.id);

      return sendTransport;
    } catch (error) {
      console.error('❌ Error creating send transport:', error);
      throw error;
    }
  }, [socket]);

  /**
   * Create Receive Transport (for consuming media)
   */
  const createRecvTransport = useCallback(async () => {
    try {
      if (recvTransportRef.current) {
        console.log('⚠️ Recv transport already exists');
        return recvTransportRef.current;
      }

      const device = deviceRef.current;
      if (!device) {
        throw new Error('Device not loaded');
      }

      console.log('🚀 Creating recv transport...');

      const transportOptions = await new Promise((resolve, reject) => {
        socket.emit('create-webrtc-transport', { producing: false }, (response) => {
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response);
          }
        });
      });

      const recvTransport = device.createRecvTransport(transportOptions);

      // Handle "connect" event
      recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await new Promise((resolve, reject) => {
            socket.emit('connect-webrtc-transport', {
              transportId: recvTransport.id,
              dtlsParameters,
            }, (response) => {
              if (response.error) {
                reject(new Error(response.error.message));
              } else {
                resolve();
              }
            });
          });
          callback();
        } catch (error) {
          errback(error);
        }
      });

      recvTransportRef.current = recvTransport;
      console.log('✅ Recv transport created:', recvTransport.id);

      return recvTransport;
    } catch (error) {
      console.error('❌ Error creating recv transport:', error);
      throw error;
    }
  }, [socket]);

  /**
   * Produce media track (video or audio)
   */
  const produce = useCallback(async (track, appData = {}) => {
    try {
      const sendTransport = sendTransportRef.current;
      if (!sendTransport) {
        throw new Error('Send transport not created');
      }

      console.log(`🎥 Producing ${track.kind} track...`);

      const producer = await sendTransport.produce({
        track,
        appData,
      });

      producersRef.current.set(track.kind, producer);

      producer.on('trackended', () => {
        console.log(`🛑 ${track.kind} track ended`);
      });

      producer.on('transportclose', () => {
        console.log(`🔌 ${track.kind} transport closed`);
        producersRef.current.delete(track.kind);
      });

      console.log(`✅ ${track.kind} producer created:`, producer.id);

      return producer;
    } catch (error) {
      console.error(`❌ Error producing ${track.kind}:`, error);
      throw error;
    }
  }, []);

  /**
   * Consume remote producer
   */
  const consume = useCallback(async (producerId, appData = {}) => {
    try {
      const recvTransport = recvTransportRef.current;
      const device = deviceRef.current;

      if (!recvTransport || !device) {
        throw new Error('Recv transport or device not ready');
      }

      console.log('🔽 Consuming producer:', producerId);

      // Request server to create consumer
      const consumerOptions = await new Promise((resolve, reject) => {
        socket.emit('consume', {
          producerId,
          rtpCapabilities: device.rtpCapabilities,
        }, (response) => {
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response);
          }
        });
      });

      const consumer = await recvTransport.consume(consumerOptions);

      consumersRef.current.set(consumer.id, consumer);

      consumer.on('transportclose', () => {
        console.log('🔌 Consumer transport closed:', consumer.id);
        consumersRef.current.delete(consumer.id);
      });

      // Resume consumer (paused by default)
      await new Promise((resolve, reject) => {
        socket.emit('resume-consumer', { consumerId: consumer.id }, (response) => {
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve();
          }
        });
      });

      console.log('✅ Consumer created:', consumer.id, consumer.kind);

      return consumer;
    } catch (error) {
      console.error('❌ Error consuming:', error);
      throw error;
    }
  }, [socket]);

  /**
   * Close producer
   */
  const closeProducer = useCallback(async (kind) => {
    const producer = producersRef.current.get(kind);
    if (producer) {
      producer.close();
      producersRef.current.delete(kind);

      // Notify server
      socket.emit('close-producer', { producerId: producer.id });

      console.log(`🛑 ${kind} producer closed`);
    }
  }, [socket]);

  /**
   * Close all producers and transports
   */
  const cleanup = useCallback(() => {
    console.log('🧹 Cleaning up MediaSoup resources...');

    // Close all producers
    producersRef.current.forEach((producer) => {
      producer.close();
    });
    producersRef.current.clear();

    // Close all consumers
    consumersRef.current.forEach((consumer) => {
      consumer.close();
    });
    consumersRef.current.clear();

    // Close transports
    if (sendTransportRef.current) {
      sendTransportRef.current.close();
      sendTransportRef.current = null;
    }

    if (recvTransportRef.current) {
      recvTransportRef.current.close();
      recvTransportRef.current = null;
    }

    deviceRef.current = null;
    setIsDeviceLoaded(false);

    console.log('✅ MediaSoup cleanup complete');
  }, []);

  return {
    // State
    isDeviceLoaded,
    device: deviceRef.current,

    // Methods
    loadDevice,
    createSendTransport,
    createRecvTransport,
    produce,
    consume,
    closeProducer,
    cleanup,

    // Refs (for direct access)
    sendTransport: sendTransportRef.current,
    recvTransport: recvTransportRef.current,
    producers: producersRef.current,
    consumers: consumersRef.current,
  };
};

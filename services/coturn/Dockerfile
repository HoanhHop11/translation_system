FROM coturn/coturn:latest

# Copy configuration
COPY turnserver.conf /etc/coturn/turnserver.conf

# Expose ports
EXPOSE 3478 3478/udp
EXPOSE 5349 5349/tcp
EXPOSE 49152-65535/udp

CMD ["-c", "/etc/coturn/turnserver.conf"]

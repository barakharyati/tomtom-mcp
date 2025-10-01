# Use Node.js 22 Slim as base image
FROM node:22-slim

# Set working directory
WORKDIR /app

# Install ALL dependencies MapLibre needs in one go
RUN apt-get update && apt-get install -y \
    python3 make g++ pkg-config \
    libcurl4 libuv1 libpng16-16 libjpeg62-turbo libwebp7 libicu72 \
    libegl1 libgles2 libx11-6 libxext6 libstdc++6 zlib1g \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgif7 \
    libpixman-1-0 libbz2-1.0 \
    && rm -rf /var/lib/apt/lists/*



# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY rollup.config.js ./
COPY scripts ./scripts
# Copy source code
COPY src ./src
COPY bin ./bin

# Set environment variables
ENV LIBGL_ALWAYS_SOFTWARE=1

# # Add build-time dependencies for native modules (will be removed after build)
# RUN apk add --no-cache --virtual .build-deps \
#     python3-dev build-base \
#     git openssh-client

# Install dependencies with specific flags for Alpine
RUN npm install

# Make scripts executable
RUN chmod +x ./bin/tomtom-mcp.js ./bin/tomtom-mcp-http.js

# Build the application
RUN npm run build

# # Remove only build dependencies to reduce image size while keeping runtime dependencies
# RUN apk del .build-deps \
#     && npm cache clean --force \
#     && rm -rf /tmp/* \
#     # Create a directory for compatibility symlinks if necessary
#     && mkdir -p /lib64 \
#     && if [ ! -e /lib64/libbz2.so.1.0 ] && [ -e /usr/lib/libbz2.so.1.0 ]; then ln -s /usr/lib/libbz2.so.1.0 /lib64/libbz2.so.1.0; fi

# # Expose port
EXPOSE 3000

# Start the application
CMD ["node", "./bin/tomtom-mcp-http.js"]
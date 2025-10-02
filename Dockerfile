FROM docker.io/ubuntu:22.04

# Set working directory
WORKDIR /app

# Install Node.js 22 (NodeSource) and build toolchain
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Install necessary libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg-turbo8-dev libgif-dev librsvg2-dev \
    libpixman-1-dev libfreetype6-dev libfontconfig1-dev \
 && rm -rf /var/lib/apt/lists/*

# Runtime libs for @maplibre/maplibre-gl-native and canvas
RUN apt-get update && apt-get install -y --no-install-recommends \
  # GL/GLX + software renderer
  libopengl0 libglvnd0 libglx0 libgl1-mesa-glx libgl1-mesa-dri \
  # X11 libs commonly needed by GLX
  libx11-6 libxext6 libxrender1 libxcb1 \
  # Maplibre native deps
  libcurl4 libuv1 libwebp7 libpng16-16 zlib1g libbz2-1.0 libjpeg-turbo8 libicu70 \
  # Canvas runtimes
  libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgif7 librsvg2-2 \
  libpixman-1-0 libfreetype6 libfontconfig1 fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY rollup.config.js ./
COPY scripts ./scripts
# Copy source code
COPY src ./src
COPY bin ./bin

RUN npm install

# Make scripts executable
RUN chmod +x ./bin/*

# Build the application
RUN npm run build

# # Expose port
EXPOSE 3000

# Start the application
CMD ["node", "./bin/tomtom-mcp-http.js"]
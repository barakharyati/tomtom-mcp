FROM node:22-alpine

# Create app directory
WORKDIR /app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy built app
COPY dist/ ./dist/
COPY bin/ ./bin/

# Make the binaries executable
RUN chmod +x ./bin/tomtom-mcp-http.js

# Expose port for HTTP server (optional)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Run in HTTP mode using the executable script
CMD [ "./bin/tomtom-mcp-http.js" ]

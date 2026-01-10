
# Use Debian-based image for better compatibility with canvas build dependencies
FROM node:20-bookworm-slim

# Install system dependencies required for node-canvas
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy deps
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build
RUN npm run build

EXPOSE 3001

# Use dumb-init to handle signals correctly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["npm", "start"]

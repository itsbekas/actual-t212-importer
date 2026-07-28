FROM node:22-slim

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application
COPY . .

# Create a data directory
RUN mkdir -p /app/data

# Environment variables with defaults
ENV DATA_DIR=/app/data

CMD ["npm", "start"]

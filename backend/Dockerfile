FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for development)
RUN npm install

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Create src directory and set permissions
RUN mkdir -p /app/src && chown -R nextjs:nodejs /app

# Change to non-root user
USER nextjs

EXPOSE 4000

# Use nodemon for development, node for production
CMD ["npm", "run", "dev"]
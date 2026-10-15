FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies in case better-sqlite3 requires rebuild
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY public ./public
COPY products ./products

# Create directory for persistent SQLite database
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "dist/index.js"]

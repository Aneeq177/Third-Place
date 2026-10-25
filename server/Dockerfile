# Build context is the REPO ROOT (the server imports ../shared, ../mock and ./llm).
#   docker build -f server/Dockerfile .
FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching. server/ and server/llm/ have separate manifests.
COPY server/package.json server/package-lock.json server/
COPY server/llm/package.json server/llm/package-lock.json server/llm/
RUN cd server && npm ci && cd llm && npm ci

COPY server server
COPY shared shared
COPY mock mock

WORKDIR /app/server

ENV NODE_ENV=production \
    PORT=8787

# SerpApi cache is written here; mounted as a volume in docker-compose.yml.
RUN mkdir -p cache && chown -R node:node /app/server/cache
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]

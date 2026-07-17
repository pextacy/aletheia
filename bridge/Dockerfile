# node:20-slim is Debian (glibc), not Alpine (musl): better-sqlite3 ships glibc
# prebuilt binaries, so npm ci needs no python3/make/g++ toolchain to install.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Railway: mount a persistent volume at /data and set DB_PATH=/data/aletheia.sqlite
EXPOSE 8787
CMD ["node", "dist/index.js"]

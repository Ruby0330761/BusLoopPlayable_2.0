FROM node:22-bookworm-slim

ARG TARGETARCH

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates chromium-headless-shell ffmpeg fonts-liberation python3 \
  && CHROME_PATH="$(command -v chromium-headless-shell || command -v chromium)" \
  && test -n "${CHROME_PATH}" \
  && ln -sf "${CHROME_PATH}" /usr/local/bin/playable-chromium \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund \
  && node -e "require('esbuild').transformSync('const ready = true')" \
  && node -e "Promise.all([import('vite'), import('rollup')])" \
  && npm cache clean --force

COPY index.html vite.config.js ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public
COPY artifacts ./artifacts
COPY tools/spatial-conveyor-import-support ./tools/spatial-conveyor-import-support
COPY deploy-tools/build-verified-playable-packages ./deploy-tools/build-verified-playable-packages
RUN cp src/level-catalog.js artifacts/level-catalog.js \
  && PLAYABLE_REMOTE_EDITOR=1 npm run build

RUN node -e "const fs=require('node:fs');const path=require('node:path');const arch=process.env.TARGETARCH||process.arch;for(const name of ['@esbuild','@rollup']){const root=path.join('node_modules',name);for(const entry of fs.readdirSync(root)){if(!entry.includes('linux'))continue;const keep=entry.includes(arch==='amd64'?'x64':arch==='arm64'?'arm64':arch);if(!keep)fs.rmSync(path.join(root,entry),{recursive:true,force:true});}}" \
  && node -e "require('esbuild').transformSync('const ready = true')" \
  && node -e "Promise.all([import('vite'), import('rollup')])"

ENV PLAYABLE_REMOTE_EDITOR=1 \
    PLAYABLE_EXPORT_CONCURRENCY=1 \
    PLAYABLE_EXPORT_REMOTE_FAST=1 \
    PLAYABLE_CHROME_BIN=/usr/local/bin/playable-chromium \
    PLAYABLE_LEVEL_CATALOG_PATH=/app/artifacts/level-catalog.js \
    BUILD_VERIFIED_PLAYABLE_SKILL_ROOT=/app/deploy-tools/build-verified-playable-packages \
    NODE_OPTIONS=--max-old-space-size=256 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 5173
VOLUME ["/app/artifacts"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:5173/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "scripts/start-remote-editor.mjs"]

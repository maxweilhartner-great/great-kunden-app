# GR·EAT Video AI – alles in einem Container: Node, FFmpeg (mit libass), Whisper.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip python3-venv fonts-inter fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir faster-whisper pillow pillow-heif
ENV PATH="/opt/venv/bin:$PATH" PYTHON_PATH=/opt/venv/bin/python

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

# Whisper-Modell beim Bauen vorladen, damit der erste Upload nicht wartet
ARG WHISPER_MODEL=small
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')"

ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]

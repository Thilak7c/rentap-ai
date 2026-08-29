# backend-pipeline/Dockerfile

# Node 20 LTS — Debian-based (not alpine) so apt-get + canvas native deps work reliably
FROM node:20-bookworm-slim

# System dependencies:
# - poppler-utils: provides pdftoppm, required by pdfRasterize.js for the
#   Groq vision fallback path (scanned PDFs)
# - canvas build deps: defensive — pdfjs-dist can pull in `canvas` as an
#   optional transitive dependency (see package.json's `allowScripts`
#   entry); without these, `npm ci` can fail trying to compile it
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    python3 \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifest files first so npm ci is cached across builds when only
# source files change, not dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the rest of the backend source
COPY . .

# Cloud Run injects PORT at runtime — server.js already reads
# process.env.PORT with an 8080 fallback, so no hardcoded EXPOSE value
# is load-bearing, this is just documentation for humans/tools
EXPOSE 8080

CMD ["node", "server.js"]
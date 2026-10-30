# Single-service image: builds the React app, then serves it together with the API from FastAPI.
# Used by render.yaml. Secrets (ANTHROPIC_API_KEY, JWT_SECRET, …) come from the host's environment, never the image.

FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist /app/web
ENV WEB_DIR=/app/web
# Seed the demo data and train the traffic model at build time: training peaks above the free plan's 512 MB and is
# slow on its CPU, so doing it at start-up kept the port closed until Render gave up.
RUN python -m app.seed
EXPOSE 8000
# Seed only when the database is empty (e.g. a fresh persistent disk; keeps real reports across restarts), then serve.
CMD ["sh", "-c", "python -m app.seed --if-empty && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

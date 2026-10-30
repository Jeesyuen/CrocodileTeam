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
EXPOSE 8000
# Seed demo data only when the database is empty (keeps real reports across restarts), then serve.
CMD ["sh", "-c", "python -m app.seed --if-empty && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

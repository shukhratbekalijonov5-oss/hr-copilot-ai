# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# HR Copilot AI service
#
# Two stages: dependencies are built into a wheel-backed venv, then copied into
# a slim runtime image. No .env file and no secrets are baked in — all
# configuration arrives through the environment at run time.
# ---------------------------------------------------------------------------

FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# Build tooling for any package without a prebuilt wheel. Not present in the
# runtime stage, which keeps the final image smaller and its surface narrower.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# CPU-only torch: the GPU build pulls in ~2GB of CUDA libraries this service
# has no use for.
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --upgrade pip \
 && /opt/venv/bin/pip install \
      --extra-index-url https://download.pytorch.org/whl/cpu \
      -r requirements.txt


FROM python:3.12-slim AS runtime

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # Model weights are cached here; mount a volume to avoid re-downloading
    # ~1.6GB on every container start.
    HF_HOME=/models \
    AI_SERVICE_HOST=0.0.0.0 \
    AI_SERVICE_PORT=8000

COPY --from=builder /opt/venv /opt/venv

# Run as a non-root user.
RUN useradd --create-home --uid 10001 aiservice \
 && mkdir -p /models \
 && chown -R aiservice:aiservice /models

WORKDIR /app
COPY --chown=aiservice:aiservice app ./app

USER aiservice

EXPOSE 8000

# Liveness only — readiness depends on Qdrant, which the orchestrator should
# probe separately via /health/ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health/live', timeout=4).status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

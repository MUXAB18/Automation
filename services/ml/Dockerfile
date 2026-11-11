# Keyword intelligence service (FastAPI). Build context: services/ml
#   docker build -t automation-ml services/ml
FROM python:3.12-slim
WORKDIR /srv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ML_HOST=0.0.0.0 ML_PORT=8001 ML_MODEL_DIR=/srv/models
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
# Train the bootstrap model at build time so the first request is instant and the image is reproducible.
RUN python -m app.train
RUN useradd --system --uid 1001 app && chown -R app /srv
USER app
EXPOSE 8001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/health').status==200 else 1)"
# ML_SERVICE_TOKEN (24+ characters) is required at runtime.
CMD ["python", "-m", "app"]

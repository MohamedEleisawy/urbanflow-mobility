# Image de développement du microservice FastAPI.
FROM python:3.13-slim

WORKDIR /app

# Pas de fichiers .pyc, sortie non bufferisée (logs immédiats dans Docker).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY carbon-service/pyproject.toml ./
COPY carbon-service/app ./app
RUN pip install --no-cache-dir .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

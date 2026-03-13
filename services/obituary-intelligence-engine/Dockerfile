FROM python:3.11-slim

ENV POETRY_VIRTUALENVS_CREATE=false \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ARG ENABLE_SCRAPLING=false

WORKDIR /app

RUN pip install --no-cache-dir poetry==2.3.2

COPY services/obituary-intelligence-engine/pyproject.toml services/obituary-intelligence-engine/poetry.lock /app/
RUN poetry install --only main --no-root \
    && if [ "$ENABLE_SCRAPLING" = "true" ]; then \
         apt-get update \
         && apt-get install -y --no-install-recommends libnss3 libnspr4 \
         && rm -rf /var/lib/apt/lists/* \
         && python -m playwright install-deps firefox \
         && python -m rebrowser_playwright install chromium; \
       fi

COPY services/obituary-intelligence-engine/src /app/src
COPY services/obituary-intelligence-engine/nicknames.csv /app/nicknames.csv
COPY shared /app/shared

EXPOSE 8080

CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8080"]

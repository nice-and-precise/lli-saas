FROM python:3.11-slim

WORKDIR /app

COPY services/obituary-intelligence-engine/pyproject.toml /app/pyproject.toml
RUN pip install --no-cache-dir poetry && poetry config virtualenvs.create false && poetry install --no-root --only main

COPY services/obituary-intelligence-engine/src /app/src
COPY services/obituary-intelligence-engine/nicknames.csv /app/nicknames.csv
COPY shared /app/shared

EXPOSE 8080

CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8080"]

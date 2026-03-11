from fastapi import FastAPI

app = FastAPI(title="lead-engine", version="0.1.0")


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok", "service": "lead-engine"}


from fastapi import FastAPI

from src.contracts import CONTRACT_PATH

app = FastAPI(title="lead-engine", version="0.1.0")


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok", "service": "lead-engine"}


@app.get("/contract")
def contract() -> dict[str, str]:
    return {"contract_path": str(CONTRACT_PATH)}

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from typing import cast

from fastapi import HTTPException, Request

DEFAULT_ISSUER = "lli-saas-pilot"
DEFAULT_AUDIENCE = "lli-saas"


@dataclass(frozen=True)
class AuthContext:
    token: str
    claims: dict[str, object]

    @property
    def tenant_id(self) -> str:
        return str(self.claims["tenant_id"])


def parse_allowed_origins(raw_value: str | None = None) -> list[str]:
    origins = raw_value or os.getenv("AUTH_ALLOWED_ORIGINS") or ""
    return [origin.strip() for origin in origins.split(",") if origin.strip()]


def get_auth_settings() -> dict[str, str]:
    return {
        "jwt_secret": os.getenv("AUTH_JWT_SECRET", ""),
        "issuer": os.getenv("AUTH_JWT_ISSUER", DEFAULT_ISSUER),
        "audience": os.getenv("AUTH_JWT_AUDIENCE", DEFAULT_AUDIENCE),
    }


def _base64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(f"{segment}{padding}".encode())


def verify_jwt(
    token: str,
    *,
    audience: str | None = None,
    settings: dict[str, str] | None = None,
) -> dict[str, object]:
    resolved_settings = settings or get_auth_settings()
    secret = resolved_settings["jwt_secret"]
    if not secret:
        raise HTTPException(status_code=503, detail="AUTH_JWT_SECRET is required")

    try:
        header_segment, payload_segment, signature_segment = token.split(".")
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid bearer token") from exc

    signed_data = f"{header_segment}.{payload_segment}".encode()
    expected_signature = base64.urlsafe_b64encode(
        hmac.new(secret.encode("utf-8"), signed_data, hashlib.sha256).digest()
    ).rstrip(b"=")
    if not hmac.compare_digest(signature_segment.encode("utf-8"), expected_signature):
        raise HTTPException(status_code=401, detail="Invalid bearer token")

    try:
        header = cast(dict[str, object], json.loads(_base64url_decode(header_segment)))
        claims = cast(dict[str, object], json.loads(_base64url_decode(payload_segment)))
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid bearer token") from exc

    if header.get("alg") != "HS256":
        raise HTTPException(status_code=401, detail="Invalid bearer token")

    expected_audience = audience or resolved_settings["audience"]
    token_audience = claims.get("aud")
    audience_values = token_audience if isinstance(token_audience, list) else [token_audience]
    required_claims = ("sub", "role", "tenant_id", "aud", "iss", "exp")
    if any(not claims.get(claim) for claim in required_claims):
        raise HTTPException(status_code=401, detail="Invalid bearer token")
    if claims.get("iss") != resolved_settings["issuer"]:
        raise HTTPException(status_code=401, detail="Invalid bearer token")
    if expected_audience not in audience_values:
        raise HTTPException(status_code=401, detail="Invalid bearer token")

    exp_claim = claims["exp"]
    if not isinstance(exp_claim, int | str):
        raise HTTPException(status_code=401, detail="Invalid bearer token")

    try:
        expires_at = int(exp_claim)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid bearer token") from exc
    if expires_at <= int(time.time()):
        raise HTTPException(status_code=401, detail="Invalid bearer token")

    return claims


def get_auth_context(request: Request) -> AuthContext:
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme != "Bearer" or not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    claims = verify_jwt(token)

    requested_tenant_id = request.headers.get("x-tenant-id")
    if (
        requested_tenant_id
        and requested_tenant_id.strip()
        and requested_tenant_id.strip() != str(claims["tenant_id"])
    ):
        raise HTTPException(status_code=400, detail="x-tenant-id does not match authenticated tenant")

    return AuthContext(token=token, claims=claims)

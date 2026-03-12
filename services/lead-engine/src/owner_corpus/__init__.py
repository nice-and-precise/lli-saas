from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class OwnerRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    owner_id: str = Field(min_length=1)
    owner_name: str = Field(min_length=1)
    county: str | None = None
    state: str | None = None
    acres: float | None = None
    parcel_ids: list[str] = Field(default_factory=list)
    mailing_state: str | None = None
    crm_source: str = Field(min_length=1)
    raw_source_ref: str | None = None


class OwnerFetchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_id: str
    source_board: dict[str, str]
    owner_count: int = Field(ge=0)
    owners: list[OwnerRecord] = Field(default_factory=list)

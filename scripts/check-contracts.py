#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CONTRACT_DIR = ROOT / "shared" / "contracts"
LOCAL_PREFIX = "https://lli-saas.local/contracts/"


def iter_refs(node):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str):
                yield value
            else:
                yield from iter_refs(value)
    elif isinstance(node, list):
        for value in node:
            yield from iter_refs(value)


def main() -> int:
    schema_paths = sorted(CONTRACT_DIR.glob("*.json"))
    if not schema_paths:
        print("No contract schemas found.", file=sys.stderr)
        return 1

    ids_to_paths: dict[str, Path] = {}
    errors: list[str] = []

    for schema_path in schema_paths:
        try:
            payload = json.loads(schema_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"{schema_path}: invalid JSON ({exc})")
            continue

        schema_id = payload.get("$id")
        schema_type = payload.get("type")
        additional_properties = payload.get("additionalProperties")

        if not isinstance(schema_id, str) or not schema_id:
            errors.append(f"{schema_path}: missing non-empty $id")
        elif schema_id in ids_to_paths:
            errors.append(f"{schema_path}: duplicate $id already used by {ids_to_paths[schema_id]}")
        else:
            ids_to_paths[schema_id] = schema_path

        if schema_type != "object":
            errors.append(f"{schema_path}: root type must be 'object'")

        if additional_properties is not False:
            errors.append(f"{schema_path}: root additionalProperties must be false")

        for ref in iter_refs(payload):
            if ref.startswith(LOCAL_PREFIX) and ref not in ids_to_paths and ref != schema_id:
                # Delay resolution until all schema IDs have been collected.
                pass

    if not errors:
        for schema_path in schema_paths:
            payload = json.loads(schema_path.read_text(encoding="utf-8"))
            for ref in iter_refs(payload):
                if ref.startswith(LOCAL_PREFIX) and ref not in ids_to_paths:
                    errors.append(f"{schema_path}: unresolved local $ref {ref}")

    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1

    print(f"Validated {len(schema_paths)} shared contract schema(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

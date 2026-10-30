from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    token: str | None
    allow_no_auth: bool
    model_dir: Path

    @staticmethod
    def from_env() -> "Settings":
        token = os.environ.get("ML_SERVICE_TOKEN") or None
        allow = os.environ.get("ML_ALLOW_NO_AUTH") == "1"
        if token is None and not allow:
            raise RuntimeError(
                "ML_SERVICE_TOKEN is required (set ML_ALLOW_NO_AUTH=1 only for local development)"
            )
        if token is not None and len(token) < 24:
            raise RuntimeError("ML_SERVICE_TOKEN must be at least 24 characters")
        default_dir = Path(__file__).resolve().parent.parent / "models"
        return Settings(token=token, allow_no_auth=allow, model_dir=Path(os.environ.get("ML_MODEL_DIR", default_dir)))

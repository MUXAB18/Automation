from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

Keyword = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Intent = Literal["informational", "commercial", "transactional", "navigational", "local"]
MAX_KEYWORDS = 2000


class AnalyzeRequest(BaseModel):
    keywords: list[Keyword] = Field(min_length=1, max_length=MAX_KEYWORDS)
    similarity_threshold: float = Field(default=0.35, ge=0.05, le=0.95)


class KeywordIntent(BaseModel):
    keyword: str
    intent: Intent
    confidence: float


class ClusterOut(BaseModel):
    label: str
    intent: Intent
    size: int
    keywords: list[str]


class ModelInfo(BaseModel):
    version: str
    trained_at: str
    accuracy: float
    training_examples: int


class AnalyzeResponse(BaseModel):
    intents: list[KeywordIntent]
    clusters: list[ClusterOut]
    model: ModelInfo

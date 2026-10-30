"""HTTP API for the keyword models. The Node worker calls this; nothing here touches the database."""

from __future__ import annotations

import hmac
import logging
from contextlib import asynccontextmanager

import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException, status

from .clustering import cluster_keywords
from .config import Settings
from .intent import TrainedModel, load_or_train, normalize
from .schemas import AnalyzeRequest, AnalyzeResponse, ClusterOut, KeywordIntent, ModelInfo

log = logging.getLogger("ml")


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or Settings.from_env()
    state: dict[str, TrainedModel] = {}

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        state["model"] = load_or_train(cfg.model_dir)
        log.info("model ready: %s", state["model"].metrics["version"])
        yield

    app = FastAPI(title="Keyword intelligence", version="1.0.0", lifespan=lifespan, docs_url=None, redoc_url=None)

    def authorize(authorization: str | None = Header(default=None)) -> None:
        if cfg.token is None:  # only possible with ML_ALLOW_NO_AUTH=1
            return
        supplied = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
        # Constant-time comparison so the token cannot be guessed from response timing.
        if not hmac.compare_digest(supplied.encode(), cfg.token.encode()):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing token")

    @app.get("/health")
    def health() -> dict:
        model = state.get("model")
        return {"status": "ok" if model else "starting", "model": model.metrics["version"] if model else None}

    @app.post("/v1/keywords/analyze", response_model=AnalyzeResponse, dependencies=[Depends(authorize)])
    def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
        model = state["model"]
        clusters = cluster_keywords(request.keywords, request.similarity_threshold)
        terms = [k for c in clusters for k in c.keywords]
        proba = model.predict_proba(terms)
        classes = model.classes
        best = np.argmax(proba, axis=1)
        intents = [
            KeywordIntent(keyword=t, intent=classes[best[i]], confidence=round(float(proba[i, best[i]]), 4))
            for i, t in enumerate(terms)
        ]
        by_term = {normalize(k.keyword): i for i, k in enumerate(intents)}

        out: list[ClusterOut] = []
        for c in clusters:
            rows = [by_term[normalize(k)] for k in c.keywords]
            # A cluster's intent is the class with the most probability mass across its members.
            mass = proba[rows].sum(axis=0)
            out.append(ClusterOut(label=c.label, intent=classes[int(np.argmax(mass))], size=len(c.keywords), keywords=c.keywords))

        # The log never contains keywords: they are client data.
        log.info("analyzed %d keywords into %d clusters", len(terms), len(out))
        m = model.metrics
        return AnalyzeResponse(
            intents=intents,
            clusters=out,
            model=ModelInfo(version=m["version"], trained_at=m["trained_at"], accuracy=m["accuracy"], training_examples=m["training_examples"]),
        )

    return app

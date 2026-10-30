"""Search-intent classifier: TF-IDF (words + characters) -> logistic regression."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.pipeline import FeatureUnion, Pipeline

from .training_data import INTENTS, TEST_SET, generate

MODEL_VERSION = "intent-tfidf-lr-1"


def normalize(term: str) -> str:
    return " ".join(term.lower().split())


def build_pipeline() -> Pipeline:
    return Pipeline(
        [
            (
                "features",
                FeatureUnion(
                    [
                        ("words", TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=1)),
                        ("chars", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), sublinear_tf=True)),
                    ]
                ),
            ),
            ("clf", LogisticRegression(C=8.0, max_iter=2000, random_state=0)),
        ]
    )


@dataclass
class TrainedModel:
    pipeline: Pipeline
    metrics: dict

    @property
    def classes(self) -> list[str]:
        return list(self.pipeline.classes_)

    def predict(self, terms: list[str]) -> list[tuple[str, float]]:
        """(intent, confidence) per term, in order."""
        proba = self.pipeline.predict_proba([normalize(t) for t in terms])
        best = np.argmax(proba, axis=1)
        return [(self.classes[i], float(proba[row, i])) for row, i in enumerate(best)]

    def predict_proba(self, terms: list[str]) -> np.ndarray:
        return self.pipeline.predict_proba([normalize(t) for t in terms])


def train(extra_rows: list[tuple[str, str]] | None = None) -> TrainedModel:
    """
    Train on generated bootstrap data plus any real labelled rows, then score on the held-out TEST_SET
    (topics the model never saw). Real rows are never allowed to leak into the test set.
    """
    rows = generate()
    for keyword, intent in extra_rows or []:
        if intent in INTENTS and normalize(keyword):
            rows.append((normalize(keyword), intent))
    test_terms = {normalize(t) for t, _ in TEST_SET}
    rows = [(t, y) for t, y in rows if normalize(t) not in test_terms]

    x_train = [normalize(t) for t, _ in rows]
    y_train = [y for _, y in rows]
    pipeline = build_pipeline().fit(x_train, y_train)

    x_test = [normalize(t) for t, _ in TEST_SET]
    y_test = [y for _, y in TEST_SET]
    predicted = pipeline.predict(x_test)
    metrics = {
        "version": MODEL_VERSION,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "training_examples": len(rows),
        "real_examples": len(extra_rows or []),
        "test_examples": len(TEST_SET),
        "accuracy": round(float(accuracy_score(y_test, predicted)), 4),
        "macro_f1": round(float(f1_score(y_test, predicted, average="macro")), 4),
        "classes": [str(c) for c in pipeline.classes_],
    }
    return TrainedModel(pipeline=pipeline, metrics=metrics)


def save(model: TrainedModel, directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    joblib.dump(model.pipeline, directory / "intent.joblib")
    (directory / "intent.metrics.json").write_text(json.dumps(model.metrics, indent=2))


def load(directory: Path) -> TrainedModel | None:
    model_file, metrics_file = directory / "intent.joblib", directory / "intent.metrics.json"
    if not model_file.exists() or not metrics_file.exists():
        return None
    return TrainedModel(pipeline=joblib.load(model_file), metrics=json.loads(metrics_file.read_text()))


def load_or_train(directory: Path) -> TrainedModel:
    """Load the saved model, or train the bootstrap one (about a second) the first time."""
    model = load(directory)
    if model is None:
        model = train()
        save(model, directory)
    return model

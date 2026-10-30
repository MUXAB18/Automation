"""Train the intent model: `python -m app.train [labels.csv]`.

labels.csv (optional) has two columns, keyword,intent, with human-checked labels. They are added to the
generated bootstrap examples so the model improves as people correct it.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

import os
from .intent import save, train


def main() -> None:
    extra: list[tuple[str, str]] = []
    if len(sys.argv) > 1:
        with open(sys.argv[1], newline="", encoding="utf-8") as handle:
            extra = [(row["keyword"], row["intent"]) for row in csv.DictReader(handle)]
    model = train(extra)
    directory = Path(os.environ.get("ML_MODEL_DIR") or Path(__file__).resolve().parent.parent / "models")
    save(model, directory)
    for key, value in model.metrics.items():
        print(f"{key}: {value}")
    print(f"saved to {directory}")


if __name__ == "__main__":
    main()

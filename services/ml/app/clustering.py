"""Group keywords that mean the same thing, deterministically and without any downloads."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.cluster import AgglomerativeClustering
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from .intent import normalize

# Words that carry intent but not topic: ignored when judging whether two keywords are about the same thing.
MODIFIERS = {
    "best", "top", "cheap", "buy", "price", "prices", "cost", "review", "reviews", "how", "to", "what", "is",
    "the", "a", "an", "of", "for", "in", "near", "me", "online", "free", "vs", "and", "2026", "2025",
}


@dataclass
class Cluster:
    label: str
    keywords: list[str]
    indices: list[int]


def stem(word: str) -> str:
    """Tiny suffix stripper so forwarder/forwarding/forwards meet; no dictionary or download needed."""
    for suffix in ("ing", "ers", "er", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 4:
            return word[: -len(suffix)]
    return word


def topic_text(term: str) -> str:
    words = [stem(w) for w in normalize(term).split() if w not in MODIFIERS]
    return " ".join(words) or normalize(term)


def cluster_keywords(terms: list[str], similarity_threshold: float = 0.35) -> list[Cluster]:
    """
    Agglomerative clustering on TF-IDF (word + character) vectors of each keyword's TOPIC words.
    Two keywords join a cluster when their average cosine similarity to it is at least the threshold.
    The cluster label is its medoid: the keyword most similar to the others.
    Duplicates (after normalising) are merged. Output order is stable: biggest cluster first.
    """
    unique: list[str] = []
    seen: set[str] = set()
    for term in terms:
        key = normalize(term)
        if key and key not in seen:
            seen.add(key)
            unique.append(key)
    if not unique:
        return []
    if len(unique) == 1:
        return [Cluster(label=unique[0], keywords=unique, indices=[0])]

    topics = [topic_text(t) for t in unique]
    word_vec = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True).fit_transform(topics)
    char_vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True).fit_transform(topics)
    similarity = (cosine_similarity(word_vec) + cosine_similarity(char_vec)) / 2
    similarity = np.clip(similarity, 0.0, 1.0)
    distance = 1.0 - similarity
    np.fill_diagonal(distance, 0.0)

    model = AgglomerativeClustering(
        n_clusters=None,
        metric="precomputed",
        linkage="average",
        distance_threshold=1.0 - similarity_threshold,
    )
    labels = model.fit_predict(distance)

    clusters: list[Cluster] = []
    for cluster_id in sorted(set(labels)):
        members = [i for i, lab in enumerate(labels) if lab == cluster_id]
        sub = similarity[np.ix_(members, members)]
        medoid = members[int(np.argmax(sub.sum(axis=1)))] if len(members) > 1 else members[0]
        members.sort(key=lambda i: (i != medoid, unique[i]))
        clusters.append(Cluster(label=unique[medoid], keywords=[unique[i] for i in members], indices=members))
    clusters.sort(key=lambda c: (-len(c.keywords), c.label))
    return clusters

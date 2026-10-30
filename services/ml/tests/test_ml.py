import pytest
from fastapi.testclient import TestClient

from app.clustering import cluster_keywords
from app.config import Settings
from app.intent import load, save, train
from app.main import create_app

TOKEN = "t" * 32


@pytest.fixture(scope="module")
def model():
    return train()


@pytest.fixture()
def client(tmp_path, model):
    save(model, tmp_path)
    app = create_app(Settings(token=TOKEN, allow_no_auth=False, model_dir=tmp_path))
    with TestClient(app) as c:
        yield c


AUTH = {"Authorization": f"Bearer {TOKEN}"}


def test_generalises_to_unseen_topics(model):
    assert model.metrics["accuracy"] >= 0.85
    assert model.metrics["macro_f1"] >= 0.85


def test_predicts_obvious_intents(model):
    got = dict(zip(["how to bake bread", "plumber near me", "buy running shoes"], model.predict(["how to bake bread", "plumber near me", "buy running shoes"])))
    assert got["how to bake bread"][0] == "informational"
    assert got["plumber near me"][0] == "local"
    assert got["buy running shoes"][0] == "transactional"


def test_save_load_roundtrip(tmp_path, model):
    save(model, tmp_path)
    again = load(tmp_path)
    assert again is not None and again.predict(["trello login"]) == model.predict(["trello login"])


def test_real_labels_cannot_leak_into_test_set():
    m = train([("trello login", "commercial")])
    assert m.metrics["real_examples"] == 1


def test_clustering_groups_same_topic_and_dedupes():
    clusters = cluster_keywords(["freight forwarding", "Freight  Forwarding", "best freight forwarding", "dental implants", "dental implants cost"])
    sizes = sorted(len(c.keywords) for c in clusters)
    assert sizes == [2, 3] or sizes == [2, 2]
    assert sum(sizes) == 4
    assert cluster_keywords([]) == []


def test_clustering_is_deterministic():
    terms = ["seo audit", "seo audit tool", "yoga classes", "yoga class near me", "solar panels"]
    assert [c.keywords for c in cluster_keywords(terms)] == [c.keywords for c in cluster_keywords(terms)]


def test_health_open_but_analyze_needs_token(client):
    assert client.get("/health").json()["status"] == "ok"
    body = {"keywords": ["buy shoes"]}
    assert client.post("/v1/keywords/analyze", json=body).status_code == 401
    assert client.post("/v1/keywords/analyze", json=body, headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_analyze(client):
    r = client.post("/v1/keywords/analyze", headers=AUTH, json={"keywords": ["buy shoes online", "shoes price", "how to clean shoes", "plumber near me"]})
    assert r.status_code == 200
    data = r.json()
    assert len(data["intents"]) == 4
    assert sum(c["size"] for c in data["clusters"]) == 4
    assert {i["keyword"]: i["intent"] for i in data["intents"]}["plumber near me"] == "local"


@pytest.mark.parametrize("body", [{"keywords": []}, {"keywords": ["  "]}, {"keywords": ["x"], "similarity_threshold": 5}])
def test_validation(client, body):
    assert client.post("/v1/keywords/analyze", headers=AUTH, json=body).status_code == 422


def test_settings_require_token(monkeypatch):
    monkeypatch.delenv("ML_SERVICE_TOKEN", raising=False)
    monkeypatch.delenv("ML_ALLOW_NO_AUTH", raising=False)
    with pytest.raises(RuntimeError):
        Settings.from_env()
    monkeypatch.setenv("ML_SERVICE_TOKEN", "short")
    with pytest.raises(RuntimeError):
        Settings.from_env()


def test_clustering_merges_word_forms():
    clusters = cluster_keywords(["freight forwarding", "freight forwarder", "best freight forwarders", "yoga classes"])
    assert sorted(len(c.keywords) for c in clusters) == [1, 3]

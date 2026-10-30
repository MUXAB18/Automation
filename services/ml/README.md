# Keyword intelligence service (Python)

FastAPI service that classifies search intent and clusters keywords. The Node worker calls it over HTTP
(`createMlClient` in `@automation/integrations`); it never touches the database and logs no keywords.

## Run

```bash
npm run ml:install   # creates services/ml/.venv
npm run ml:train     # optional: trains and saves models/ (otherwise trained on first start, ~1s)
npm run ml:dev       # http://127.0.0.1:8001 (local dev, no token)
npm run ml:test
```

Production: set `ML_SERVICE_TOKEN` (24+ chars; the same value in the worker) and run
`python -m app` on the private network. Without a token the service refuses to start unless
`ML_ALLOW_NO_AUTH=1`.

## API

- `GET /health`
- `POST /v1/keywords/analyze` (Bearer token) `{keywords: string[1..2000], similarity_threshold?}` returns
  per-keyword intent + confidence, clusters (label = medoid keyword, intent = summed probability) and model info.

## Models

- Intent: TF-IDF (words + characters) into logistic regression; classes informational, commercial,
  transactional, navigational, local.
- Clustering: agglomerative, average linkage, on topic words with intent modifiers ("best", "buy", "near me") removed.

## Honest limits

The first model is trained on **generated** examples from phrase patterns, then scored on 50 hand-written
queries about unseen topics. Its score (100% on that small set) shows it learned the patterns, not that it
handles every real query. To improve it, export keywords with human-corrected intents as `keyword,intent` CSV and run
`cd services/ml && .venv/bin/python -m app.train labels.csv`. Clustering is lexical (no embeddings download), so it groups
keywords that share topic words, not synonyms.

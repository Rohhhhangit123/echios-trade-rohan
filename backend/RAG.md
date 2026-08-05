# Assistant RAG and citations

## Retrieval design

- **Embedding corpus:** only `data/**/*.csv`. JSON news is never embedded; it remains a
  deterministic ticker/date lookup.
- **Chunks:** minute-price CSVs become one document per ticker/day. Historical daily CSVs
  become seven-row weekly documents. Every document retains its source file and exact line range.
- **Embedding model:** `BAAI/bge-small-en-v1.5` through FastEmbed/ONNX. It is a local,
  384-dimensional English retrieval model; no embedding API receives repository data.
- **Search:** exact cosine similarity over 441 current documents. An approximate algorithm such
  as HNSW is unnecessary at this corpus size and would add index tuning and recall loss.
- **Finance reranking:** CSV return, range, volume, and recency metadata rerank semantically
  relevant candidates for directional and risk questions. The embedding model is not asked to
  perform numeric comparisons.
- **Persistence:** normalized vectors and metadata are stored in
  `backend/.cache/simulated_market_vectors.sqlite3`. A SHA-256 fingerprint automatically rebuilds
  the index when any CSV changes.

Build or refresh the index from the `backend` directory:

```powershell
.\venv\Scripts\python.exe -m scripts.build_market_vector_index
```

The model downloads on first use and is cached under `backend/.cache/models`.

## User data and SQLite migration

`AssistantUserRepository` is the boundary for private account data. The current
`SqlAlchemyAssistantUserRepository` reads the configured Supabase database and emits plain data
records plus exact table/primary-key citations. A future SQLite adapter only needs to implement
the same `load(client_id, include_history)` protocol; vector retrieval, prompting, citations, and
the frontend contract do not depend on Supabase.

## Citation contract

Each retrieved database row or simulated-data chunk receives a stable citation ID:

- `db:trades:16` identifies `trades.id = 16`.
- `csv:simulation_price_data...#L9362-L9751` identifies an exact CSV line range.
- JSON news IDs identify the source file and article index.

The LLM must return citation IDs beside every claim. The server discards unknown IDs, fills
missing factual citations from the matching retrieved section, and returns only referenced
citations. The frontend displays compact inline markers and an expandable locator list.

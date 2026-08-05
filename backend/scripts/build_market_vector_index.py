from __future__ import annotations

import json
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.market_vector_store import get_market_vector_store


if __name__ == "__main__":
    status = get_market_vector_store().ensure_index(force=True)
    print(json.dumps(status, indent=2))

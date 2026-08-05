from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


CitationSourceType = Literal["database", "csv", "json"]


@dataclass(frozen=True)
class CitationRecord:
    id: str
    source_type: CitationSourceType
    label: str
    detail: str
    table: str | None = None
    record_ids: list[int] = field(default_factory=list)
    source_file: str | None = None
    row_start: int | None = None
    row_end: int | None = None

    def as_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "source_type": self.source_type,
            "label": self.label,
            "detail": self.detail,
            "table": self.table,
            "record_ids": self.record_ids,
            "source_file": self.source_file,
            "row_start": self.row_start,
            "row_end": self.row_end,
        }

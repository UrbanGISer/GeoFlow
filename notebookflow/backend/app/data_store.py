"""In-memory DataFrame store, node result cache, and artifact paths."""

from __future__ import annotations

from collections import OrderedDict
from pathlib import Path

import pandas as pd


class DataStore:
    """Stores DataFrames by (node_id, output_handle); artifacts written to disk."""

    def __init__(self) -> None:
        self._frames: dict[str, pd.DataFrame] = {}

    def clear(self) -> None:
        self._frames.clear()

    def _key(self, node_id: str, output_handle: str = "df_out") -> str:
        return f"data://{node_id}/{output_handle}"

    def handle_df_out(self, node_id: str) -> str:
        return self._key(node_id, "df_out")

    def put_df(self, node_id: str, df: pd.DataFrame, output_handle: str = "df_out") -> str:
        key = self._key(node_id, output_handle)
        self._frames[key] = df
        return key

    def get_df_for_node(self, node_id: str) -> pd.DataFrame | None:
        """Return df_out for a node (default handle)."""
        return self._frames.get(self._key(node_id, "df_out"))

    def get_df_for_source(self, source_id: str, source_handle: str = "df_out") -> pd.DataFrame | None:
        """Return df for a specific (source_node, source_handle) edge endpoint."""
        key = self._key(source_id, source_handle)
        if key in self._frames:
            return self._frames[key]
        # Fall back to default df_out for nodes that only have one output
        return self._frames.get(self._key(source_id, "df_out"))

    def get_df_from_upstream(self, upstream_id: str) -> pd.DataFrame | None:
        return self.get_df_for_node(upstream_id)


class ResultCache:
    """LRU cache of node outputs keyed by content fingerprint.

    A fingerprint covers node code, params, source-file stats, and the
    upstream fingerprint chain, so a hit means "nothing that feeds this
    node has changed" and the stored result can be reused without executing.
    """

    def __init__(self, max_entries: int = 32, max_df_bytes: int = 256 * 1024 * 1024) -> None:
        self._entries: OrderedDict[str, tuple[pd.DataFrame | None, str | None, bytes | None]] = OrderedDict()
        self._max_entries = max_entries
        self._max_df_bytes = max_df_bytes

    def get(self, fingerprint: str) -> tuple[pd.DataFrame | None, str | None, bytes | None] | None:
        entry = self._entries.get(fingerprint)
        if entry is not None:
            self._entries.move_to_end(fingerprint)
        return entry

    def put(self, fingerprint: str, df: pd.DataFrame | None, html: str | None, img: bytes | None = None) -> None:
        if df is not None:
            try:
                if int(df.memory_usage(deep=False).sum()) > self._max_df_bytes:
                    return  # too large to keep around
            except Exception:  # noqa: BLE001
                pass
        self._entries[fingerprint] = (df, html, img)
        self._entries.move_to_end(fingerprint)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)

    def clear(self) -> None:
        self._entries.clear()

    def __len__(self) -> int:
        return len(self._entries)


def artifact_html_path(artifacts_dir: Path, node_id: str) -> Path:
    return artifacts_dir / f"{node_id}_html.html"


def write_html_artifact(artifacts_dir: Path, node_id: str, html: str) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    path = artifact_html_path(artifacts_dir, node_id)
    path.write_text(html, encoding="utf-8")
    return path


def artifact_img_path(artifacts_dir: Path, node_id: str) -> Path:
    return artifacts_dir / f"{node_id}_img.png"


def write_img_artifact(artifacts_dir: Path, node_id: str, img_bytes: bytes) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    path = artifact_img_path(artifacts_dir, node_id)
    path.write_bytes(img_bytes)
    return path

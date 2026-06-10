"""In-memory DataFrame store and artifact paths for workflow runs."""

from __future__ import annotations

from pathlib import Path

import pandas as pd


class DataStore:
    """Stores DataFrames by handle; artifacts written to disk."""

    def __init__(self) -> None:
        self._frames: dict[str, pd.DataFrame] = {}

    def clear(self) -> None:
        self._frames.clear()

    def handle_df_out(self, node_id: str) -> str:
        return f"data://{node_id}/df_out"

    def put_df(self, node_id: str, df: pd.DataFrame) -> str:
        handle = self.handle_df_out(node_id)
        self._frames[handle] = df
        return handle

    def get_df_for_node(self, node_id: str) -> pd.DataFrame | None:
        return self._frames.get(self.handle_df_out(node_id))

    def get_df_from_upstream(self, upstream_id: str) -> pd.DataFrame | None:
        return self.get_df_for_node(upstream_id)


def artifact_html_path(artifacts_dir: Path, node_id: str) -> Path:
    return artifacts_dir / f"{node_id}_html.html"


def write_html_artifact(artifacts_dir: Path, node_id: str, html: str) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    path = artifact_html_path(artifacts_dir, node_id)
    path.write_text(html, encoding="utf-8")
    return path

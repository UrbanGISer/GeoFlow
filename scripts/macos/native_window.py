#!/usr/bin/env python3
"""FlowX native window — WKWebView shell with FlowX dock icon (macOS)."""
from __future__ import annotations

import sys
from pathlib import Path


def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5173"
    icon = sys.argv[2] if len(sys.argv) > 2 else ""
    icon_path = icon if icon and Path(icon).is_file() else None

    import webview

    webview.create_window(
        "FlowX",
        url,
        width=1280,
        height=800,
        min_size=(960, 640),
    )
    webview.start(icon=icon_path)


if __name__ == "__main__":
    main()

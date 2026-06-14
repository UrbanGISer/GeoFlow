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

    # The duplicated second title line is the macOS window TAB BAR: a saved
    # "Show Tab Bar" preference (NSWindowTabbingShoudShowTabBarKey-… in the
    # python defaults domain) forces it on, and it renders one tab carrying
    # the window title. Purge the preference and disable window tabbing
    # before the window is created.
    try:
        from AppKit import NSWindow  # type: ignore[import]
        from Foundation import NSUserDefaults  # type: ignore[import]

        defaults = NSUserDefaults.standardUserDefaults()
        for key in list(defaults.dictionaryRepresentation().keys()):
            if str(key).startswith("NSWindowTabbingShoudShowTabBarKey"):
                defaults.removeObjectForKey_(key)
        NSWindow.setAllowsAutomaticWindowTabbing_(False)
    except Exception:
        pass

    win = webview.create_window(
        "FlowX AI Visual Notebook",
        url,
        width=1280,
        height=800,
        min_size=(960, 640),
    )

    def _fix_titlebar():
        """The duplicated second title line is the macOS window TAB BAR
        (NSTabBar) — the system remembers a 'Show Tab Bar' preference for the
        python process and renders one tab carrying the window title. Disable
        automatic window tabbing and collapse any visible tab bar. pywebview
        fires loaded callbacks in a background thread — AppHelper.callAfter
        dispatches the AppKit calls onto the main thread."""
        try:
            from AppKit import (  # type: ignore[import]
                NSApplication,
                NSWindow,
                NSWindowTabbingModeDisallowed,
            )
            from PyObjCTools import AppHelper  # type: ignore[import]

            def _on_main():
                try:
                    NSWindow.setAllowsAutomaticWindowTabbing_(False)
                except Exception:
                    pass
                for w in NSApplication.sharedApplication().windows():
                    try:
                        group = w.tabGroup()
                        if group is not None and group.isTabBarVisible():
                            w.toggleTabBar_(None)
                        if hasattr(w, "setTabbingMode_"):
                            w.setTabbingMode_(NSWindowTabbingModeDisallowed)
                        if hasattr(w, "setSubtitle_"):
                            w.setSubtitle_("")
                    except Exception:
                        pass

            AppHelper.callAfter(_on_main)
        except Exception:
            pass

    # loaded fires after every navigation; fix the titlebar each time.
    win.events.loaded += _fix_titlebar
    webview.start(icon=icon_path)


if __name__ == "__main__":
    main()

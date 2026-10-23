#!/usr/bin/env python3
"""Read-only DSH rendering smoke check; never imports a personal browser profile."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit


def local_url(value):
    parsed = urlsplit(value)
    if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
        raise argparse.ArgumentTypeError("Use a plain loopback HTTP URL without credentials, query or fragment")
    return value


def rendering_status(http_status, text, boot, rendered):
    if http_status == 401 or "dsh web authentication required" in text.lower():
        return "auth-required"
    if http_status is not None and 200 <= http_status < 300 and boot and rendered and text.strip():
        return "rendered"
    return "failed"


def run(url, output):
    from playwright.sync_api import sync_playwright

    output.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in (("desktop", 1440, 1000), ("mobile", 390, 844)):
                context = browser.new_context(viewport={"width": width, "height": height})
                try:
                    page = context.new_page()
                    response = page.goto(url, wait_until="networkidle", timeout=20000)
                    page.locator("body").wait_for(state="visible")
                    text = page.locator("body").inner_text()
                    boot = page.evaluate("typeof window.__DSH_BOOT__ === 'object' && window.__DSH_BOOT__ !== null")
                    rendered = page.locator("#root > *").count() > 0
                    status = rendering_status(response.status if response else None, text, boot, rendered)
                    page.screenshot(path=str(output / f"{name}.png"), full_page=True)
                    results.append({"viewport": name, "status": status,
                                    "http_status": response.status if response else None})
                finally:
                    context.close()
        finally:
            browser.close()
    report = {"scope": "rendering only; no chat submission, settings changes or model calls",
              "results": results}
    (output / "result.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if all(row["status"] == "rendered" for row in results) else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", type=local_url, default="http://127.0.0.1:3080")
    parser.add_argument("--output", type=Path, required=True,
                        help="Private local artifact directory; do not commit screenshots")
    args = parser.parse_args()
    return run(args.url, args.output)


if __name__ == "__main__":
    raise SystemExit(main())

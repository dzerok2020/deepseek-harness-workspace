import argparse
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "dsh_browser_smoke", Path(__file__).resolve().parents[1] / "tools/dsh-browser-smoke.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class LocalUrlTests(unittest.TestCase):
    def test_accepts_plain_loopback_urls(self):
        for url in ("http://127.0.0.1:3080", "http://localhost:3080/", "http://[::1]:3080"):
            self.assertEqual(smoke.local_url(url), url)

    def test_rejects_remote_and_credential_bearing_urls(self):
        for url in ("https://example.com", "file:///tmp/app.html", "http://localhost.example.com",
                    "http://user:secret@localhost:3080", "http://localhost:3080?token=secret",
                    "http://localhost:3080/#secret", "https://localhost:3080"):
            with self.subTest(url=url), self.assertRaises(argparse.ArgumentTypeError):
                smoke.local_url(url)


class RenderingStatusTests(unittest.TestCase):
    def test_rejects_auth_gate_as_success(self):
        self.assertEqual(smoke.rendering_status(401, "Login", True, True), "auth-required")
        self.assertEqual(smoke.rendering_status(200, "dsh web authentication required", False, False), "auth-required")

    def test_requires_successful_http_boot_and_rendered_content(self):
        self.assertEqual(smoke.rendering_status(200, "DSH", True, True), "rendered")
        for values in ((500, "Error", True, True), (200, "DSH", False, True),
                       (200, "DSH", True, False), (200, "  ", True, True)):
            with self.subTest(values=values):
                self.assertEqual(smoke.rendering_status(*values), "failed")


if __name__ == "__main__":
    unittest.main()

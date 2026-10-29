#!/usr/bin/env python3
"""Offline download API tests; only DNS, TCP, TLS and clock boundaries are mocked."""

import contextlib
import importlib.util
import io
import os
from pathlib import Path
import socket
import ssl
import stat
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "leanrea_public_https", ROOT / ".dsh/skills/leanrea/scripts/public_https.py"
)
network = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(network)
PUBLIC = "93.184.216.34"
HOST = "files.example.org"
URL = "https://" + HOST + "/package"


def answers(*addresses):
    return [(socket.AF_INET6 if ":" in ip else socket.AF_INET,
             socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (ip, 443))
            for ip in addresses]


def response(body=b"hello", status="200 OK", headers=()):
    lines = ["HTTP/1.1 " + status, "Content-Type: application/octet-stream"]
    lines.extend(headers)
    return ("\r\n".join(lines) + "\r\n\r\n").encode("ascii") + body


class Incoming(io.RawIOBase):
    def __init__(self, payload, on_read=None, read_size=8192):
        self.payload = io.BytesIO(payload)
        self.on_read, self.read_size = on_read, read_size

    def readable(self):
        return True

    def readinto(self, buffer):
        if self.on_read:
            self.on_read()
        data = self.payload.read(min(len(buffer), self.read_size))
        buffer[:len(data)] = data
        return len(data)


class Wire:
    """Socket boundary fixture: response parsing is real http.client code."""

    def __init__(self, payload, on_read=None, read_size=8192):
        self.incoming = Incoming(payload, on_read, read_size)
        self.sent = bytearray()
        self.peer = None
        self.timeouts = []
        self.closed = False
        self.handshakes = 0

    def settimeout(self, timeout):
        self.timeouts.append(timeout)

    def connect(self, peer):
        self.peer = peer

    def send(self, data):
        self.sent.extend(data)
        return len(data)

    def makefile(self, mode, buffering=-1):
        return self.incoming

    def do_handshake(self):
        self.handshakes += 1

    def close(self):
        self.closed = True


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.destination = Path(self.tmp.name) / "download"

    @contextlib.contextmanager
    def fixtures(self, replies=(), dns=None, handshake_error=None,
                 on_read=None, read_size=8192):
        self.wires = [Wire(reply, on_read, read_size) for reply in replies]
        self.tls = []
        real_context = ssl.create_default_context

        def context():
            value = real_context()

            def wrap(raw, *, server_hostname, do_handshake_on_connect):
                self.tls.append((value, server_hostname, do_handshake_on_connect))
                if handshake_error:
                    raw.do_handshake = mock.Mock(side_effect=handshake_error)
                return raw

            value.wrap_socket = wrap
            return value

        with contextlib.ExitStack() as stack:
            self.resolve = stack.enter_context(mock.patch.object(
                socket, "getaddrinfo", side_effect=dns or (lambda *a, **kw: answers(PUBLIC))
            ))
            self.sockets = stack.enter_context(mock.patch.object(
                socket, "socket", side_effect=self.wires
            ))
            stack.enter_context(mock.patch.object(ssl, "create_default_context", context))
            stack.enter_context(mock.patch.object(
                socket, "create_connection", side_effect=AssertionError("unpinned DNS")
            ))
            yield

    def rejected(self, url=URL, **kwargs):
        with self.assertRaises(network.DownloadError) as caught:
            network.download(url, self.destination, **kwargs)
        self.assertNotIn("secret", str(caught.exception))
        if self.destination.exists():
            self.assertLessEqual(self.destination.stat().st_size, kwargs.get("max_bytes", 67108864))
            self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o600)
        return str(caught.exception)

    def test_https_success_fixed_digest_mode_and_query_redaction(self):
        with self.fixtures([response(headers=["Content-Length: 5"])]):
            report = network.download(URL + "?token=secret", self.destination)
        self.assertEqual(self.destination.read_bytes(), b"hello")
        self.assertEqual(report, {
            "url": URL + "?[REDACTED]", "final_url": URL + "?[REDACTED]",
            "bytes": 5,
            "sha256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            "content_type": "application/octet-stream", "redirects": [],
        })
        self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o600)
        self.assertIn(b"GET /package?token=secret HTTP/1.1\r\n", self.wires[0].sent)

    def test_invalid_urls_are_refused_before_dns_or_file_creation(self):
        bad = ["http://files.example.org/", "ftp://files.example.org/", URL + "#",
               URL + "#secret", "https://user:secret@files.example.org/",
               "https://files.example.org:444/", "https://files.example.org:/",
               "https:///no-host", "https://", "https://files.example.org/\nsecret",
               URL + "/a b", URL + "/%zz", URL + "/%0dsecret", URL + "\\evil",
               "https://localhost/", "https://service.local/", "https://[::1",
               "https://files..example.org/", "https://[::1]@files.example.org/",
               "https://[2606:4700:4700::1111]suffix/",
               "https://[2606:4700:4700::1111]:443suffix/"]
        with self.fixtures():
            for url in bad:
                with self.subTest(url=url):
                    self.rejected(url)
                    self.assertFalse(self.destination.exists())
            self.resolve.assert_not_called()
            self.sockets.assert_not_called()

    def test_direct_private_local_reserved_and_transition_addresses(self):
        ips = ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1",
               "169.254.169.254", "100.64.0.1", "0.0.0.0", "192.0.2.1",
               "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1",
               "::1", "::", "fe80::1", "fc00::1", "ff02::1", "2001:db8::1",
               "::ffff:127.0.0.1", "2002:7f00:1::"]
        with self.fixtures():
            for ip in ips:
                with self.subTest(ip=ip):
                    self.rejected("https://" + ("[" + ip + "]" if ":" in ip else ip) + "/")
            self.resolve.assert_not_called()
            self.sockets.assert_not_called()

    def test_dns_private_and_mixed_public_private_are_refused(self):
        for values in [("127.0.0.1",), (PUBLIC, "10.0.0.1"), (PUBLIC, "::1"), ()]:
            with self.subTest(values=values), self.fixtures(dns=lambda *a, **kw: answers(*values)):
                self.rejected()
                self.sockets.assert_not_called()
            if self.destination.exists():
                self.destination.unlink()

    def test_dns_is_pinned_once_and_tls_verifies_original_hostname(self):
        def dns(*args, **kwargs):
            if self.resolve.call_count > 1:
                return answers("127.0.0.1")
            return answers(PUBLIC, "8.8.8.8")

        with self.fixtures([response()], dns=dns):
            network.download(URL, self.destination)
        self.assertEqual(self.resolve.call_count, 1)
        self.assertEqual(self.wires[0].peer, (PUBLIC, 443))
        self.assertEqual(self.wires[0].handshakes, 1)
        self.assertTrue(self.wires[0].closed)
        context, server_hostname, automatic_handshake = self.tls[0]
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertEqual(server_hostname, HOST)
        self.assertFalse(automatic_handshake)
        self.assertIn(b"Host: files.example.org\r\n", self.wires[0].sent)
        self.assertTrue(all(0 < value <= 60 for value in self.wires[0].timeouts))

    def test_ipv4_and_ipv6_public_literals_are_pinned_without_dns(self):
        for ip in ["8.8.8.8", "2606:4700:4700::1111"]:
            with self.subTest(ip=ip), self.fixtures([response()]):
                host = "[" + ip + "]" if ":" in ip else ip
                network.download("https://" + host + ":443/", self.destination)
                self.assertEqual(self.wires[0].peer[0], ip)
                self.assertEqual(self.tls[0][1], ip)
                self.resolve.assert_not_called()
            self.destination.unlink()

    def test_proxy_auth_and_cookies_are_not_inherited_or_forwarded(self):
        proxy = "http://user:secret@127.0.0.1:8080"
        with mock.patch.dict(os.environ, {
            "HTTPS_PROXY": proxy, "https_proxy": proxy, "ALL_PROXY": proxy,
            "all_proxy": proxy, "HTTP_PROXY": proxy, "http_proxy": proxy,
            "NETRC": "/does-not-exist/secret", "NO_PROXY": "",
        }), self.fixtures([
            response(b"", "302 Found", ["Location: https://other.example.org/new?secret=1",
                                          "Set-Cookie: secret=1"]), response()
        ]):
            report = network.download(URL + "?secret=old", self.destination)
        self.assertEqual(report["redirects"], ["https://other.example.org/new?[REDACTED]"])
        self.assertEqual(report["final_url"], "https://other.example.org/new?[REDACTED]")
        self.assertEqual([entry[1] for entry in self.tls], [HOST, "other.example.org"])
        for wire in self.wires:
            self.assertEqual(wire.peer, (PUBLIC, 443))
            sent = wire.sent.lower()
            self.assertNotIn(b"authorization:", sent)
            self.assertNotIn(b"cookie:", sent)
            self.assertNotIn(b"proxy-", sent)
            self.assertIn(b"accept-encoding: identity\r\n", sent)

    def test_private_redirect_is_refused_before_second_connection(self):
        for location in ["https://127.0.0.1/secret", "https://private.example.org/secret"]:
            with self.subTest(location=location), self.fixtures(
                [response(b"", "302 Found", ["Location: " + location])],
                dns=lambda host, *a, **kw: answers(PUBLIC if host == HOST else "10.0.0.1"),
            ):
                self.rejected()
                self.assertEqual(self.sockets.call_count, 1)
                self.assertEqual(self.destination.read_bytes(), b"")
            self.destination.unlink()

    def test_invalid_redirects_and_credential_downgrades_are_refused(self):
        locations = ["http://files.example.org/secret", "https://user:secret@files.example.org/",
                     "https://files.example.org:444/secret", "/next#", "/next#secret", "/next%0a",
                     "", "//127.0.0.1/secret", "\\127.0.0.1/secret"]
        for location in locations:
            with self.subTest(location=location), self.fixtures([
                response(b"", "302 Found", ["Location: " + location])
            ]):
                self.rejected()
                self.assertEqual(self.sockets.call_count, 1)
            self.destination.unlink()

    def test_relative_redirects_succeed_up_to_three(self):
        replies = [response(b"", "302 Found", ["Location: /next" + str(i) + "?secret=1"])
                   for i in range(3)] + [response()]
        with self.fixtures(replies):
            report = network.download(URL, self.destination)
        self.assertEqual(len(report["redirects"]), 3)
        self.assertEqual(report["final_url"], "https://files.example.org/next2?[REDACTED]")
        self.assertEqual(self.sockets.call_count, 4)

    def test_redirect_limit_and_missing_or_duplicate_location(self):
        cases = [[response(b"", "302 Found", ["Location: /loop"])] * 4,
                 [response(b"", "302 Found")],
                 [response(b"", "302 Found", ["Location: /a", "Location: /b"])]]
        for replies in cases:
            with self.subTest(count=len(replies)), self.fixtures(replies):
                self.rejected()
                self.assertLessEqual(self.sockets.call_count, 4)
            self.destination.unlink()

    def test_stream_limit_with_absent_lying_and_chunked_lengths(self):
        for headers, body in [([], b"abcdef"), (["Content-Length: 1"], b"abcdef"),
                              (["Transfer-Encoding: chunked"], b"6\r\nabcdef\r\n0\r\n\r\n")]:
            with self.subTest(headers=headers), self.fixtures([response(body, headers=headers)]):
                self.rejected(max_bytes=5)
                self.assertEqual(self.destination.read_bytes(), b"abcde")
            self.destination.unlink()

    def test_exact_stream_limit_succeeds_and_zero_length_is_valid(self):
        for body in [b"hello", b""]:
            with self.subTest(body=body), self.fixtures([response(body)]):
                report = network.download(URL, self.destination, max_bytes=5)
                self.assertEqual(report["bytes"], len(body))
                self.assertEqual(self.destination.read_bytes(), body)
            self.destination.unlink()

    def test_compression_and_ambiguous_or_oversized_framing_are_refused(self):
        cases = [["Content-Encoding: gzip"], ["Content-Encoding: br"],
                 ["Content-Encoding: identity, gzip"], ["Content-Length: 6"],
                 ["Content-Length: -1"], ["Content-Length: secret"],
                 ["Content-Length: 5", "Content-Length: 5"],
                 ["Transfer-Encoding: chunked", "Content-Length: 5"],
                 ["Transfer-Encoding: gzip, chunked"], ["Transfer-Encoding: gzip"]]
        for headers in cases:
            with self.subTest(headers=headers), self.fixtures([response(headers=headers)]):
                self.rejected(max_bytes=5)
                self.assertEqual(self.destination.read_bytes(), b"")
            self.destination.unlink()

    def test_short_content_length_and_broken_chunk_are_errors(self):
        for headers, body in [(["Content-Length: 5"], b"ab"),
                              (["Content-Length: 1"], b"ab"),
                              (["Transfer-Encoding: chunked"], b"5\r\nab"),
                              (["Transfer-Encoding: chunked"], b"secret\r\n")]:
            with self.subTest(headers=headers, body=body), self.fixtures([
                response(body, headers=headers)
            ]):
                self.rejected()
            self.destination.unlink()

    def test_http_protocol_errors_are_safe_and_close_connection(self):
        for reply in [response(b"secret", "403 secret"), b"secret\r\n",
                      b"HTTP/1.1 200 OK\r\n" + b"X: secret\r\n" * 101 + b"\r\n"]:
            with self.subTest(reply=reply[:30]), self.fixtures([reply]):
                self.rejected(URL + "?secret=1")
                self.assertTrue(self.wires[0].closed)
            self.destination.unlink()

    def test_tls_certificate_failure_is_not_retried_or_bypassed(self):
        with self.fixtures([response()], handshake_error=ssl.SSLCertVerificationError("secret")):
            self.rejected(URL + "?secret=1")
        self.assertEqual(self.sockets.call_count, 1)
        self.assertTrue(self.wires[0].closed)
        self.assertEqual(self.destination.read_bytes(), b"")
        self.assertTrue(self.tls[0][0].check_hostname)
        self.assertEqual(self.tls[0][0].verify_mode, ssl.CERT_REQUIRED)

    def test_dns_and_socket_errors_are_redacted_and_keep_bounded_partial(self):
        with self.fixtures(dns=mock.Mock(side_effect=OSError("secret"))):
            self.rejected(URL + "?secret=1")
            self.sockets.assert_not_called()
        self.destination.unlink()
        with self.fixtures([response()]):
            self.wires[0].connect = mock.Mock(side_effect=OSError("secret"))
            self.rejected(URL + "?secret=1")
            self.assertTrue(self.wires[0].closed)

    def test_dns_total_wall_timeout_is_bounded(self):
        release = threading.Event()
        finished = threading.Event()

        def slow_dns(*args, **kwargs):
            try:
                release.wait(2)
                return answers(PUBLIC)
            finally:
                finished.set()

        start = time.monotonic()
        try:
            with self.fixtures(dns=slow_dns):
                self.rejected(timeout=0.1)
                self.sockets.assert_not_called()
            self.assertLess(time.monotonic() - start, 0.8)
        finally:
            release.set()
            self.assertTrue(finished.wait(1))
        self.assertEqual(self.destination.read_bytes(), b"")

    def test_header_trickle_cannot_reset_total_wall_timeout(self):
        clock = [0.0]

        def tick():
            clock[0] += 0.6

        with mock.patch.object(time, "monotonic", side_effect=lambda: clock[0]), self.fixtures(
            [response()], on_read=tick, read_size=1
        ):
            self.rejected(timeout=1)
        self.assertTrue(self.wires[0].closed)
        self.assertLess(clock[0], 2)
        self.assertEqual(self.destination.read_bytes(), b"")

    def test_body_trickle_timeout_keeps_partial_and_socket_timeout_is_set(self):
        clock = [0.0]
        reads = [0]
        header_size = len(response(b""))

        def tick():
            reads[0] += 1
            if reads[0] > header_size:
                clock[0] += 0.4

        with mock.patch.object(time, "monotonic", side_effect=lambda: clock[0]), self.fixtures(
            [response()], on_read=tick, read_size=1
        ):
            self.rejected(timeout=1)
        self.assertEqual(self.destination.read_bytes(), b"he")
        self.assertGreater(len(self.wires[0].timeouts), header_size)
        self.assertLess(self.wires[0].timeouts[-1], 0.3)

    def test_socket_timeout_is_reported_safely(self):
        def fail():
            raise TimeoutError("secret")

        with self.fixtures([response()], on_read=fail):
            self.rejected(URL + "?secret=1", timeout=1)
        self.assertTrue(self.wires[0].closed)
        self.assertEqual(self.destination.read_bytes(), b"")

    def test_redirects_share_one_total_deadline(self):
        clock = [0.0]

        def tick():
            clock[0] += 0.6

        with mock.patch.object(time, "monotonic", side_effect=lambda: clock[0]), self.fixtures(
            [response(b"", "302 Found", ["Location: /next"]), response()], on_read=tick
        ):
            self.rejected(timeout=1)
        self.assertEqual(self.sockets.call_count, 2)
        self.assertEqual(self.destination.read_bytes(), b"")

    def test_existing_file_and_symlink_are_not_overwritten(self):
        self.destination.write_bytes(b"keep")
        original_mode = stat.S_IMODE(self.destination.stat().st_mode)
        with self.fixtures():
            with self.assertRaises(network.DownloadError):
                network.download(URL, self.destination)
            self.sockets.assert_not_called()
            self.resolve.assert_not_called()
        self.assertEqual(self.destination.read_bytes(), b"keep")
        self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), original_mode)
        link = Path(self.tmp.name) / "link"
        link.symlink_to(self.destination)
        with self.fixtures(), self.assertRaises(network.DownloadError):
            network.download(URL, link)
        self.assertTrue(link.is_symlink())
        self.assertEqual(self.destination.read_bytes(), b"keep")

    def test_hard_64_mib_limit_and_invalid_arguments(self):
        with self.fixtures():
            for value in [0, -1, 67108865, True, 1.5, "5"]:
                with self.subTest(max_bytes=value):
                    self.rejected(max_bytes=value)
            for value in [0, -1, True, float("inf"), float("nan"), "60"]:
                with self.subTest(timeout=value):
                    self.rejected(timeout=value)
            self.assertFalse(self.destination.exists())
            self.sockets.assert_not_called()
            self.resolve.assert_not_called()


if __name__ == "__main__":
    unittest.main()

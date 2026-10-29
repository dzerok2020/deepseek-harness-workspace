"""Small HTTPS downloader for untrusted public artifacts (standard library only).

The caller owns a private run directory. Failures keep an at-most-max_bytes,
0600 partial destination; callers must never treat that partial as a download.
"""

import hashlib
import http.client
import io
import ipaddress
import math
import os
import queue
import re
import socket
import ssl
import threading
import time
from urllib.parse import urljoin, urlsplit


_LIMIT = 67108864
_REDIRECTS = {301, 302, 303, 307, 308}


class DownloadError(Exception):
    """A safe-to-report rejection or download failure (never contains URL secrets)."""


def _remaining(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise DownloadError("total download timeout exceeded")
    return remaining


def _public(address):
    ip = ipaddress.ip_address(address)
    if (not ip.is_global or ip.is_private or ip.is_reserved or ip.is_loopback
            or ip.is_link_local or ip.is_multicast or ip.is_unspecified
            or (ip.version == 6 and (ip.ipv4_mapped or ip.sixtofour or ip.teredo))):
        raise DownloadError("nonpublic IP address refused")
    return ip


def _url(url):
    if (not isinstance(url, str) or not url or len(url) > 8192
            or any(ord(char) <= 32 or ord(char) >= 127 for char in url)
            or "#" in url or "\\" in url
            or re.search(r"%(?![0-9a-fA-F]{2})|%(?:0[0-9a-f]|1[0-9a-f]|7f)", url, re.I)):
        raise DownloadError("invalid URL")
    try:
        parts = urlsplit(url)
        host = parts.hostname
        if (parts.scheme != "https" or not host or parts.username is not None
                or parts.password is not None or "@" in parts.netloc
                or parts.port not in (None, 443) or parts.netloc.endswith(":")):
            raise ValueError
        host = host.lower().rstrip(".")
        if not host or "%" in host:
            raise ValueError
        try:
            literal = ipaddress.ip_address(host)
        except ValueError:
            literal = None
        if literal is not None:
            _public(host)
        elif (len(host) > 253 or "." not in host
              or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                     for label in host.split("."))
              or host.endswith((".localhost", ".local", ".localdomain", ".internal", ".home", ".lan"))):
            raise ValueError
    except (ValueError, UnicodeError):
        raise DownloadError("invalid HTTPS URL or hostname") from None
    target = (parts.path or "/") + ("?" + parts.query if parts.query else "")
    safe = url.split("?", 1)[0] + ("?[REDACTED]" if "?" in url else "")
    return host, target, safe, literal


def _address(host, literal, deadline):
    if literal is not None:
        family = socket.AF_INET6 if literal.version == 6 else socket.AF_INET
        return family, (str(literal), 443, 0, 0) if literal.version == 6 else (str(literal), 443)

    # getaddrinfo has no timeout. Only DNS runs in this daemon: after timeout it
    # may finish later, but it cannot connect, create a file or write anything.
    result = queue.Queue(maxsize=1)

    def resolve():
        try:
            value = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM,
                                       proto=socket.IPPROTO_TCP)
            result.put((True, value))
        except Exception:
            result.put((False, None))

    threading.Thread(target=resolve, daemon=True, name="leanrea-dns").start()
    try:
        ok, answers = result.get(timeout=_remaining(deadline))
    except queue.Empty:
        raise DownloadError("total download timeout exceeded during DNS") from None
    _remaining(deadline)
    if not ok or not answers:
        raise DownloadError("DNS resolution failed")
    validated = []
    for family, kind, protocol, _, sockaddr in answers:
        if family not in (socket.AF_INET, socket.AF_INET6):
            raise DownloadError("unsupported DNS address family")
        ip = _public(sockaddr[0])
        if (family == socket.AF_INET6) != (ip.version == 6):
            raise DownloadError("invalid DNS address")
        validated.append((family, (str(ip), 443, 0, 0) if ip.version == 6 else (str(ip), 443)))
    return validated[0]


class _Reader(io.RawIOBase):
    """Refresh the absolute deadline at every raw read, including HTTP headers."""

    def __init__(self, sock, deadline):
        self.sock, self.deadline = sock, deadline
        self.raw = sock.makefile("rb", buffering=0)

    def readable(self):
        return True

    def readinto(self, buffer):
        self.sock.settimeout(_remaining(self.deadline))
        return self.raw.readinto(buffer)

    def close(self):
        try:
            self.raw.close()
        finally:
            super().close()


class _Socket:
    def __init__(self, sock, deadline):
        self.sock, self.deadline = sock, deadline

    def makefile(self, mode):
        return io.BufferedReader(_Reader(self.sock, self.deadline))

    def sendall(self, data):
        data = memoryview(data)
        while data:
            self.sock.settimeout(_remaining(self.deadline))
            count = self.sock.send(data)
            if not count:
                raise DownloadError("HTTPS connection closed while sending")
            data = data[count:]

    def close(self):
        self.sock.close()


class _Connection(http.client.HTTPSConnection):
    def __init__(self, host, address, deadline, context):
        super().__init__(host, 443, timeout=_remaining(deadline), context=context)
        self.address, self.deadline = address, deadline

    def connect(self):
        family, address = self.address
        sock = socket.socket(family, socket.SOCK_STREAM, socket.IPPROTO_TCP)
        try:
            sock.settimeout(_remaining(self.deadline))
            sock.connect(address)  # Numeric validated address: no second DNS lookup.
            sock = self._context.wrap_socket(sock, server_hostname=self.host,
                                             do_handshake_on_connect=False)
            sock.settimeout(_remaining(self.deadline))
            sock.do_handshake()
            _remaining(self.deadline)
            self.sock = _Socket(sock, self.deadline)
        except BaseException:
            sock.close()
            raise


def download(url, destination, *, max_bytes=67108864, timeout=60) -> dict:
    """Download HTTPS to a NEW path; return redacted metadata, never credentials.

    All DNS answers must be public; the first is pinned for this connection.
    At most three HTTPS redirects are followed under the same wall deadline.
    max_bytes can reduce, never raise, the 64 MiB hard ceiling. No retries,
    proxy discovery, cookies, authentication or automatic partial-file deletion.
    """
    try:
        if (type(max_bytes) is not int or not 0 < max_bytes <= _LIMIT
                or isinstance(timeout, bool) or not isinstance(timeout, (int, float))
                or not math.isfinite(timeout) or timeout <= 0):
            raise DownloadError("invalid download limit or timeout")
        deadline = time.monotonic() + timeout
        original = current = _url(url)
        context = ssl.create_default_context()
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(destination, flags, 0o600)
        with os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            redirects = []
            while True:
                host, target, safe, literal = current
                address = _address(host, literal, deadline)
                connection = _Connection(host, address, deadline, context)
                try:
                    connection.request("GET", target, headers={
                        "Accept-Encoding": "identity", "Connection": "close",
                        "User-Agent": "LeanRea-static/1",
                    })
                    with connection.getresponse() as reply:
                        _remaining(deadline)
                        if reply.status in _REDIRECTS:
                            if len(redirects) >= 3:
                                raise DownloadError("redirect limit exceeded")
                            locations = reply.headers.get_all("Location", [])
                            if len(locations) != 1:
                                raise DownloadError("invalid redirect Location")
                            # Check the reference itself: urljoin discards empty
                            # fragments and strips leading control characters.
                            location = locations[0]
                            if (not location or "#" in location or "\\" in location
                                    or any(ord(c) <= 32 or ord(c) >= 127 for c in location)):
                                raise DownloadError("invalid redirect Location")
                            url = urljoin(url, location)
                            current = _url(url)
                            redirects.append(current[2])
                            continue
                        if reply.status != 200:
                            raise DownloadError("HTTPS server returned HTTP " + str(reply.status))
                        encodings = reply.headers.get_all("Content-Encoding", [])
                        if encodings and (len(encodings) != 1 or encodings[0].strip().lower() != "identity"):
                            raise DownloadError("compressed Content-Encoding refused")
                        lengths = reply.headers.get_all("Content-Length", [])
                        if lengths and (len(lengths) != 1 or not re.fullmatch(r"[0-9]+", lengths[0])
                                        or int(lengths[0]) > max_bytes):
                            raise DownloadError("invalid or oversized Content-Length")
                        transfers = reply.headers.get_all("Transfer-Encoding", [])
                        if transfers and (len(transfers) != 1 or transfers[0].strip().lower() != "chunked"
                                          or lengths):
                            raise DownloadError("unsupported or ambiguous HTTP framing")
                        # Connection: close lets us count to EOF, not trust a
                        # falsely small Content-Length as the stream boundary.
                        # Chunked responses retain http.client's chunk framing.
                        if not reply.chunked:
                            reply.length = None
                        digest = hashlib.sha256()
                        size = 0
                        while True:
                            _remaining(deadline)
                            chunk = reply.read1(min(65536, max_bytes - size + 1))
                            _remaining(deadline)
                            if not chunk:
                                break
                            room = max_bytes - size
                            output.write(chunk[:room])
                            digest.update(chunk[:room])
                            size += min(len(chunk), room)
                            if len(chunk) > room:
                                raise DownloadError("download byte limit exceeded")
                        if lengths and size != int(lengths[0]):
                            raise DownloadError("incomplete HTTPS response")
                        _remaining(deadline)
                        return {"url": original[2], "final_url": safe, "bytes": size,
                                "sha256": digest.hexdigest(),
                                "content_type": reply.getheader("Content-Type", ""),
                                "redirects": redirects}
                finally:
                    connection.close()
    except DownloadError:
        raise
    except Exception:
        # Never interpolate URLs, Location, paths or underlying exception text:
        # signed query parameters and server error messages may contain secrets.
        raise DownloadError("HTTPS download failed") from None

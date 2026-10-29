#!/usr/bin/env python3
"""Passive Hindsight checks; --functional opts into an LLM call (no stored memories)."""
import argparse
import json
from pathlib import Path
import stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


def unsafe_listeners(output, ports):
    unsafe = []
    for line in output.splitlines():
        fields = line.split()
        if len(fields) < 4:
            continue
        address = fields[3]
        host, _, port = address.rpartition(':')
        if port in ports and host not in ('127.0.0.1', '[::1]', '::1'):
            unsafe.append(address)
    return unsafe


def validate_extraction(response):
    facts = response.get('facts') if isinstance(response, dict) else None
    return isinstance(facts, list) and any(
        '45678' in json.dumps(fact) for fact in facts
    )


def provider_quota_deferred(error):
    """True when the daemon deferred extraction only because the upstream model
    was rate-limited. Loopback, permissions and the service itself are fine, so
    this must not read as a hard memory failure on every health run.

    Reads the error body once; never echoes it (it carries remote payload)."""
    try:
        body = error.read().decode('utf-8', 'replace')
    except Exception:
        return False
    return 'ProviderRateLimitResetError' in body or 'model_cooldown' in body


def describe_error(error):
    """Use only local labels and numeric status; never echo remote data."""
    if isinstance(error, urllib.error.HTTPError):
        code = error.code
        if code in (401, 403):
            category = 'xác thực/quyền truy cập'
        elif code in (404, 405):
            category = 'endpoint/phương thức không khớp'
        elif code == 429:
            category = 'giới hạn lượt gọi'
        elif code in (408, 504):
            category = 'timeout'
        elif 500 <= code < 600:
            category = 'dịch vụ/upstream'
        else:
            category = 'yêu cầu bị từ chối'
        return f'HTTP {code} — {category}'
    if isinstance(error, TimeoutError) or (
        isinstance(error, urllib.error.URLError) and isinstance(error.reason, TimeoutError)
    ):
        return 'timeout'
    if isinstance(error, urllib.error.URLError):
        return 'không kết nối được dịch vụ'
    if isinstance(error, (ValueError, UnicodeError)):
        return 'phản hồi không đúng JSON'
    if isinstance(error, OSError):
        return 'lỗi hệ thống/file cục bộ'
    return 'lỗi không xác định (không hiển thị payload)'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    functional = parser.add_mutually_exclusive_group()
    functional.add_argument('--functional', action='store_true',
                            help='call the extraction LLM (may incur provider costs; no stored memories)')
    functional.add_argument('--skip-functional', action='store_false', dest='functional',
                            help='compatibility alias for the passive default')
    parser.set_defaults(functional=False)
    args = parser.parse_args(argv)
    failures = []
    deferred = False
    stage = 'bảo vệ truy cập'
    env_file = Path.home() / '.hindsight/profiles/coding-agent.env'
    try:
        if stat.S_IMODE(env_file.stat().st_mode) & 0o077:
            failures.append('file cấu hình Hindsight cho phép group/other truy cập')
        result = subprocess.run(['ss', '-ltnH'], capture_output=True, text=True, check=True)
        exposed = unsafe_listeners(result.stdout, {'9077', '9999'})
        if exposed:
            failures.append('API bộ nhớ nghe ngoài loopback: ' + ', '.join(exposed))
        stage = 'kết nối'
        with urllib.request.urlopen('http://127.0.0.1:9077/health', timeout=10):
            pass
        if args.functional:
            stage = 'trích xuất LLM'
            bank = urllib.parse.quote('coding-agent::default-workspace', safe='')
            request = urllib.request.Request(
                'http://127.0.0.1:9077/v1/default/banks/' + bank + '/memories/dry-run-extract',
                data=json.dumps({
                    'content': 'The diagnostic sample project uses port 45678.',
                    'strategy': 'document',
                }).encode(),
                headers={'Content-Type': 'application/json'},
            )
            with urllib.request.urlopen(request, timeout=60) as response:
                extracted = json.load(response)
            if not validate_extraction(extracted):
                failures.append('trích xuất không trả về fact chứa giá trị thử 45678')
    except Exception as error:
        # Never print remote payloads or credential values.
        if stage == 'trích xuất LLM' and provider_quota_deferred(error):
            stage = 'trích xuất LLM (chờ quota provider)'
            deferred = stage
        else:
            failures.append(f'{stage} thất bại: {describe_error(error)}')
        if isinstance(error, urllib.error.HTTPError):
            error.close()
    for failure in failures:
        print('LỖI:', failure)
    if not args.functional:
        print('BỎ QUA: trích xuất LLM; dùng --functional để kiểm chứng (có thể phát sinh chi phí)')
    if not failures:
        if not args.functional:
            print('ĐẠT: /health, loopback và quyền file (kiểm tra thụ động, không gọi LLM)')
        elif deferred:
            print(
                'ĐẠT (một phần): loopback và quyền file; trích xuất LLM hoãn vì '
                'provider tạm hết quota — không phải lỗi bộ nhớ cục bộ'
            )
        else:
            print('ĐẠT: trích xuất LLM thật (không lưu dữ liệu), loopback và quyền file')
    return bool(failures)


if __name__ == '__main__':
    sys.exit(main())

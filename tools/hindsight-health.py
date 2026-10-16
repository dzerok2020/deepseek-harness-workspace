#!/usr/bin/env python3
"""Read-only Hindsight functional and local-exposure checks (no stored memories)."""
import json
from pathlib import Path
import stat
import subprocess
import sys
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
    facts = response.get('facts')
    return isinstance(facts, list) and any(
        '45678' in json.dumps(fact) for fact in facts
    )


def main():
    failures = []
    env_file = Path.home() / '.hindsight/profiles/coding-agent.env'
    try:
        if stat.S_IMODE(env_file.stat().st_mode) & 0o077:
            failures.append('file cấu hình Hindsight cho phép group/other truy cập')
        result = subprocess.run(['ss', '-ltnH'], capture_output=True, text=True, check=True)
        exposed = unsafe_listeners(result.stdout, {'9077', '9999'})
        if exposed:
            failures.append('API bộ nhớ nghe ngoài loopback: ' + ', '.join(exposed))
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
        failures.append('kiểm chứng chức năng thất bại: ' + type(error).__name__)
    for failure in failures:
        print('LỖI:', failure)
    if not failures:
        print('ĐẠT: trích xuất LLM thật (không lưu dữ liệu), loopback và quyền file')
    return bool(failures)


if __name__ == '__main__':
    sys.exit(main())

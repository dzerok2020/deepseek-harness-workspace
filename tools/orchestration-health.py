#!/usr/bin/env python3
"""Kiểm chứng CHỨC NĂNG chuỗi ChatGPT Web (shim + bridge) — chỉ đọc, timeout hữu hạn.

HTTP 200 một mình KHÔNG chứng minh chuỗi sống: shim phải báo mode browser-only,
bridge phải accepting_turns, và catalog phải chứa model pipeline dùng thật.
Không in payload (tránh lộ đường dẫn/nội dung).
"""
import json
import os
import sys
import urllib.request


from model_budgets import budget_errors, check_profile_budgets


def shim_ready(body):
    return body.get('status') == 'ok' and body.get('mode') == 'browser-only'


def bridge_ready(body):
    return body.get('accepting_turns') is True


def has_model(body, expected):
    entries = body.get('data')
    return isinstance(entries, list) and any(item.get('id') == expected for item in entries)


def fetch_json(url, timeout=5):
    request = urllib.request.Request(url, headers={'accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def main():
    shim_url = os.environ.get('CGW_SHIM_URL', 'http://127.0.0.1:17842')
    pipeline_model = os.environ.get('CGW_PIPELINE_MODEL', 'chatgpt-web/gpt-6-sol')
    failures = []
    try:
        shim = fetch_json(shim_url + '/healthz')
    except Exception as error:
        shim = None
        failures.append('shim /healthz khong dap ung JSON: ' + type(error).__name__)
    if shim is not None:
        if not shim_ready(shim):
            failures.append('shim chua san sang o mode browser-only (HTTP 200 chua du)')
        if shim.get('status') != 'ok':
            failures.append('shim /healthz khong co status=ok')
        bridge = str(shim.get('bridge', '')).rstrip('/')
        if bridge:
            try:
                health = fetch_json(bridge + '/healthz')
                if not bridge_ready(health):
                    failures.append('bridge chua accepting_turns — mo tab ChatGPT trong launcher roi chay lai (pipeline se fallback native)')
            except Exception as error:
                failures.append('bridge /healthz khong dap ung: ' + type(error).__name__)
        else:
            failures.append('shim /healthz thieu truong bridge')
        try:
            catalog = fetch_json(shim_url + '/v1/models')
            if not has_model(catalog, pipeline_model):
                failures.append('catalog shim thieu model pipeline: ' + pipeline_model)
        except Exception as error:
            failures.append('shim /v1/models khong dap ung: ' + type(error).__name__)
    profile_path = os.environ.get('DSH_WEB_CORDIS', os.path.expanduser('~/.dsh/profiles/web/cordis.patch.yml'))
    if os.path.exists(profile_path):
        for drift in check_profile_budgets(profile_path):
            failures.append('profile: ' + drift)
    else:
        failures.append('profile: khong thay file ' + profile_path)
    for failure in failures:
        print('LỖI:', failure)
    if not failures:
        print('ĐẠT: shim browser-only, bridge accepting_turns, catalog co ' + pipeline_model)
    return bool(failures)


if __name__ == '__main__':
    sys.exit(main())

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


def budget_errors(provider):
    """Ngân sách context phải tường minh và khớp default của route (128000/16384)."""
    errors = []
    default_window = provider.get('defaultContextWindow')
    default_max = provider.get('defaultMaxTokens')
    if default_window != 128000:
        errors.append('defaultContextWindow != 128000')
    if default_max != 16384:
        errors.append('defaultMaxTokens != 16384')
    for model in provider.get('models', []):
        if model.get('contextWindow') != default_window:
            errors.append(str(model.get('id')) + ': contextWindow khong khop route default')
        if model.get('maxTokens') != default_max:
            errors.append(str(model.get('id')) + ': maxTokens khong khop route default')
    return errors


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


def check_profile_budgets(path):
    """Đọc cordis.patch.yml thật, kiểm provider or/cgw có ngân sách 128000/16384 tường minh.

    GUI từng ghi đè file lúc 13:24 trả 1M/65000/131000 — kiểm định trực tiếp
    trên đĩa, không tin bản nhớ trong đầu tiến trình.
    """
    providers = {}
    current = None
    model = None
    with open(path, encoding='utf-8') as stream:
        for raw in stream:
            line = raw.rstrip('\n')
            stripped = line.strip()
            indent = len(line) - len(line.lstrip())
            if indent == 6 and stripped.endswith(':'):
                current = stripped[:-1] if stripped[:-1] in ('or', 'cgw') else None
                if current:
                    providers[current] = {'defaultContextWindow': None, 'defaultMaxTokens': None, 'models': []}
                model = None
            elif current is None or indent < 8:
                continue
            elif indent == 8 and ':' in stripped:
                key, _, value = stripped.partition(':')
                if key == 'defaultContextWindow':
                    providers[current]['defaultContextWindow'] = int(value)
                elif key == 'defaultMaxTokens':
                    providers[current]['defaultMaxTokens'] = int(value)
                elif key == 'models':
                    pass
            elif indent == 10 and stripped.startswith('- id:'):
                model = {'id': stripped[len('- id:'):].strip()}
                providers[current]['models'].append(model)
            elif indent == 12 and ':' in stripped and model is not None:
                key, _, value = stripped.partition(':')
                if key in ('contextWindow', 'maxTokens'):
                    try:
                        model[key] = int(value)
                    except ValueError:
                        pass
    if not providers:
        return ['khong thay provider or/cgw trong profile']
    errors = []
    for name, provider in providers.items():
        for message in budget_errors(provider):
            errors.append(name + ' -> ' + message)
    return errors


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

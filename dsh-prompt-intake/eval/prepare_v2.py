"""Load frozen offline candidates and prepare requests; never sends them."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUNDLE = ROOT / 'v2'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bundle():
    manifest = json.loads((BUNDLE / 'manifest.json').read_text())
    for name, expected in manifest['sha256'].items():
        if sha(BUNDLE / name) != expected:
            raise ValueError('Frozen artifact changed: ' + name)
    return {
        'manifest': manifest,
        'baseline': json.loads((BUNDLE / 'baseline.json').read_text()),
        'candidate': json.loads((BUNDLE / 'candidate.json').read_text()),
        'cases': json.loads((BUNDLE / 'cases.json').read_text()),
    }


def messages(bundle, variant, case):
    if variant not in ('baseline', 'candidate'):
        raise ValueError('Unknown variant')
    policy = bundle[variant]
    result = [{'role': 'system', 'content': policy['policy']}]
    for demo in policy['demos']:
        result.extend([
            {'role': 'user', 'content': demo['case']},
            {'role': 'assistant', 'content': demo['response']},
        ])
    public = {key: case[key] for key in ('id', 'prompt', 'context')}
    result.append({'role': 'user', 'content': json.dumps(public, ensure_ascii=False)})
    return result


if __name__ == '__main__':
    bundle = load_bundle()
    print(json.dumps({'status': bundle['manifest']['status'],
                      'cases': len(bundle['cases']), 'model_calls': 0}))

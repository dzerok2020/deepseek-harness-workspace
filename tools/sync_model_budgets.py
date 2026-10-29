#!/usr/bin/env python3
"""Preview/apply saved Settings budgets to the credential-free Git reference.

This never writes the live profile or calls a model. Apply requires the revision
returned by preview. Settings saved later require another explicit sync.
"""
import argparse
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile

import model_budgets as budgets


def _project(provider):
    if not isinstance(provider, dict):
        raise budgets.BudgetError('invalid provider budget mapping')
    result = {}
    for key in budgets.DEFAULTS:
        value = provider.get(key)
        if type(value) is not int or value <= 0:
            raise budgets.BudgetError('explicit positive integer provider budgets required; no inference')
        result[key] = value
    models = provider.get('models')
    if not isinstance(models, list) or not models:
        raise budgets.BudgetError('explicit model budgets required; no inference')
    result['models'] = []
    seen = set()
    for model in models:
        if not isinstance(model, dict):
            raise budgets.BudgetError('invalid model budget mapping')
        model_id = model.get('id')
        if not isinstance(model_id, str) or not model_id.strip() or any(c in model_id for c in '\r\n') or model_id in seen:
            raise budgets.BudgetError('invalid or duplicate model ID')
        seen.add(model_id)
        row = {'id': model_id}
        for key in budgets.FIELDS:
            value = model.get(key)
            if type(value) is not int or value <= 0:
                raise budgets.BudgetError('explicit positive integer model budgets required; no inference')
            row[key] = value
        result['models'].append(row)
    return result


def _reference(text):
    providers = budgets.read_providers(text)
    if not providers or not providers.keys() <= {'or', 'cgw'}:
        raise budgets.BudgetError('reference supports only or/cgw providers')
    clean = {name: _project(provider) for name, provider in providers.items()}
    expected = [{'id': 'llm-pi-ai', 'config': {'providers': clean}}]
    if budgets.yaml.load(text, Loader=budgets.UniqueLoader) != expected:
        raise budgets.BudgetError('reference must contain only provider/model IDs and budget fields')
    return clean


def synced_text(profile_text, policy_text):
    """Patch budget spans and append explicitly configured models; retain others."""
    try:
        for text in (profile_text, policy_text):
            if any(isinstance(event, budgets.yaml.AliasEvent) for event in budgets.yaml.parse(text)):
                raise budgets.BudgetError('YAML aliases are unsupported; use explicit budgets')
        source = budgets.read_providers(profile_text)
        previous = _reference(policy_text)
        expected = copy.deepcopy(previous)
        names = expected.keys() & source.keys()
        if not names:
            raise budgets.BudgetError('no matching supported provider')
        added = {}
        for name in names:
            incoming = _project(source[name])
            current = expected[name]
            for key in budgets.DEFAULTS:
                current[key] = incoming[key]
            by_id = {model['id']: model for model in current['models']}
            added[name] = []
            for model in incoming['models']:
                if model['id'] in by_id:
                    by_id[model['id']].update(model)
                else:
                    current['models'].append(model)
                    added[name].append(model)
        if expected == previous:
            return policy_text
        newline = '\r\n' if '\r\n' in policy_text else '\n'
        if newline == '\r\n' and '\n' in policy_text.replace('\r\n', ''):
            raise budgets.BudgetError('mixed newlines are unsupported')
        text = budgets.repaired_text(policy_text.replace('\r\n', '\n'), policy=expected)
        root = budgets.yaml.compose(text, Loader=budgets.UniqueLoader)
        def mapping(node):
            return {key.value: value for key, value in node.value}
        providers = mapping(mapping(mapping(root.value[0])['config'])['providers'])
        edits = []
        for name, models in added.items():
            if not models:
                continue
            node = mapping(providers[name])['models']
            position = len(text) if node.end_mark.index == len(text) else text.rfind('\n', 0, node.end_mark.index) + 1
            indent = ' ' * node.start_mark.column
            rows = ''.join(indent + '- id: ' + json.dumps(model['id'], ensure_ascii=False) + '\n' +
                           ''.join(indent + '  ' + key + ': ' + str(model[key]) + '\n' for key in budgets.FIELDS)
                           for model in models)
            prefix = '\n' if position and text[position - 1] != '\n' else ''
            edits.append((position, prefix + rows))
        for position, rows in sorted(edits, reverse=True):
            text = text[:position] + rows + text[position:]
        result = text.replace('\n', newline)
        if _reference(result) != expected:
            raise budgets.BudgetError('sync candidate failed validation')
        return result
    except (budgets.BudgetError, budgets.yaml.YAMLError, TypeError, AttributeError, KeyError, IndexError):
        # Parser excerpts can contain credentials: never forward their messages.
        raise budgets.BudgetError('sync refused: invalid/ambiguous YAML or missing explicit positive budgets') from None


def _signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _snapshot(path):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise budgets.BudgetError('sync requires regular non-symlink files')
        content = stream.read()
        if _signature(before) != _signature(os.fstat(stream.fileno())) or _signature(before) != _signature(path.lstat()):
            raise budgets.BudgetError('file changed while reading; preview again')
    return _signature(before), content


def _rows(text):
    rows = {}
    for name, provider in _reference(text).items():
        for field in budgets.DEFAULTS:
            rows[name, '', field] = provider[field]
        for model in provider['models']:
            for field in budgets.FIELDS:
                rows[name, model['id'], field] = model[field]
    return rows


def sync_files(profile, policy, apply=False, expected=None):
    profile, policy = Path(profile).absolute(), Path(policy).absolute()
    if profile.resolve() == policy.resolve():
        raise budgets.BudgetError('source and reference must be different files')
    source, reference = _snapshot(profile), _snapshot(policy)
    if source[0][:2] == reference[0][:2]:
        raise budgets.BudgetError('source and reference must be different files')
    revision = hashlib.sha256(source[1] + b'\0' + reference[1] + b'\0' +
                              json.dumps([source[0], reference[0]]).encode('utf-8')).hexdigest()
    if apply and expected != revision:
        raise budgets.BudgetError('preview revision missing or stale; preview again')
    candidate = synced_text(source[1].decode('utf-8'), reference[1].decode('utf-8'))
    old, new = _rows(reference[1].decode('utf-8')), _rows(candidate)
    changes = [{'provider': name, 'model': model or None, 'field': field,
                'before': old.get((name, model, field)), 'after': new[name, model, field]}
               for name, model, field in sorted(new) if old.get((name, model, field)) != new[name, model, field]]
    result = {'revision': revision, 'changes': changes, 'applied': False}
    if not apply or not changes:
        return result
    if reference[0][3] != os.geteuid():
        raise budgets.BudgetError('reference must be owned by the current user')
    with os.fdopen(os.open(policy, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as locked:
        try:
            fcntl.flock(locked, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise budgets.BudgetError('another sync holds the reference lock') from None
        fd, name = tempfile.mkstemp(prefix='.' + policy.name + '.sync-', dir=policy.parent)
        temporary = Path(name)
        try:
            with os.fdopen(fd, 'wb') as stream:
                os.fchmod(stream.fileno(), stat.S_IMODE(reference[0][2]))
                stream.write(candidate.encode('utf-8'))
                stream.flush()
                os.fsync(stream.fileno())
            if _snapshot(profile) != source or _snapshot(policy) != reference:
                raise budgets.BudgetError('source/reference changed during sync; preview again')
            os.replace(temporary, policy)
        finally:
            # This is only the random temporary file created above, never a profile.
            if temporary.parent.resolve() != policy.parent.resolve() or not temporary.name.startswith('.' + policy.name + '.sync-'):
                raise budgets.BudgetError('unexpected temporary path; refusing cleanup')
            temporary.unlink(missing_ok=True)
    result['applied'] = True
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    home = Path(os.environ.get('DSH_HOME', Path.home() / '.dsh'))
    parser.add_argument('--profile', type=Path, default=home / 'profiles/web/cordis.patch.yml')
    parser.add_argument('--policy', type=Path, default=budgets.POLICY_PATH)
    parser.add_argument('--apply', action='store_true', help='write only the Git reference, never the profile')
    parser.add_argument('--expect', help='revision returned by preview; required with --apply')
    args = parser.parse_args(argv)
    try:
        print(json.dumps(sync_files(args.profile, args.policy, args.apply, args.expect), ensure_ascii=False, indent=2))
        return 0
    except budgets.BudgetError as error:
        print('LỖI:', error, file=sys.stderr)
    except (OSError, UnicodeError, budgets.yaml.YAMLError):
        print('LỖI: không đọc/ghi được snapshot budget; chi tiết cấu hình đã được ẩn.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())

#!/usr/bin/env python3
"""Model-keyed operating policy shared by health and repair (requires PyYAML).

The overlay is the desired configuration, not proof of upstream acceptance.
"""
from pathlib import Path
import argparse
from datetime import datetime
import fcntl
import os
import stat
import sys
import tempfile

import yaml

POLICY_PATH = Path(__file__).with_name('web-model-budgets.yml')
FIELDS = ('contextWindow', 'maxTokens')
DEFAULTS = ('defaultContextWindow', 'defaultMaxTokens')


class BudgetError(ValueError):
    pass


class UniqueLoader(yaml.SafeLoader):
    """Do not silently accept ambiguous duplicate keys or YAML merge keys."""

    def construct_mapping(self, node, deep=False):
        keys = set()
        for key, _ in node.value:
            if key.tag == 'tag:yaml.org,2002:merge':
                raise BudgetError('YAML merge keys are unsupported')
            name = self.construct_object(key, deep=deep)
            if name in keys:
                raise BudgetError('duplicate YAML key')
            keys.add(name)
        return super().construct_mapping(node, deep=deep)


def read_providers(text):
    document = yaml.load(text, Loader=UniqueLoader)
    if not isinstance(document, list):
        raise BudgetError('profile must be a list of patch entries')
    entries = [entry for entry in document if isinstance(entry, dict) and entry.get('id') == 'llm-pi-ai']
    if not entries:
        raise BudgetError('khong thay provider or/cgw trong profile')
    if len(entries) != 1:
        raise BudgetError('expected one llm-pi-ai patch entry')
    providers = entries[0].get('config', {}).get('providers')
    if not isinstance(providers, dict):
        raise BudgetError('khong thay provider or/cgw trong profile')
    return providers


def load_policy():
    return read_providers(POLICY_PATH.read_text(encoding='utf-8'))


def budget_errors(provider, provider_name='or', policy=None):
    policy = load_policy() if policy is None else policy
    if provider_name not in policy:
        return [provider_name + ': unknown provider policy']
    expected = policy[provider_name]
    errors = []
    if not isinstance(provider, dict):
        return [provider_name + ': invalid provider mapping']
    for key in DEFAULTS:
        if type(provider.get(key)) is not int or provider[key] != expected[key]:
            errors.append(key + ': expected ' + str(expected[key]))
    models = provider.get('models')
    if not isinstance(models, list) or not models:
        errors.append('models: expected a non-empty list')
        return errors
    by_id = {model['id']: model for model in expected['models']}
    seen = set()
    for model in models:
        if not isinstance(model, dict) or not isinstance(model.get('id'), str):
            errors.append('models: invalid model entry')
            continue
        model_id = model['id']
        if model_id in seen:
            errors.append(model_id + ': duplicate model id')
        seen.add(model_id)
        if model_id not in by_id:
            errors.append(model_id + ': unknown model policy; no inferred budget')
            continue
        for key in FIELDS:
            if type(model.get(key)) is not int or model[key] != by_id[model_id][key]:
                errors.append(model_id + ': ' + key + ': expected ' + str(by_id[model_id][key]))
    return errors


def check_profile_budgets(path):
    try:
        providers = read_providers(Path(path).read_text(encoding='utf-8'))
        policy = load_policy()
        names = providers.keys() & policy.keys()
        if not names:
            return ['khong thay provider or/cgw trong profile']
        return [name + ' -> ' + error for name in sorted(names)
                for error in budget_errors(providers[name], name, policy)]
    except BudgetError as error:
        return [str(error)]
    except (yaml.YAMLError, OSError, TypeError, AttributeError) as error:
        return ['invalid budget profile: ' + type(error).__name__]


def repaired_text(text):
    """Patch only budget value spans; retain comments, credentials and other rows."""
    providers = read_providers(text)
    policy = load_policy()
    names = providers.keys() & policy.keys()
    if not names:
        raise BudgetError('khong thay provider or/cgw trong profile')
    for name in names:
        errors = budget_errors(providers[name], name, policy)
        unsafe = [error for error in errors if 'expected ' not in error or error.startswith('models:')]
        if unsafe:
            raise BudgetError(name + ': repair refused; ' + '; '.join(unsafe))
    root = yaml.compose(text, Loader=UniqueLoader)
    seen = set()

    def reject_aliases(node):
        if id(node) in seen:
            raise BudgetError('repair refuses YAML aliases; expand them explicitly first')
        seen.add(id(node))
        if isinstance(node, yaml.MappingNode):
            for key, value in node.value:
                reject_aliases(key)
                reject_aliases(value)
        elif isinstance(node, yaml.SequenceNode):
            for value in node.value:
                reject_aliases(value)

    reject_aliases(root)

    def mapping(node):
        if not isinstance(node, yaml.MappingNode) or node.flow_style:
            raise BudgetError('repair requires block-style mappings')
        return {key.value: value for key, value in node.value}

    entries = [mapping(node) for node in root.value]
    entry = next(row for row in entries if row.get('id') and row['id'].value == 'llm-pi-ai')
    provider_nodes = mapping(mapping(entry['config'])['providers'])
    edits = []

    def patch(node, expected, fields):
        values = mapping(node)
        missing = []
        for key in fields:
            value = values.get(key)
            if value is None:
                missing.append(' ' * node.start_mark.column + key + ': ' + str(expected[key]) + '\n')
            elif value.tag != 'tag:yaml.org,2002:int' or value.value != str(expected[key]):
                if not isinstance(value, yaml.ScalarNode):
                    raise BudgetError('repair refuses non-scalar budget')
                edits.append((value.start_mark.index, value.end_mark.index, str(expected[key])))
        if missing:
            # Insert at the start of the next block, not inside its indentation.
            pos = text.rfind('\n', 0, node.end_mark.index) + 1
            if node.end_mark.index == len(text):
                pos = len(text)
            prefix = '\n' if pos and text[pos - 1] != '\n' else ''
            edits.append((pos, pos, prefix + ''.join(missing)))

    for name in sorted(names):
        node = provider_nodes[name]
        patch(node, policy[name], DEFAULTS)
        by_id = {model['id']: model for model in policy[name]['models']}
        for model in mapping(node)['models'].value:
            model_id = mapping(model)['id'].value
            patch(model, by_id[model_id], FIELDS)
    for start, end, replacement in sorted(edits, reverse=True):
        text = text[:start] + replacement + text[end:]
    # Verify the entire candidate before any file is touched.
    candidate = read_providers(text)
    errors = [error for name in names for error in budget_errors(candidate[name], name, policy)]
    if errors:
        raise BudgetError('repair candidate failed validation')
    return text


def repair_profile(path, writer_stopped=False):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise BudgetError('repair requires a regular non-symlink file')
    with path.open('rb') as locked:
        try:
            fcntl.flock(locked, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BudgetError('another repair holds the profile lock') from None
        original_stat = os.fstat(locked.fileno())
        before = locked.read()
        text = before.decode('utf-8')
        # YAML marks are character offsets. Work on LF and restore original CRLF.
        newline = '\r\n' if '\r\n' in text else '\n'
        if newline == '\r\n' and '\n' in text.replace('\r\n', ''):
            raise BudgetError('repair refuses mixed newline styles')
        after = repaired_text(text.replace('\r\n', '\n')).replace('\n', newline).encode('utf-8')
        if after == before:
            print('ĐÃ SẠCH: ngân sách khớp policy từng provider/model. Không sửa gì.')
            return
        if not writer_stopped:
            raise BudgetError('stop DSH/GUI and other profile writers, then pass --writer-stopped; no changes made')
        # flock serializes cooperative repairs only; a GUI does not honor it.
        # The explicit offline precondition is required: os.replace is not CAS.
        mode = stat.S_IMODE(original_stat.st_mode)
        backup = path.with_name(path.name + '.bak-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
        with tempfile.NamedTemporaryFile(mode='wb', dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(after)
        try:
            os.chmod(temporary, mode)
            current = path.lstat()
            if (stat.S_ISLNK(current.st_mode) or (current.st_dev, current.st_ino) !=
                    (original_stat.st_dev, original_stat.st_ino) or path.read_bytes() != before):
                raise BudgetError('profile changed during repair; refusing replacement')
            with backup.open('xb') as stream:
                os.chmod(backup, mode)
                stream.write(before)
            try:
                os.replace(temporary, path)
            except OSError:
                backup.unlink(missing_ok=True)
                raise
        finally:
            temporary.unlink(missing_ok=True)
    print('ĐÃ SỬA: budget theo model; có backup cạnh file gốc. Chưa restart DSH.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repair', action='store_true', help='backup and repair only known model budgets')
    parser.add_argument('--writer-stopped', action='store_true', help='confirm DSH/GUI and all other profile writers are stopped')
    parser.add_argument('profile', type=Path)
    args = parser.parse_args()
    try:
        if args.repair:
            repair_profile(args.profile, writer_stopped=args.writer_stopped)
            return 0
        errors = check_profile_budgets(args.profile)
        for error in errors:
            print('LỖI:', error)
        if not errors:
            print('ĐẠT: ngân sách trên đĩa khớp policy; upstream/RAM chưa verify.')
        return int(bool(errors))
    except (BudgetError, yaml.YAMLError, OSError, TypeError, AttributeError) as error:
        # Only controlled errors carry text; YAML exceptions may contain secrets.
        print('LỖI:', str(error) if isinstance(error, BudgetError) else type(error).__name__, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

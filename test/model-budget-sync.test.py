import contextlib
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True
TOOLS = Path(__file__).parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
import model_budgets as budgets
try:
    import sync_model_budgets as sync
except ModuleNotFoundError:
    sync = None

POLICY = '''# Preserve this reference comment.
- id: llm-pi-ai
  config:
    providers:
      or:
        defaultContextWindow: 128000
        defaultMaxTokens: 16384
        models:
          - id: shared
            contextWindow: 872000 # preserve inline comment
            maxTokens: 128000
          - id: unused-reference
            contextWindow: 400000
            maxTokens: 32000
      cgw:
        defaultContextWindow: 128000
        defaultMaxTokens: 16384
        models:
          - id: shared
            contextWindow: 128000
            maxTokens: 16384
'''
SOURCE = '''- id: unrelated
  config:
    privateValue: dummy-private-marker
- id: llm-pi-ai
  config:
    providers:
      or:
        baseURL: https://dummy.invalid/private-path
        apiKey: dummy-secret-marker
        apiKeyEnv: DUMMY_PRIVATE_ENV
        displayName: dummy-private-name
        defaultContextWindow: 1000000
        defaultMaxTokens: 128000
        models:
          - id: shared
            contextWindow: 1050000
            maxTokens: 128000
            options:
              privateValue: dummy-model-private-marker
      cgw:
        defaultContextWindow: 128000
        defaultMaxTokens: 16384
        models:
          - id: shared
            contextWindow: 200000
            maxTokens: 32000
'''


def dumped(source):
    return budgets.yaml.safe_dump(source, sort_keys=False)


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(sync, 'Settings-to-policy synchronization is not implemented')
        self.temporary = tempfile.TemporaryDirectory(prefix='dsh-budget-sync-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.profile = self.root / 'profile.yml'
        self.policy = self.root / 'policy.yml'
        self.profile.write_text(SOURCE)
        self.policy.write_text(POLICY)

    def test_updates_by_provider_and_model_id_and_retains_unseen_rows(self):
        result = sync.synced_text(SOURCE, POLICY)
        providers = budgets.read_providers(result)
        self.assertEqual(budgets.budget_errors(budgets.read_providers(SOURCE)['or'], 'or', providers), [])
        self.assertEqual(budgets.budget_errors(budgets.read_providers(SOURCE)['cgw'], 'cgw', providers), [])
        self.assertEqual(providers['or']['models'][1]['id'], 'unused-reference')
        self.assertEqual(providers['or']['models'][1]['contextWindow'], 400000)
        self.assertIn('# Preserve this reference comment.', result)
        self.assertIn('# preserve inline comment', result)
        for private in ('dummy-secret-marker', 'dummy-private', 'DUMMY_PRIVATE_ENV', 'baseURL', 'options:'):
            self.assertNotIn(private, result)

    def test_adds_only_explicit_budget_fields_for_a_new_model(self):
        source = budgets.yaml.safe_load(SOURCE)
        models = source[1]['config']['providers']['or']['models']
        models.append({'id': 'new: model # one', 'contextWindow': 1000000, 'maxTokens': 131072,
                       'apiKey': 'dummy-new-secret'})
        result = sync.synced_text(dumped(source), POLICY)
        model = budgets.read_providers(result)['or']['models'][-1]
        self.assertEqual(model, {'id': 'new: model # one', 'contextWindow': 1000000, 'maxTokens': 131072})
        self.assertNotIn('dummy-new-secret', result)
        self.assertEqual(sync.synced_text(dumped(source), result), result)

    def test_missing_source_provider_does_not_remove_reference_provider(self):
        source = budgets.yaml.safe_load(SOURCE)
        del source[1]['config']['providers']['cgw']
        result = budgets.read_providers(sync.synced_text(dumped(source), POLICY))
        self.assertEqual(result['cgw'], budgets.read_providers(POLICY)['cgw'])

    def test_invalid_or_inherited_budget_is_refused_without_inference(self):
        for field in budgets.FIELDS + budgets.DEFAULTS:
            for value in (None, True, 0, -1, 1.5, '128000'):
                with self.subTest(field=field, value=value):
                    source = budgets.yaml.safe_load(SOURCE)
                    provider = source[1]['config']['providers']['or']
                    row = provider['models'][0] if field in budgets.FIELDS else provider
                    row[field] = value
                    with self.assertRaises(budgets.BudgetError):
                        sync.synced_text(dumped(source), POLICY)

    def test_source_budget_aliases_are_not_explicit_values(self):
        scalar = SOURCE.replace('defaultContextWindow: 1000000', 'defaultContextWindow: &window 1000000').replace('contextWindow: 1050000', 'contextWindow: *window')
        provider_alias = budgets.yaml.safe_load(SOURCE)
        providers = provider_alias[1]['config']['providers']
        providers['cgw'] = providers['or']
        list_alias = budgets.yaml.safe_load(SOURCE)
        providers = list_alias[1]['config']['providers']
        providers['cgw']['models'] = providers['or']['models']
        for kind, source in [('scalar', scalar), ('provider', dumped(provider_alias)), ('models', dumped(list_alias))]:
            with self.subTest(kind=kind), self.assertRaises(budgets.BudgetError):
                sync.synced_text(source, POLICY)

    def test_noop_reference_alias_is_still_refused(self):
        aliased = POLICY.replace('defaultContextWindow: 128000', 'defaultContextWindow: &window 128000', 1).replace('contextWindow: 128000', 'contextWindow: *window')
        for source in (POLICY, SOURCE):
            with self.subTest(noop=source == POLICY), self.assertRaises(budgets.BudgetError):
                sync.synced_text(source, aliased)

    def test_absent_budget_fields_are_not_inherited_from_defaults(self):
        for field in budgets.FIELDS + budgets.DEFAULTS:
            source = budgets.yaml.safe_load(SOURCE)
            provider = source[1]['config']['providers']['or']
            row = provider['models'][0] if field in budgets.FIELDS else provider
            del row[field]
            with self.subTest(field=field), self.assertRaises(budgets.BudgetError):
                sync.synced_text(dumped(source), POLICY)

    def test_merge_keys_are_refused_even_without_aliases(self):
        source = SOURCE.replace('defaultContextWindow: 1000000', '<<: {defaultContextWindow: 1000000}')
        reference = POLICY.replace('defaultContextWindow: 128000', '<<: {defaultContextWindow: 128000}', 1)
        for profile, policy in ((source, POLICY), (SOURCE, reference)):
            with self.subTest(source_merge=profile == source), self.assertRaises(budgets.BudgetError):
                sync.synced_text(profile, policy)

    def test_lock_contention_refuses_apply_without_temp_or_writes(self):
        preview = sync.sync_files(self.profile, self.policy)
        with self.policy.open('rb') as locked:
            sync.fcntl.flock(locked, sync.fcntl.LOCK_EX | sync.fcntl.LOCK_NB)
            with self.assertRaises(budgets.BudgetError):
                sync.sync_files(self.profile, self.policy, apply=True, expected=preview['revision'])
        self.assertEqual(self.profile.read_text(), SOURCE)
        self.assertEqual(self.policy.read_text(), POLICY)
        self.assertEqual(sorted(path.name for path in self.root.iterdir()), ['policy.yml', 'profile.yml'])

    def test_ambiguous_source_or_policy_is_refused(self):
        cases = [(SOURCE + SOURCE, POLICY), (SOURCE, POLICY + POLICY),
                 (SOURCE.replace('maxTokens: 128000', 'maxTokens: 128000\n            maxTokens: 5'), POLICY),
                 (SOURCE, POLICY.replace('defaultMaxTokens: 16384', 'apiKey: dummy-secret\n        defaultMaxTokens: 16384', 1))]
        source = budgets.yaml.safe_load(SOURCE)
        provider = source[1]['config']['providers']['or']
        provider['models'].append(copy.deepcopy(provider['models'][0]))
        cases.append((dumped(source), POLICY))
        for source_text, policy_text in cases:
            with self.subTest(source=source_text[:15]):
                with self.assertRaises(budgets.BudgetError):
                    sync.synced_text(source_text, policy_text)

    def test_preview_is_read_only_and_contains_no_private_metadata(self):
        result = sync.sync_files(self.profile, self.policy)
        self.assertFalse(result['applied'])
        self.assertTrue(result['changes'])
        self.assertRegex(result['revision'], r'^[0-9a-f]{64}$')
        self.assertEqual(self.profile.read_text(), SOURCE)
        self.assertEqual(self.policy.read_text(), POLICY)
        self.assertEqual(sorted(path.name for path in self.root.iterdir()), ['policy.yml', 'profile.yml'])
        self.assertNotIn('dummy-', json.dumps(result))

    def test_apply_requires_preview_revision_and_never_changes_profile(self):
        preview = sync.sync_files(self.profile, self.policy)
        os.chmod(self.policy, 0o640)
        # Mode is part of the snapshot: preview again after changing it.
        preview = sync.sync_files(self.profile, self.policy)
        result = sync.sync_files(self.profile, self.policy, apply=True, expected=preview['revision'])
        self.assertTrue(result['applied'])
        self.assertEqual(self.profile.read_text(), SOURCE)
        self.assertEqual(self.policy.read_text(), sync.synced_text(SOURCE, POLICY))
        self.assertEqual(self.policy.stat().st_mode & 0o777, 0o640)
        with mock.patch.object(sync.os, 'replace') as replace:
            second = sync.sync_files(self.profile, self.policy)
            self.assertEqual(second['changes'], [])
            self.assertFalse(sync.sync_files(self.profile, self.policy, apply=True, expected=second['revision'])['applied'])
            replace.assert_not_called()

    def test_missing_or_stale_revision_never_writes(self):
        for expected in (None, '0' * 64):
            with self.assertRaises(budgets.BudgetError):
                sync.sync_files(self.profile, self.policy, apply=True, expected=expected)
        old = sync.sync_files(self.profile, self.policy)['revision']
        self.profile.write_text(SOURCE + '# a later Settings save\n')
        with self.assertRaises(budgets.BudgetError):
            sync.sync_files(self.profile, self.policy, apply=True, expected=old)
        self.assertEqual(self.policy.read_text(), POLICY)

    def test_symlinks_and_same_source_target_are_refused(self):
        link = self.root / 'link.yml'
        link.symlink_to(self.profile)
        for source, policy in ((link, self.policy), (self.profile, link), (self.profile, self.profile)):
            with self.subTest(source=source.name, policy=policy.name):
                with self.assertRaises((budgets.BudgetError, OSError)):
                    sync.sync_files(source, policy)
        hardlink = self.root / 'hardlink.yml'
        hardlink.hardlink_to(self.profile)
        with self.assertRaises(budgets.BudgetError):
            sync.sync_files(self.profile, hardlink)
        self.assertEqual(self.profile.read_text(), SOURCE)

    def test_model_ids_with_r_or_n_are_not_mistaken_for_line_breaks(self):
        source = budgets.yaml.safe_load(SOURCE)
        row = source[1]['config']['providers']['or']['models'][0]
        for model_id in ('nr-ai/grok-4.7', 'new/provider-model', 'line\nfeed', 'carriage\rreturn'):
            row['id'] = model_id
            if '\n' in model_id or '\r' in model_id:
                with self.assertRaises(budgets.BudgetError):
                    sync.synced_text(dumped(source), POLICY)
            else:
                result = sync.synced_text(dumped(source), POLICY)
                self.assertIn(model_id, [model['id'] for model in budgets.read_providers(result)['or']['models']])

    def test_concurrent_source_or_policy_change_refuses_replacement(self):
        real_mkstemp = sync.tempfile.mkstemp
        for changed in (self.profile, self.policy):
            with self.subTest(changed=changed.name):
                self.profile.write_text(SOURCE)
                self.policy.write_text(POLICY)
                preview = sync.sync_files(self.profile, self.policy)
                def mutate(*args, **kwargs):
                    result = real_mkstemp(*args, **kwargs)
                    changed.write_text(changed.read_text() + '# concurrent save\n')
                    return result
                with mock.patch.object(sync.tempfile, 'mkstemp', side_effect=mutate), \
                        mock.patch.object(sync.os, 'replace') as replace:
                    with self.assertRaises(budgets.BudgetError):
                        sync.sync_files(self.profile, self.policy, apply=True, expected=preview['revision'])
                    replace.assert_not_called()
                self.assertEqual(self.policy.read_text(), POLICY + ('# concurrent save\n' if changed == self.policy else ''))
                self.assertEqual(len(list(self.root.iterdir())), 2)

    def test_replace_failure_keeps_original_policy_and_cleans_own_temp(self):
        preview = sync.sync_files(self.profile, self.policy)
        with mock.patch.object(sync.os, 'replace', side_effect=OSError('dummy failure')):
            with self.assertRaises(OSError):
                sync.sync_files(self.profile, self.policy, apply=True, expected=preview['revision'])
        self.assertEqual(self.policy.read_text(), POLICY)
        self.assertEqual(self.profile.read_text(), SOURCE)
        self.assertEqual(len(list(self.root.iterdir())), 2)

    def test_crlf_and_unicode_model_ids_are_preserved(self):
        source = budgets.yaml.safe_load(SOURCE)
        for provider in source[1]['config']['providers'].values():
            provider['models'].append({'id': 'mới: model # \\"quoted\\"', 'contextWindow': 512000, 'maxTokens': 65536})
        policy = POLICY.replace('\n', '\r\n')
        result = sync.synced_text(dumped(source), policy)
        self.assertNotIn('\n', result.replace('\r\n', ''))
        self.assertEqual(sync.synced_text(dumped(source), result), result)
        for provider in budgets.read_providers(result).values():
            self.assertEqual(provider['models'][-1]['contextWindow'], 512000)

    def test_preview_revision_is_bound_to_file_identity_and_mode(self):
        first = sync.sync_files(self.profile, self.policy)['revision']
        os.chmod(self.policy, 0o640)
        second = sync.sync_files(self.profile, self.policy)['revision']
        self.assertNotEqual(first, second)
        replacement = self.root / 'replacement.yml'
        replacement.write_text(SOURCE)
        os.replace(replacement, self.profile)
        third = sync.sync_files(self.profile, self.policy)['revision']
        self.assertNotEqual(second, third)
        with self.assertRaises(budgets.BudgetError):
            sync.sync_files(self.profile, self.policy, apply=True, expected=second)

    def test_apply_cli_never_touches_profile_and_rejects_reused_revision(self):
        command = [sys.executable, '-B', str(TOOLS / 'sync_model_budgets.py'), '--profile', str(self.profile),
                   '--policy', str(self.policy)]
        preview = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(preview.returncode, 0, preview.stderr)
        revision = json.loads(preview.stdout)['revision']
        result = subprocess.run(command + ['--apply', '--expect', revision], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['applied'])
        self.assertEqual(self.profile.read_text(), SOURCE)
        stale = subprocess.run(command + ['--apply', '--expect', revision], capture_output=True, text=True)
        self.assertNotEqual(stale.returncode, 0)
        self.assertNotIn('dummy-', result.stdout + result.stderr + stale.stdout + stale.stderr)

    def test_cli_preview_and_parser_failure_do_not_expose_secrets(self):
        command = [sys.executable, str(TOOLS / 'sync_model_budgets.py'), '--profile', str(self.profile),
                   '--policy', str(self.policy)]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('revision', json.loads(result.stdout))
        self.profile.write_text(SOURCE + 'apiKey: [dummy-secret-parse-marker\n')
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('dummy-', result.stdout + result.stderr)
        self.assertEqual(self.policy.read_text(), POLICY)


if __name__ == '__main__':
    unittest.main()

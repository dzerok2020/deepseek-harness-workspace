import importlib.util
import os
import sys
sys.dont_write_bytecode = True
import tempfile
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'tools'))
spec = importlib.util.spec_from_file_location('orchestration_health', Path(__file__).parents[1] / 'tools/orchestration-health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)

class HealthTests(unittest.TestCase):
    def test_budget_override_and_missing_limits_fail(self):
        for model in [{'id': 'x'}, {'id': 'x', 'contextWindow': 131000, 'maxTokens': 16384}]:
            self.assertTrue(health.budget_errors({'defaultContextWindow':128000, 'defaultMaxTokens':16384, 'models':[model]}))

    def test_rejects_a_valid_size_assigned_to_the_wrong_model(self):
        provider = {'defaultContextWindow':128000, 'defaultMaxTokens':16384,
                    'models':[{'id':'b-ai/deepseek-v4.1-flash','contextWindow':1000000,'maxTokens':16384}]}
        self.assertTrue(health.budget_errors(provider))

    def test_model_specific_policy_values_pass(self):
        for model_id, window, output in [('b-ai/deepseek-v4.1-flash', 128000, 16384),
                                         ('gpt-free', 104000, 16384),
                                         ('b-ai/glm-5.3-flash', 128000, 16384),
                                         ('cx/gpt-6-sol', 128000, 16384),
                                         ('nr-ai/deepseek-v4-pro-0813', 1000000, 384000)]:
            self.assertEqual(health.budget_errors({'defaultContextWindow':128000, 'defaultMaxTokens':16384,
                'models':[{'id':model_id,'contextWindow':window,'maxTokens':output}]}), [], model_id)

    def test_unknown_model_and_provider_are_errors(self):
        provider = {'defaultContextWindow':128000, 'defaultMaxTokens':16384,
                    'models':[{'id':'unknown-model','contextWindow':1000000,'maxTokens':16384}]}
        self.assertTrue(health.budget_errors(provider))
        self.assertTrue(health.budget_errors(provider, 'unknown-provider'))

    def test_swapped_allowed_numbers_and_defaults_are_rejected(self):
        for name, model_id, window in [('or', 'gpt-free', 1000000),
                                       ('or', 'cx/gpt-6-sol', 104000),
                                       ('cgw', 'chatgpt-web/gpt-6-sol', 1048576)]:
            provider = {'defaultContextWindow':128000, 'defaultMaxTokens':16384,
                        'models':[{'id':model_id,'contextWindow':window,'maxTokens':16384}]}
            self.assertTrue(health.budget_errors(provider, name))
        provider = {'defaultContextWindow':1000000, 'defaultMaxTokens':16384,
                    'models':[{'id':'gpt-free','contextWindow':104000,'maxTokens':16384}]}
        self.assertTrue(health.budget_errors(provider))

    def test_duplicate_empty_invalid_and_string_budgets_are_rejected(self):
        model = {'id':'gpt-free','contextWindow':104000,'maxTokens':16384}
        for models in [[], None, {}, [None], [model, model], [{**model, 'contextWindow':'104000'}]]:
            self.assertTrue(health.budget_errors({'defaultContextWindow':128000,
                            'defaultMaxTokens':16384, 'models':models}), models)

    def test_explicit_budget_passes(self):
        self.assertEqual(health.budget_errors({'defaultContextWindow':128000, 'defaultMaxTokens':16384, 'models':[{'id':'b-ai/deepseek-v4.1-flash','contextWindow':128000,'maxTokens':16384}]}), [])

    def test_health_status_and_mode_required(self):
        for body in [{}, {'status':'error'}, {'status':'ok','mode':'full'}]:
            self.assertFalse(health.shim_ready(body))
        self.assertTrue(health.shim_ready({'status':'ok','mode':'browser-only'}))

    def test_catalog_requires_actual_model(self):
        for body in [{}, {'data':[]}, {'data':[{'id':'wrong'}]}]:
            self.assertFalse(health.has_model(body, 'expected'))
        self.assertTrue(health.has_model({'data':[{'id':'expected'}]}, 'expected'))

    def test_bridge_must_accept_turns(self):
        self.assertFalse(health.bridge_ready({'accepting_turns':False}))
        self.assertFalse(health.bridge_ready({}))
        self.assertTrue(health.bridge_ready({'accepting_turns':True}))

GOOD_PROFILE = '''- id: llm-pi-ai
  config:
    providers:
      or:
        defaultContextWindow: 128000
        defaultMaxTokens: 16384
        models:
          - id: b-ai/deepseek-v4.1-flash
            name: jev
            contextWindow: 128000
            maxTokens: 16384
      cgw:
        defaultContextWindow: 128000
        defaultMaxTokens: 16384
        models:
          - id: chatgpt-web/gpt-6-sol
            name: gpt 6 sol (ChatGPT Web)
            contextWindow: 128000
            maxTokens: 16384
'''


class ProfileDriftTest(unittest.TestCase):
    """GUI đã ghi đè hồ sơ lúc 13:24 (1M/65000/131000) — health phải tự phát hiện trôi."""

    def _write(self, text):
        handle, path = tempfile.mkstemp(suffix='.yml')
        with os.fdopen(handle, 'w') as stream:
            stream.write(text)
        self.addCleanup(os.unlink, path)
        return path

    def test_bat_drift_context_1m(self):
        path = self._write(GOOD_PROFILE.replace(
            'contextWindow: 128000\n            maxTokens: 16384\n      cgw:',
            'contextWindow: 1000000\n            maxTokens: 16384\n      cgw:'))
        errors = health.check_profile_budgets(path)
        self.assertTrue(any('b-ai/deepseek-v4.1-flash' in e and 'contextWindow' in e for e in errors), errors)

    def test_bat_drift_maxtokens_65000(self):
        path = self._write(GOOD_PROFILE.replace(
            '- id: chatgpt-web/gpt-6-sol\n            name: gpt 6 sol (ChatGPT Web)\n            contextWindow: 128000\n            maxTokens: 16384',
            '- id: chatgpt-web/gpt-6-sol\n            name: gpt 6 sol (ChatGPT Web)\n            contextWindow: 128000\n            maxTokens: 65000'))
        errors = health.check_profile_budgets(path)
        self.assertTrue(any('chatgpt-web/gpt-6-sol' in e and 'maxTokens' in e for e in errors), errors)

    def test_good_profile_no_drift(self):
        path = self._write(GOOD_PROFILE)
        self.assertEqual(health.check_profile_budgets(path), [])

    def test_missing_providers_is_error_not_silent(self):
        path = self._write('- id: browserskill\n  config:\n    bskPath: /x\n')
        errors = health.check_profile_budgets(path)
        self.assertTrue(any('khong thay provider' in e for e in errors), errors)


class RepairSafetyTests(unittest.TestCase):
    def test_concurrent_edit_before_replace_is_not_overwritten_or_backed_up(self):
        import model_budgets as budgets
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'profile.yml'
            path.write_text(GOOD_PROFILE.replace('contextWindow: 128000', 'contextWindow: 1000000'))
            original = budgets.tempfile.NamedTemporaryFile
            concurrent = path.read_bytes() + b'# concurrent unrelated edit\n'

            def create_temp(*args, **kwargs):
                stream = original(*args, **kwargs)
                path.write_bytes(concurrent)
                return stream

            with patch.object(budgets.tempfile, 'NamedTemporaryFile', create_temp):
                with self.assertRaisesRegex(budgets.BudgetError, 'profile changed'):
                    budgets.repair_profile(path, writer_stopped=True)
            self.assertEqual(path.read_bytes(), concurrent)
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_replace_failure_leaves_original_without_backup_or_temp(self):
        import model_budgets as budgets
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'profile.yml'
            original = GOOD_PROFILE.replace('contextWindow: 128000', 'contextWindow: 1000000').encode()
            path.write_bytes(original)
            with patch.object(budgets.os, 'replace', side_effect=OSError('synthetic failure')):
                with self.assertRaises(OSError):
                    budgets.repair_profile(path, writer_stopped=True)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_locked_profile_refuses_second_repair(self):
        import model_budgets as budgets
        import fcntl
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'profile.yml'
            path.write_text(GOOD_PROFILE)
            with path.open('rb') as owner:
                fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaisesRegex(budgets.BudgetError, 'profile lock'):
                    budgets.repair_profile(path, writer_stopped=True)
            self.assertEqual(list(Path(directory).iterdir()), [path])


if __name__ == '__main__':
    unittest.main()

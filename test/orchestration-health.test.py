import importlib.util
import os
import sys
sys.dont_write_bytecode = True
import tempfile
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('orchestration_health', Path(__file__).parents[1] / 'tools/orchestration-health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)

class HealthTests(unittest.TestCase):
    def test_budget_override_and_missing_limits_fail(self):
        for model in [{'id': 'x'}, {'id': 'x', 'contextWindow': 1000000, 'maxTokens': 16384}]:
            self.assertTrue(health.budget_errors({'defaultContextWindow':128000, 'defaultMaxTokens':16384, 'models':[model]}))

    def test_explicit_budget_passes(self):
        self.assertEqual(health.budget_errors({'defaultContextWindow':128000, 'defaultMaxTokens':16384, 'models':[{'id':'x','contextWindow':128000,'maxTokens':16384}]}), [])

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
          - id: b-ai/jev-latest
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
        self.assertTrue(any('b-ai/jev-latest' in e and 'contextWindow' in e for e in errors), errors)

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


if __name__ == '__main__':
    unittest.main()

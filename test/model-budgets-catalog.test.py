import copy
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parents[1] / 'tools'))
import model_budgets as budgets


# Independent operating-budget snapshot from saved Settings on 2026-10-30.
# Absent routes retain their previous reference; no upstream capacity claim.
EXPECTED = {
    'cx/gpt-6-astra': (128000, 16384),
    'cx/gpt-6-sol': (128000, 16384),
    'cx/gpt-6-luna': (128000, 16384),
    'cx/gpt-6.1-sol': (1000000, 128000),
    'cx/gpt-5.6-terra': (872000, 128000),
    'cx/gpt-6.1-sol-fast': (400000, 16384),
    'nr-ai/deepseek-v4-flash': (1000000, 384000),
    'nr-ai/deepseek-v4.1-flash': (1048576, 384000),
    'nr-ai/deepseek-v4-flash-0731': (1000000, 384000),
    'nr-ai/deepseek-v4-pro-0813': (1000000, 384000),
    'nr-ai/glm-5.1': (200000, 65000),
    'nr-ai/glm-5.3-flash': (1000000, 131072),
    'nr-ai/qwen3.8-flash': (128000, 16384),
    'nr-ai/grok-4.7': (128000, 16384),
    'b-ai/gpt-6.1-sol': (128000, 16384),
    'b-ai/glm-5.3-flash': (128000, 16384),
    'b-ai/gemini-4-argon': (128000, 16384),
    'antigravity/gemini-3.8-flash-tiered': (128000, 16384),
    'b-ai/deepseek-v4.1-flash': (128000, 16384),
    'b-ai/qwen3.8-flash': (128000, 16384),
    'gpt-free': (104000, 16384),
    # Routes added in Settings and synced on 2026-11-01.
    'anapinex/free/deepseek-v4-flash-0731': (1048576, 384000),
    'anapinex/free/glm-5.3-flashx': (1048576, 128000),
    'anapinex/free/minimax-m3.1-flash': (1000000, 128000),
    'antigravity/claude-opus-5-5-medium': (1048576, 128000),
    'cx/gpt-5.6-sol': (872000, 128000),
    'gh/gpt-4.1': (1047576, 32768),
    # Routes added in Settings and synced on 2026-11-04.
    'gpt-5.6-terra': (872000, 128000),
    'antigravity/gemini-3.8-flash-high': (1048576, 65536),
}


class CatalogBudgetTests(unittest.TestCase):
    def setUp(self):
        self.policy = budgets.read_providers(budgets.POLICY_PATH.read_text())
        self.models = {model['id']: model for model in self.policy['or']['models']}

    def test_exact_saved_settings_and_retained_reference_routes(self):
        self.assertEqual(set(self.models), set(EXPECTED))
        for model_id, pair in EXPECTED.items():
            with self.subTest(model_id=model_id):
                self.assertIn(model_id, self.models)
                model = self.models[model_id]
                self.assertEqual((model['contextWindow'], model['maxTokens']), pair)

    def test_stale_catalog_capacity_does_not_override_saved_settings(self):
        for model_id, window, output in [
            ('cx/gpt-6-sol', 872000, 128000),
            ('b-ai/glm-5.3-flash', 1000000, 131072),
        ]:
            with self.subTest(model_id=model_id):
                provider = {**self.policy['or'], 'models': [
                    {'id': model_id, 'contextWindow': window, 'maxTokens': output},
                ]}
                self.assertTrue(budgets.budget_errors(provider, 'or', self.policy))

    def test_unknown_future_models_still_fail_closed(self):
        provider = copy.deepcopy(self.policy['or'])
        provider['models'].append({'id': 'nr-ai/future-unknown',
                                   'contextWindow': 1000000, 'maxTokens': 128000})
        self.assertTrue(budgets.budget_errors(provider, 'or', self.policy))

    def test_per_route_limits_are_not_provider_wide_defaults(self):
        provider = copy.deepcopy(self.policy['or'])
        provider['models'] = [{'id': 'nr-ai/glm-5.1',
                               'contextWindow': 1000000, 'maxTokens': 128000}]
        self.assertTrue(budgets.budget_errors(provider, 'or', self.policy))
        self.assertEqual((self.policy['or']['defaultContextWindow'],
                          self.policy['or']['defaultMaxTokens']), (128000, 16384))

    def test_browser_bridge_keeps_separate_operating_policy(self):
        cgw = self.policy['cgw']
        self.assertEqual((cgw['defaultContextWindow'], cgw['defaultMaxTokens']), (128000, 16384))
        self.assertTrue(cgw['models'])
        for model in cgw['models']:
            self.assertEqual((model['contextWindow'], model['maxTokens']), (128000, 16384))

    def test_budget_repair_preserves_routing_and_does_not_add_models(self):
        before = '''# routing stays byte-for-byte unchanged
- id: llm-pi-ai
  config:
    providers:
      or:
        baseURL: http://localhost:20128/v1
        apiKeyEnv: TEST_ONLY_ENV_NAME
        defaultContextWindow: 128000
        defaultMaxTokens: 16384
        models:
          - id: cx/gpt-5.6-terra
            contextWindow: 128000
            maxTokens: 16384
            name: Keep This Display Name
          - id: nr-ai/glm-5.1
            contextWindow: 128000
            maxTokens: 16384
'''
        after = budgets.repaired_text(before)
        providers = budgets.read_providers(after)
        self.assertEqual([m['id'] for m in providers['or']['models']],
                         ['cx/gpt-5.6-terra', 'nr-ai/glm-5.1'])
        self.assertEqual(budgets.budget_errors(providers['or'], 'or', self.policy), [])
        self.assertIn('        baseURL: http://localhost:20128/v1\n', after)
        self.assertIn('        apiKeyEnv: TEST_ONLY_ENV_NAME\n', after)
        self.assertIn('            name: Keep This Display Name\n', after)
        self.assertTrue(after.startswith('# routing stays byte-for-byte unchanged\n'))
        self.assertEqual(budgets.repaired_text(after), after)


if __name__ == '__main__':
    unittest.main()

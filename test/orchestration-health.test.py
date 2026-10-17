import importlib.util
import sys
sys.dont_write_bytecode = True
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

if __name__ == '__main__':
    unittest.main()

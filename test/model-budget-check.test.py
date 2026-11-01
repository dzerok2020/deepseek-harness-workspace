"""model-budget-check.py: drift is reported as its own failure, not as a chain failure."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / 'tools' / 'model-budget-check.py'
POLICY = ROOT / 'tools' / 'web-model-budgets.yml'
sys.path.insert(0, str(ROOT / 'tools'))


def run(path):
    env = {**os.environ, 'DSH_WEB_CORDIS': str(path)}
    return subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True, env=env)


class ModelBudgetCheckTests(unittest.TestCase):
    def test_missing_profile_fails_with_path(self):
        result = run('/tmp/khong-ton-tai-cordis.patch.yml')
        self.assertEqual(result.returncode, 1)
        self.assertIn('khong thay file', result.stdout)

    def test_reference_profile_passes(self):
        result = run(POLICY)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('ĐẠT: ngân sách', result.stdout)

    def test_drifted_budget_fails_and_names_the_model(self):
        text = POLICY.read_text(encoding='utf-8')
        drifted = text.replace('            maxTokens: 32768', '            maxTokens: 65536', 1)
        self.assertNotEqual(drifted, text, 'fixture phải thật sự đổi một giá trị')
        with tempfile.NamedTemporaryFile('w', suffix='.yml', delete=False) as handle:
            handle.write(drifted)
            path = handle.name
        try:
            result = run(path)
            self.assertEqual(result.returncode, 1)
            self.assertIn('expected 32768', result.stdout)
        finally:
            os.unlink(path)

    def test_module_is_loadable_and_reports_no_drift_on_policy(self):
        spec = importlib.util.spec_from_file_location('model_budget_check', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        previous = os.environ.get('DSH_WEB_CORDIS')
        os.environ['DSH_WEB_CORDIS'] = str(POLICY)
        try:
            self.assertEqual(module.main(), 0)
        finally:
            if previous is None:
                del os.environ['DSH_WEB_CORDIS']
            else:
                os.environ['DSH_WEB_CORDIS'] = previous


class ChainCheckNoLongerReportsBudgetDriftTests(unittest.TestCase):
    def test_orchestration_health_main_has_no_budget_block(self):
        source = (ROOT / 'tools' / 'orchestration-health.py').read_text(encoding='utf-8')
        self.assertNotIn('check_profile_budgets(profile_path)', source)
        self.assertIn('model-budget-check.py', source)


if __name__ == '__main__':
    unittest.main()

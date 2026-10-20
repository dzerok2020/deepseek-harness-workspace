"""Offline artifact integrity, not a semantic model-quality test."""
import unittest
import prepare_v2


class CandidateBundleTests(unittest.TestCase):
    def test_freezes_baseline_and_candidate_without_changing_parent(self):
        bundle = prepare_v2.load_bundle()
        self.assertEqual(bundle['manifest']['status'], 'offline_unverified')
        self.assertEqual(bundle['manifest']['model_calls'], 0)
        self.assertEqual(bundle['baseline']['demos'], [])
        self.assertEqual(len(bundle['candidate']['demos']), 5)
        self.assertTrue(bundle['candidate']['policy'].startswith(bundle['baseline']['policy']))
        self.assertNotEqual(bundle['baseline'], bundle['candidate'])

    def test_request_omits_review_labels_for_both_variants(self):
        bundle = prepare_v2.load_bundle()
        case = bundle['cases'][0] | {'secret_gold': 'DO_NOT_SEND'}
        for variant in ('baseline', 'candidate'):
            request = prepare_v2.messages(bundle, variant, case)
            self.assertEqual(request[-1]['role'], 'user')
            import json
            public = json.loads(request[-1]['content'])
            self.assertEqual(set(public), {'id', 'prompt', 'context'})
            self.assertNotIn('DO_NOT_SEND', str(request))
            self.assertEqual(len(request), 2 if variant == 'baseline' else 12)

    def test_hash_mismatch_fails_closed(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            (path / 'manifest.json').write_text(
                '{"sha256":{"candidate.json":"wrong"}}')
            (path / 'candidate.json').write_text('{}')
            with patch.object(prepare_v2, 'BUNDLE', path):
                with self.assertRaisesRegex(ValueError, 'Frozen artifact changed'):
                    prepare_v2.load_bundle()

    def test_cases_are_public_and_cover_counterexamples(self):
        bundle = prepare_v2.load_bundle()
        cases = bundle['cases']
        self.assertEqual(len(cases), 12)
        self.assertEqual(len({case['id'] for case in cases}), 12)
        self.assertEqual([c['source'] for c in cases if c['group'] == 'regression'],
                         ['vi-037', 'vi-039', 'vi-041'])
        self.assertIn('trả phí', cases[7]['context'])
        self.assertIn('BOM', cases[10]['prompt'])


if __name__ == '__main__':
    unittest.main()

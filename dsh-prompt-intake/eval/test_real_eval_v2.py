import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import real_eval
import prepare_v2


class RunnerTests(unittest.TestCase):
    def runner(self):
        import importlib.util
        self.assertIsNotNone(importlib.util.find_spec('real_eval_v2'), 'v2 runner must exist')
        import real_eval_v2
        return real_eval_v2

    def test_dry_plan_has_separate_fixed_artifacts_and_budget(self):
        v = self.runner()
        with patch('real_eval.credentials', side_effect=AssertionError('network')):
            plan = v.dry_plan()
        self.assertEqual(plan['maximum_planned_attempts'], 48)
        self.assertEqual(plan['hard_limit'], 60)
        self.assertEqual(plan['prior_attempts'], 71)
        self.assertEqual(plan['maximum_actual_total'], 131)

    def test_ledger_counts_failure_restart_and_phase_caps_without_retry(self):
        v = self.runner()
        with tempfile.TemporaryDirectory() as d:
            ledger = v.Ledger(Path(d) / 'ledger.jsonl')
            calls = []
            def fail(req, timeout):
                calls.append(timeout)
                self.assertEqual(len(ledger.rows()), 1)
                raise TimeoutError('offline fake')
            transport = v.Transport(ledger, d, 'fake', open_url=fail)
            with patch('real_eval.verify_local_routing'):
                with self.assertRaises(TimeoutError):
                    transport.call([], 'train-generation')
            self.assertEqual(calls, [120])
            self.assertEqual(len(v.Ledger(ledger.path).rows()), 1)
            self.assertEqual(json.loads((Path(d)/'attempt-001.json').read_text())['error']['type'], 'TimeoutError')
            for _ in range(5): ledger.reserve('train-generation', {})
            with self.assertRaisesRegex(RuntimeError, 'Phase'):
                ledger.reserve('train-generation', {})
            self.assertEqual(len(ledger.rows()), 6)

    def test_transport_preserves_canonical_request_and_routing_fail_closed(self):
        import io
        v = self.runner()
        with tempfile.TemporaryDirectory() as d:
            ledger = v.Ledger(Path(d)/'ledger.jsonl')
            requests = []
            def opener(req, timeout):
                requests.append(json.loads(req.data))
                self.assertEqual(timeout, 120)
                return io.StringIO(json.dumps({'choices':[{'message':{'content':'actual output'}}]}))
            t = v.Transport(ledger, d, 'fake', open_url=opener)
            with patch('real_eval.verify_local_routing', side_effect=RuntimeError('unsafe')):
                with self.assertRaisesRegex(RuntimeError, 'unsafe'): t.call([], 'train-generation')
            self.assertEqual(ledger.rows(), [])
            self.assertEqual(requests, [])
            with patch('real_eval.verify_local_routing'):
                self.assertEqual(t.call([{'role':'user','content':'public'}], 'train-generation'), 'actual output')
            self.assertEqual(requests[0]['model'], 'b-ai/qwen3.8-flash')
            self.assertEqual(requests[0]['temperature'], 0)
            self.assertFalse(requests[0]['stream'])

    def test_hard_sixty_corrupt_and_unknown_phase_fail_closed(self):
        v = self.runner()
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'ledger.jsonl'
            ledger = v.Ledger(path)
            with self.assertRaises(ValueError): ledger.reserve('unknown', {})
            path.write_text('\n'.join(json.dumps({'phase':'validation-generation'}) for _ in range(60))+'\n')
            with self.assertRaisesRegex(RuntimeError, 'budget exhausted'): ledger.reserve('train-judge', {})
            path.write_text('{broken')
            with self.assertRaises(json.JSONDecodeError): ledger.reserve('train-judge', {})

    def test_run_exact_frozen_manual_v2_blind_alternation_and_no_gold(self):
        v = self.runner()
        bundle = prepare_v2.load_bundle()
        sent = []
        checks = dict(intent=True, scope=True, clarification=True, consent=True, reason='evidence')
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)/'output'
            ledger = v.Ledger(Path(d)/'ledger.jsonl')
            class FakeTransport:
                def call(self, messages, phase):
                    ledger.reserve(phase, {'messages':messages})
                    sent.append((messages, phase))
                    if phase == 'validation-judge': return json.dumps({'A':checks, 'B':checks})
                    return 'response-'+str(len(sent))
            def bootstrap(bundle, train, transport, out):
                self.assertEqual(len(train), 6)
                self.assertFalse(any('review' in c for c in train))
                v.save_new(out/'dspy-train-candidate-frozen.json', {'validated':False})
                return {'validated':False}
            with patch.object(v, 'bootstrap', side_effect=bootstrap):
                result = v.run(out=out, ledger=ledger, transport=FakeTransport(), catalog={'fake':True})
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(len(sent), 36)
            for i, case in enumerate(bundle['cases']):
                order = ['baseline','candidate'] if i%2 == 0 else ['candidate','baseline']
                for j, variant in enumerate(order):
                    self.assertEqual(sent[3*i+j][0], prepare_v2.messages(bundle, variant, case))
                judge = json.loads(sent[3*i+2][0][-1]['content'])
                self.assertEqual(set(judge), {'case','A','B'})
                self.assertEqual(set(judge['case']), {'id','prompt','context'})
                self.assertNotIn('review', judge['case'])
                for rule in case['review']['must'] + case['review']['must_not']:
                    self.assertNotIn(rule, json.dumps(judge, ensure_ascii=False))
            self.assertEqual(result['groups']['regression']['n'],3)
            self.assertEqual(result['groups']['new_public_validation']['n'],9)
            self.assertEqual(json.loads((out/'manual-v2-frozen.json').read_text())['artifact'], bundle['candidate'])
            with self.assertRaises(RuntimeError): v.run(out=out, ledger=ledger, transport=FakeTransport(), catalog={})

    def test_failure_persists_partial_generations_and_summary_no_rerun(self):
        v = self.runner()
        with tempfile.TemporaryDirectory() as d:
            ledger = v.Ledger(Path(d)/'ledger.jsonl')
            out = Path(d)/'out'
            class Broken:
                def call(self, messages, phase):
                    ledger.reserve(phase, messages)
                    if len(ledger.rows()) == 2: raise TimeoutError('fake')
                    return 'first partial output'
            with patch.object(v, 'bootstrap', return_value={'validated':False}):
                with self.assertRaises(TimeoutError): v.run(out=out, ledger=ledger, transport=Broken(), catalog={})
            summary = json.loads((out/'comparison.json').read_text())
            self.assertEqual(summary['status'], 'failed')
            self.assertEqual(summary['attempts'],2)
            self.assertEqual(len(json.loads((out/'validation-generations.json').read_text())),1)
            self.assertEqual(summary['judged_pairs'],0)

    def test_resume_reuses_outputs_and_counts_failed_judge(self):
        v = self.runner()
        checks = dict(intent=True, scope=True, clarification=True, consent=True, reason='evidence')
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)/'out'
            ledger = v.Ledger(Path(d)/'ledger.jsonl')
            calls = []
            class Interrupted:
                def call(self, messages, phase):
                    ledger.reserve(phase, messages)
                    if phase == 'validation-judge': raise TimeoutError('fake')
                    return 'preserved output'
            with patch.object(v, 'bootstrap', return_value={'validated':False}):
                with self.assertRaises(TimeoutError):
                    v.run(out=out, ledger=ledger, transport=Interrupted(), catalog={})
            before = (out/'comparison.json').read_bytes()
            class Recovery:
                def call(self, messages, phase):
                    ledger.reserve(phase, messages)
                    calls.append(phase)
                    if phase == 'validation-judge': return json.dumps({'A':checks,'B':checks})
                    return 'new output'
            result = v.resume(out, ledger, Recovery())
            self.assertEqual(result['judged_pairs'],12)
            self.assertEqual(result['status'],'completed')
            self.assertEqual(calls.count('validation-generation'),22)
            self.assertEqual(calls.count('validation-judge'),12)
            self.assertEqual(len(ledger.rows()),37)
            self.assertEqual((out/'comparison.json').read_bytes(), before)
            with self.assertRaises(RuntimeError): v.resume(out, ledger, Recovery())

    def test_resume_rejects_other_nonempty_ledger_before_network(self):
        v = self.runner()
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)/'out'
            ledger = v.Ledger(Path(d)/'original.jsonl')
            class Interrupted:
                def call(self, messages, phase):
                    ledger.reserve(phase, messages)
                    raise TimeoutError('fake')
            with patch.object(v, 'bootstrap', return_value={'validated':False}):
                with self.assertRaises(TimeoutError):
                    v.run(out=out, ledger=ledger, transport=Interrupted(), catalog={})
            wrong = v.Ledger(Path(d)/'other.jsonl')
            wrong.reserve('validation-generation', {})
            with patch('real_eval.credentials', side_effect=AssertionError('network')):
                with self.assertRaisesRegex(RuntimeError, 'ledger binding'):
                    v.resume(out, wrong)
            self.assertEqual(len(ledger.rows()), 1)
            self.assertEqual(len(wrong.rows()), 1)

    def test_transport_refuses_attempt_collision_before_network(self):
        v = self.runner()
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'attempt-001.json'
            path.write_text('original evidence')
            ledger = v.Ledger(Path(d)/'ledger.jsonl')
            def forbidden(*a, **kw): raise AssertionError('network')
            with patch('real_eval.verify_local_routing'):
                with self.assertRaises(FileExistsError):
                    v.Transport(ledger, d, 'fake', open_url=forbidden).call([], 'train-generation')
            self.assertEqual(path.read_text(), 'original evidence')
            self.assertEqual(ledger.rows(), [])

    def test_judgment_requires_nonempty_evidence_reason(self):
        v = self.runner()
        checks = dict(intent=True, scope=True, clarification=True, consent=True)
        for reason in (None, '', '  ', 1):
            with self.subTest(reason=reason):
                with self.assertRaisesRegex(ValueError, 'reason'):
                    v.parse_judgment(json.dumps({**checks, 'reason':reason}))
        self.assertEqual(v.parse_judgment(json.dumps({**checks, 'reason':'quoted evidence'}))['reason'], 'quoted evidence')

    def test_real_dspy_bootstrap_uses_only_six_train_inputs_and_fresh_demos(self):
        v = self.runner()
        try: import dspy
        except ImportError: self.skipTest('use eval/.venv/bin/python for actual DSPy seam')
        checks = dict(intent=True, scope=True, clarification=True, consent=True, reason='evidence')
        calls = []
        class Fake:
            def call(self, messages, phase):
                calls.append((messages, phase))
                return json.dumps(checks) if phase == 'train-judge' else 'new train response'
        with tempfile.TemporaryDirectory() as d:
            result = v.bootstrap(prepare_v2.load_bundle(), v.load_train(), Fake(), Path(d))
            self.assertEqual(len(result['demos']),6)
            self.assertFalse(result['validated'])
            self.assertEqual([p for _,p in calls].count('train-generation'),6)
            self.assertEqual([p for _,p in calls].count('train-judge'),6)
            self.assertTrue(all(len(m)==2 for m,p in calls if p=='train-generation'))
            self.assertTrue(all(d['response']=='new train response' for d in result['demos']))


if __name__ == '__main__': unittest.main()

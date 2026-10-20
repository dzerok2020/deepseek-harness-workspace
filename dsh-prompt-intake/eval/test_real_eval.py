import unittest, tempfile, json
from pathlib import Path
from real_eval import Ledger, Transport, public_case
from unittest.mock import patch
import sqlite3
import real_eval

class SafetyTests(unittest.TestCase):
    def routing_db(self, flag='false', name='BAI', prefix='b-ai', active=1):
        c=sqlite3.connect(':memory:')
        c.executescript('CREATE TABLE key_value(namespace TEXT,key TEXT,value TEXT); CREATE TABLE provider_nodes(id TEXT,type TEXT,name TEXT,prefix TEXT); CREATE TABLE provider_connections(id TEXT,provider TEXT,name TEXT,is_active INTEGER);')
        if flag is not None:
            c.execute('INSERT INTO key_value VALUES(?,?,?)',('feature_flags','OMNIROUTE_EMERGENCY_FALLBACK',flag))
        c.execute('INSERT INTO provider_nodes VALUES(?,?,?,?)',(real_eval.PROVIDER_ID,'openai-compatible',name,prefix))
        c.execute('INSERT INTO provider_connections VALUES(?,?,?,?)',('connection',real_eval.PROVIDER_ID,'main',active))
        return c
    def test_canonical_model_requires_verified_bai_identity(self):
        with self.routing_db() as c:
            result=real_eval.verify_routing(c,['b-ai/qwen3.8-flash'])
        self.assertEqual(result['model'],'b-ai/qwen3.8-flash')
        self.assertEqual(result['provider_name'],'BAI')
        self.assertFalse(result['emergency_fallback'])
    def test_preflight_rejects_unsafe_or_unverifiable_routes(self):
        for flag in (None,'true','0','FALSE','garbage'):
            with self.subTest(flag=flag), self.routing_db(flag=flag) as c:
                with self.assertRaisesRegex(RuntimeError,'Emergency fallback'):
                    real_eval.verify_routing(c,['b-ai/qwen3.8-flash'])
        for changes in ({'name':'other'},{'prefix':'other'},{'active':0}):
            with self.subTest(changes=changes), self.routing_db(**changes) as c:
                with self.assertRaises(RuntimeError): real_eval.verify_routing(c,['b-ai/qwen3.8-flash'])
        with self.routing_db() as c:
            with self.assertRaisesRegex(RuntimeError,'canonical model unavailable'):
                real_eval.verify_routing(c,['b-ai/qwen3.8-flash/BAI'])
    def test_transport_preflight_stops_before_attempt_or_network(self):
        with tempfile.TemporaryDirectory() as d:
            ledger=Ledger(Path(d)/'ledger.jsonl')
            def forbidden(*args,**kwargs): self.fail('HTTP called despite unsafe routing')
            t=Transport(ledger,Path(d),'unused',open_url=forbidden)
            with patch('real_eval.verify_local_routing',side_effect=RuntimeError('unsafe')):
                with self.assertRaisesRegex(RuntimeError,'unsafe'): t.call([], 'blocked')
            self.assertEqual(ledger.rows(),[])
    def test_credentials_preflight_stops_before_catalog_network(self):
        with patch('real_eval.verify_local_routing',side_effect=RuntimeError('unsafe')), patch('urllib.request.build_opener') as opener:
            with self.assertRaisesRegex(RuntimeError,'unsafe'): real_eval.credentials()
            opener.assert_not_called()
    def test_budget_restart_and_exhaustion(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'ledger.jsonl'
            ledger=Ledger(p)
            for _ in range(100): ledger.reserve('test', {})
            with self.assertRaises(RuntimeError): Ledger(p).reserve('overflow', {})
            self.assertEqual(len(p.read_text().splitlines()),100)
    def test_no_gold_leakage(self):
        case={'id':'x','prompt':'p','context':'c','expected':'SECRET_GOLD','forbiddenAssumptions':['SECRET_FORBIDDEN']}
        self.assertEqual(public_case(case),{'id':'x','prompt':'p','context':'c'})
    def test_failure_reserved_before_http_no_retry(self):
        with tempfile.TemporaryDirectory() as d:
            ledger=Ledger(Path(d)/'ledger.jsonl'); calls=[]
            def fail(req, timeout):
                self.assertEqual(len(ledger.rows()),1)
                calls.append(req); raise TimeoutError()
            t=Transport(ledger,Path(d),'unused',open_url=fail)
            with patch('real_eval.verify_local_routing'):
                with self.assertRaises(TimeoutError): t.call([], 'failure')
            self.assertEqual(len(calls),1)
            self.assertEqual(len(Ledger(ledger.path).rows()),1)
    def test_corrupt_ledger_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'ledger.jsonl';p.write_text('{truncated')
            with self.assertRaises(json.JSONDecodeError): Ledger(p).reserve('test',{})
            self.assertEqual(p.read_text(),'{truncated')
    def test_exhaustion_prevents_http(self):
        with tempfile.TemporaryDirectory() as d:
            ledger=Ledger(Path(d)/'ledger.jsonl')
            for _ in range(100): ledger.reserve('test',{})
            def forbidden(*args,**kwargs): self.fail('HTTP called after exhaustion')
            t=Transport(ledger,Path(d),'unused',open_url=forbidden)
            with patch('real_eval.verify_local_routing'):
                with self.assertRaisesRegex(RuntimeError,'budget exhausted'): t.call([], 'overflow')
    def test_dry_run_no_network(self):
        from real_eval import dry_plan
        self.assertEqual(dry_plan()['maximum_planned_attempts'],82)

if __name__=='__main__': unittest.main()

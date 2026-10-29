import importlib.util
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout, redirect_stderr
import io
import urllib.error


spec = importlib.util.spec_from_file_location('health', Path(__file__).parents[1] / 'tools/hindsight-health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class MemoryHealthTests(unittest.TestCase):
    def test_loopback_is_safe(self):
        self.assertEqual(health.unsafe_listeners('LISTEN 0 128 127.0.0.1:9077 0.0.0.0:*\nLISTEN 0 128 [::1]:9999 [::]:*', {'9077', '9999'}), [])

    def test_ipv4_ipv6_and_lan_are_rejected(self):
        for address in ['0.0.0.0:9077', '[::]:9077', '*:9999', '192.168.1.2:9999']:
            self.assertEqual(health.unsafe_listeners('LISTEN 0 128 ' + address + ' *:*', {'9077', '9999'}), [address])

    def test_unrelated_ports_are_ignored(self):
        self.assertEqual(health.unsafe_listeners('LISTEN 0 128 *:3080 *:*', {'9077', '9999'}), [])

    def test_empty_or_wrong_extraction_fails(self):
        for response in [{}, {'facts': []}, {'facts': [{'text': 'wrong value'}]}]:
            self.assertFalse(health.validate_extraction(response))

    def test_extraction_preserves_test_value(self):
        self.assertTrue(health.validate_extraction({'facts': [{'text': 'Project uses port 45678.'}]}))


class DiagnosticTests(unittest.TestCase):
    def run_health(self, effects, args=(), mode=0o100600, listeners=''):
        output = io.StringIO()
        with patch.object(health.Path, 'stat') as permissions, \
             patch.object(health.subprocess, 'run') as sockets, \
             patch.object(health.urllib.request, 'urlopen', side_effect=effects) as request, \
             patch.object(sys, 'argv', ['hindsight-health.py', *args]), \
             redirect_stdout(output):
            permissions.return_value.st_mode = mode
            sockets.return_value.stdout = listeners
            code = health.main()
        return code, output.getvalue(), request

    @staticmethod
    def response(data):
        response = io.BytesIO(data)
        response.status = 200
        return response

    def test_default_requests_only_health_and_reports_functional_skip(self):
        code, text, request = self.run_health([self.response(b'{}')])
        request.assert_called_once_with('http://127.0.0.1:9077/health', timeout=10)
        self.assertFalse(code)
        self.assertIn('BỎ QUA', text)
        self.assertIn('--functional', text)
        self.assertNotIn('ĐẠT: trích xuất LLM thật', text)

    def test_skip_functional_compatibility_alias_is_passive(self):
        code, text, request = self.run_health([self.response(b'{}')], args=('--skip-functional',))
        self.assertFalse(code)
        self.assertEqual(request.call_count, 1)
        self.assertIn('BỎ QUA', text)

    def test_passive_access_failures_still_fail(self):
        code, text, request = self.run_health(
            [self.response(b'{}')], mode=0o100644,
            listeners='LISTEN 0 128 0.0.0.0:9077 0.0.0.0:*')
        self.assertTrue(code)
        self.assertIn('group/other', text)
        self.assertIn('ngoài loopback', text)
        self.assertNotIn('ĐẠT', text)
        self.assertEqual(request.call_count, 1)

    def test_invalid_or_conflicting_flags_fail_before_checks(self):
        for args in [('--functonal',), ('--functional', '--skip-functional')]:
            with self.subTest(args=args), \
                 patch.object(sys, 'argv', ['hindsight-health.py', *args]), \
                 patch.object(health.Path, 'stat') as permissions, \
                 patch.object(health.subprocess, 'run') as sockets, \
                 patch.object(health.urllib.request, 'urlopen') as request, \
                 redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                permissions.return_value.st_mode = 0o100600
                sockets.return_value.stdout = ''
                with self.assertRaises(SystemExit) as raised:
                    health.main()
                self.assertEqual(raised.exception.code, 2)
                permissions.assert_not_called()
                sockets.assert_not_called()
                request.assert_not_called()

    def test_opted_in_provider_cooldown_is_deferred_not_local_failure(self):
        error = urllib.error.HTTPError('http://secret', 500, 'secret', {},
                                       io.BytesIO(b'ProviderRateLimitResetError model_cooldown secret'))
        code, text, request = self.run_health([self.response(b'{}'), error], args=('--functional',))
        self.assertFalse(code)
        self.assertEqual(request.call_count, 2)
        self.assertIn('ĐẠT (một phần)', text)
        self.assertIn('hoãn', text)
        self.assertNotIn('secret', text)

    def test_http_failure_reports_stage_status_not_secret(self):
        error = urllib.error.HTTPError('http://secret', 401, 'Bearer secret', {}, io.BytesIO(b'api_key=secret'))
        code, text, request = self.run_health([
            self.response(b'{}'), error,
        ], args=('--functional',))
        self.assertTrue(code)
        self.assertIn('trích xuất', text)
        self.assertIn('HTTP 401', text)
        self.assertIn('xác thực', text)
        self.assertNotIn('secret', text)
        self.assertNotIn('ĐẠT', text)
        self.assertEqual(request.call_count, 2)

    def test_http_categories_fail_closed(self):
        for status, category in [(403, 'xác thực'), (404, 'endpoint'), (405, 'endpoint'),
                                 (429, 'giới hạn'), (500, 'dịch vụ'), (503, 'dịch vụ'),
                                 (408, 'timeout'), (504, 'timeout'), (400, 'từ chối')]:
            with self.subTest(status=status):
                error = urllib.error.HTTPError('http://secret', status, 'secret', {}, None)
                code, text, _ = self.run_health([self.response(b'{}'), error], args=('--functional',))
                self.assertTrue(code)
                self.assertIn(f'HTTP {status}', text)
                self.assertIn(category, text)
                self.assertNotIn('secret', text)
                self.assertNotIn('ĐẠT', text)

    def test_connection_failure_never_calls_extraction(self):
        for error in [TimeoutError('secret'), urllib.error.URLError(TimeoutError('secret')),
                      urllib.error.URLError('secret')]:
            with self.subTest(error=type(error).__name__):
                code, text, request = self.run_health([error], args=('--functional',))
                self.assertTrue(code)
                self.assertIn('kết nối thất bại', text)
                self.assertEqual(request.call_count, 1)
                self.assertNotIn('secret', text)
                self.assertNotIn('ĐẠT', text)

    def test_invalid_responses_fail_closed(self):
        for body in [b'not-json secret', b'null', b'[]', b'{}', b'{"facts": []}']:
            code, text, _ = self.run_health([self.response(b'{}'), self.response(body)], args=('--functional',))
            self.assertTrue(code)
            self.assertNotIn('ĐẠT', text)
            self.assertNotIn('secret', text)

    def test_success_checks_both_endpoints_without_storing(self):
        code, text, request = self.run_health([
            self.response(b'{}'), self.response(b'{"facts":[{"text":"port 45678"}]}')], args=('--functional',))
        self.assertFalse(code)
        self.assertIn('ĐẠT', text)
        self.assertEqual(request.call_args_list[0].args[0], 'http://127.0.0.1:9077/health')
        extraction = request.call_args_list[1].args[0]
        self.assertTrue(extraction.full_url.endswith('/memories/dry-run-extract'))
        self.assertEqual(extraction.get_method(), 'POST')

    def test_permission_failure_cannot_report_pass(self):
        output = io.StringIO()
        with patch.object(health.Path, 'stat', side_effect=PermissionError('secret')), \
             patch.object(sys, 'argv', ['hindsight-health.py']), redirect_stdout(output):
            self.assertTrue(health.main())
        self.assertIn('bảo vệ truy cập', output.getvalue())
        self.assertNotIn('secret', output.getvalue())
        self.assertNotIn('ĐẠT', output.getvalue())


if __name__ == '__main__':
    unittest.main()

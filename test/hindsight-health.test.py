import importlib.util
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import unittest

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


if __name__ == '__main__':
    unittest.main()

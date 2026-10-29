import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SOURCE = Path(__file__).resolve().parents[1] / '9router-start.sh'


class ProcessSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='9router-offline-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / '9router-app'
        self.data = self.root / 'data'
        self.proc = self.root / 'proc'
        self.node = self.root / 'node'
        self.node.write_text('fixture executable, never run')
        for directory in (self.app, self.data, self.proc):
            directory.mkdir()
        self.cli = str(self.app / 'node_modules/9router/cli.js')
        self.server = str(self.app / 'node_modules/9router/app/custom-server.js')
        self.pidfile = self.data / '9router.pid'
        self.sent = []
        self.opened = []

    def load(self):
        source = SOURCE.read_text()
        self.assertIn("<<'PY_PROCESS'", source, 'stop must use a process-identity gate, not blind kill')
        code = source.split("<<'PY_PROCESS'\n", 1)[1].split('\nPY_PROCESS', 1)[0]
        namespace = {'__name__': 'offline_fixture'}
        exec(compile(code, '9router-process-helper', 'exec'), namespace)
        namespace['PROC'] = self.proc
        return namespace

    def process(self, pid, start, argv, ppid=1, state='S'):
        directory = self.proc / str(pid)
        directory.mkdir(exist_ok=True)
        # /proc/stat field 22 = starttime. Include spaces and ')' in comm.
        fields = [state, str(ppid)] + ['0'] * 17 + [str(start)] + ['0'] * 4
        (directory / 'stat').write_text(f'{pid} (node fixture) title) ' + ' '.join(fields))
        (directory / 'cmdline').write_bytes(b'\0'.join(str(arg).encode() for arg in argv) + b'\0')
        executable = directory / 'exe'
        if executable.is_symlink():
            executable.unlink()
        executable.symlink_to(self.node)
        (directory / 'fd').mkdir(exist_ok=True)
        (directory / 'net').mkdir(exist_ok=True)
        task = directory / 'task' / str(pid)
        task.mkdir(parents=True, exist_ok=True)
        (task / 'children').write_text('')
        return directory

    def known(self):
        self.process(4101, 100, [self.node, self.cli, '--port', '20129', '--host', '127.0.0.1', '--no-browser', '--skip-update', '--log'])
        child = self.process(4102, 200, [self.node, '--dns-result-order=ipv4first', '--max-old-space-size=6144', self.server], ppid=4101)
        (self.proc / '4101/task/4101/children').write_text('4102')
        socket_fd = child / 'fd/19'
        if socket_fd.is_symlink():
            socket_fd.unlink()
        socket_fd.symlink_to('socket:[9876]')
        self.tcp(child)
        self.pidfile.write_text(json.dumps({'pid': 4101, 'start': '100', 'uid': os.getuid(), 'exe': str(self.node)}))
        return child

    def tcp(self, child, address='0100007F:4EA1', inode='9876'):
        (child / 'net/tcp').write_text('header\n   0: ' + address + ' 00000000:0000 0A 0:0 00:0 0 0 0 ' + inode + ' 1\n')

    def run_helper(self, namespace, mode='stop', on_open=None, on_signal=None, pidfd_supported=True):
        def open_pidfd(pid, flags=0):
            self.opened.append(pid)
            if on_open:
                on_open(pid)
            return pid + 10000

        def send(pidfd, sig, *_args):
            self.sent.append((pidfd - 10000, sig))
            if on_signal:
                on_signal(pidfd - 10000, sig)

        with patch.object(sys, 'argv', ['helper', mode, str(self.app), str(self.data), '127.0.0.1', '20129', '4101']), \
             patch.object(os, 'pidfd_open', open_pidfd if pidfd_supported else None), patch.object(os, 'close'), \
             patch.object(signal, 'pidfd_send_signal', send), patch('time.sleep'), \
             contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            try:
                return namespace['main']()
            except (RuntimeError, ValueError, OSError):
                return 1

    def test_stale_pid_never_reaches_shell_signal_or_pkill(self):
        tools = self.root / 'tools'
        tools.mkdir()
        script = tools / '9router-start.sh'
        script.write_text(SOURCE.read_text())
        self.pidfile.write_text('4101\n')
        env = {**os.environ, 'NINEROUTER_DATA': str(self.data), 'SIGNAL_LOG': str(self.root / 'signals')}
        # Even the vulnerable baseline cannot signal anything: Bash functions
        # replace ALL kill/pkill calls; the Python helper rejects this legacy PID.
        result = subprocess.run(['/bin/bash', '-c', 'kill() { echo "kill $*" >> "$SIGNAL_LOG"; return 1; }; pkill() { echo "pkill $*" >> "$SIGNAL_LOG"; return 1; }; export -f kill pkill; bash "$1" --stop', 'fixture', str(script)], env=env, text=True, capture_output=True, timeout=5)
        log = self.root / 'signals'
        self.assertFalse(log.exists(), result.stdout + result.stderr + (log.read_text() if log.exists() else ''))

    def test_missing_pidfile_never_uses_path_pattern_signals(self):
        tools = self.root / 'tools'
        tools.mkdir()
        script = tools / '9router-start.sh'
        script.write_text(SOURCE.read_text())
        env = {**os.environ, 'NINEROUTER_DATA': str(self.data), 'SIGNAL_LOG': str(self.root / 'signals')}
        result = subprocess.run(['/bin/bash', '-c', 'kill() { echo "kill $*" >> "$SIGNAL_LOG"; return 1; }; pkill() { echo "pkill $*" >> "$SIGNAL_LOG"; return 1; }; export -f kill pkill; bash "$1" --stop', 'fixture', str(script)], env=env, text=True, capture_output=True, timeout=5)
        self.assertFalse((self.root / 'signals').exists(), result.stdout + result.stderr)

    def test_record_captures_verified_launch_generation(self):
        namespace = self.load()
        self.known()
        self.pidfile.unlink()
        self.assertEqual(self.run_helper(namespace, 'record'), 0)
        self.assertEqual(json.loads(self.pidfile.read_text()), {'pid': 4101, 'start': '100', 'uid': os.getuid(), 'exe': str(self.node)})
        self.assertEqual(self.sent, [])

    def test_verified_listener_only_and_no_cli_cleanup_handler(self):
        namespace = self.load()
        self.known()
        self.assertEqual(self.run_helper(namespace), 0)
        self.assertEqual(self.sent, [(4101, signal.SIGKILL), (4102, signal.SIGTERM), (4102, signal.SIGKILL)])
        self.assertFalse(self.pidfile.exists())

    def test_exited_child_needs_no_escalation(self):
        namespace = self.load()
        self.known()
        def after(pid, sig):
            if pid == 4102 and sig == signal.SIGTERM:
                (self.proc / '4102/stat').unlink()
        self.assertEqual(self.run_helper(namespace, on_signal=after), 0)
        self.assertEqual(self.sent, [(4101, signal.SIGKILL), (4102, signal.SIGTERM)])

    def test_wrong_identity_and_listener_are_never_signalled(self):
        for drift in ('generation', 'owner', 'argv', 'exe', 'listener-port', 'listener-owner', 'parent', 'record-missing-start'):
            with self.subTest(drift=drift):
                namespace = self.load()
                child = self.known()
                saved = json.loads(self.pidfile.read_text())
                if drift == 'generation': saved['start'] = '99'
                if drift == 'owner': saved['uid'] += 1
                if drift == 'record-missing-start': saved.pop('start')
                self.pidfile.write_text(json.dumps(saved))
                if drift == 'argv': (self.proc / '4101/cmdline').write_bytes(b'node\0unrelated.js\0')
                if drift == 'exe':
                    (self.proc / '4101/exe').unlink()
                    (self.proc / '4101/exe').symlink_to(self.root / 'python')
                if drift == 'listener-port': self.tcp(child, address='0100007F:4EA0')
                if drift == 'listener-owner': self.tcp(child, inode='9999')
                if drift == 'parent': self.process(4102, 200, [self.node, '--dns-result-order=ipv4first', '--max-old-space-size=6144', self.server], ppid=9999)
                self.run_helper(namespace)
                self.assertEqual(self.sent, [], drift)

    def test_pid_reuse_while_pinning_fails_before_any_signal(self):
        namespace = self.load()
        self.known()
        def reuse(pid):
            if pid == 4102:
                self.process(pid, 201, [self.node, 'unrelated.js'], ppid=4101)
        self.run_helper(namespace, on_open=reuse)
        self.assertEqual(self.sent, [])

    def test_listener_identity_rechecked_after_term_before_kill(self):
        namespace = self.load()
        self.known()
        def reuse(pid, sig):
            if pid == 4102 and sig == signal.SIGTERM:
                self.process(pid, 201, [self.node, 'unrelated.js'], ppid=4101)
        self.run_helper(namespace, on_signal=reuse)
        self.assertEqual(self.sent, [(4101, signal.SIGKILL), (4102, signal.SIGTERM)])

    def next_title(self, child, title='next-server (v16.4.2)', cwd=None):
        server_dir = self.app / 'node_modules/9router/app'
        manifest = server_dir / 'node_modules/next/package.json'
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(json.dumps({'version': '16.4.2'}))
        (child / 'cmdline').write_bytes(title.encode() + b'\0' * 20)
        (child / 'cwd').symlink_to(cwd or server_dir)

    def test_next_rewritten_title_requires_exact_local_version_and_app_cwd(self):
        namespace = self.load()
        child = self.known()
        self.next_title(child)
        self.assertEqual(self.run_helper(namespace), 0)
        self.assertEqual(self.sent, [(4101, signal.SIGKILL), (4102, signal.SIGTERM), (4102, signal.SIGKILL)])

    def test_next_title_with_wrong_version_or_cwd_never_signals(self):
        for drift in ('title', 'cwd'):
            with self.subTest(drift=drift):
                namespace = self.load()
                child = self.known()
                cwd = child / 'cwd'
                if cwd.is_symlink():
                    cwd.unlink()
                self.next_title(child, title='next-server (v99.0.0)' if drift == 'title' else 'next-server (v16.4.2)',
                                cwd=self.root if drift == 'cwd' else None)
                self.run_helper(namespace)
                self.assertEqual(self.sent, [])

    def test_no_pidfd_support_fails_closed(self):
        namespace = self.load()
        self.known()
        self.run_helper(namespace, pidfd_supported=False)
        self.assertEqual(self.sent, [])


if __name__ == '__main__':
    unittest.main()

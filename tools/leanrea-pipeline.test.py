"""Acceptance tests: trusted helper must never execute the supplied software."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import struct
import sys
import tarfile
import types
import zipfile
from unittest import mock
from pathlib import Path
import subprocess
import tempfile
import unittest

sys.dont_write_bytecode = True
PIPELINE = Path(__file__).resolve().parents[1] / '.dsh/skills/leanrea/scripts/static_pipeline.py'


class PipelineTests(unittest.TestCase):
    def test_local_source_reports_evidence_without_running_scripts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'app'
            source.mkdir()
            payload = b'{"name":"fixture-app","version":"1.2.3","main":"main.js","scripts":{"postinstall":"touch SHOULD_NOT_EXIST"},"dependencies":{"electron":"^30.0.0"}}'
            (source / 'package.json').write_bytes(payload)
            (source / 'main.js').write_text('ipcMain.handle("hello", () => 42);\n')
            result = subprocess.run(['python3', str(PIPELINE), str(source), '--output-root', str(root / 'runs')], text=True, capture_output=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            run = Path(json.loads(result.stdout)['run_dir'])
            report = json.loads((run / 'report.json').read_text())
            self.assertEqual(report['schema_version'], 1)
            self.assertEqual(report['status'], 'complete')
            package = next(item for item in report['files'] if item['path'] == 'package.json')
            self.assertEqual(package['sha256'], hashlib.sha256(payload).hexdigest())
            self.assertTrue(any(item['kind'] == 'package' and item['data']['name'] == 'fixture-app' for item in report['seen']))
            self.assertTrue(any(item['kind'] == 'electron-ipc' for item in report['seen']))
            self.assertFalse((source / 'SHOULD_NOT_EXIST').exists())
            self.assertFalse((run / 'SHOULD_NOT_EXIST').exists())
            self.assertEqual(run.stat().st_mode & 0o777, 0o700)
            self.assertIn('unknown', report)
            self.assertIn('UNTRUSTED', (run / 'report.md').read_text())
            self.assertIn(hashlib.sha256(payload).hexdigest(), (run / 'report.md').read_text())

    def invoke(self, target, root, *extra):
        result = subprocess.run(['python3', str(PIPELINE), str(target), '--output-root', str(root), *extra], text=True, capture_output=True, timeout=15)
        if not result.stdout.strip():
            return result, None, None
        run = Path(json.loads(result.stdout)['run_dir'])
        return result, json.loads((run / 'report.json').read_text()), run

    def test_archive_members_are_read_without_extraction(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / 'app.zip'
            with zipfile.ZipFile(archive, 'w') as handle:
                handle.writestr('app/package.json', '{"name":"archived-app","version":"2"}')
                handle.writestr('app/start.py', 'raise RuntimeError("MUST NOT RUN")')
            result, report, run = self.invoke(archive, root / 'runs')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(any(item['kind'] == 'package' for item in report['seen']))
            self.assertEqual(sorted(path.name for path in run.iterdir()), ['report.json', 'report.md'])
            self.assertFalse(report['safety']['archive_extracted_to_disk'])
            for path in run.iterdir():
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_hostile_zip_names_links_and_collisions_are_blocked(self):
        variants = [('../escape', b'x'), ('/absolute', b'x'), ('C:/windows', b'x'), ('a\\escape', b'x'), ('duplicates', b'x'), ('collision', b'x'), ('symlink', b'x')]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for index, (name, data) in enumerate(variants):
                with self.subTest(name=name):
                    archive = root / f'{index}.zip'
                    with zipfile.ZipFile(archive, 'w') as handle:
                        if name == 'duplicates':
                            handle.writestr('a/b', data)
                            handle.writestr('a/./b', data)
                        elif name == 'collision':
                            handle.writestr('a', data)
                            handle.writestr('a/b', data)
                        elif name == 'symlink':
                            info = zipfile.ZipInfo('link')
                            info.external_attr = 0o120777 << 16
                            handle.writestr(info, b'/etc/passwd')
                        else:
                            handle.writestr(name, data)
                    result, report, _ = self.invoke(archive, root / 'runs')
                    self.assertEqual(result.returncode, 2)
                    self.assertEqual(report['status'], 'blocked')
            self.assertFalse((root / 'escape').exists())

    def test_tar_hardlink_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / 'app.tar'
            with tarfile.open(archive, 'w') as handle:
                info = tarfile.TarInfo('outside')
                info.type, info.linkname = tarfile.LNKTYPE, '/etc/passwd'
                handle.addfile(info)
            result, report, _ = self.invoke(archive, root / 'runs')
            self.assertEqual(result.returncode, 2)
            self.assertEqual(report['status'], 'blocked')

    @staticmethod
    def asar(files):
        payload, entries = b'', {}
        for name, data in files.items():
            entries[name] = {'size': len(data), 'offset': str(len(payload))}
            payload += data
        encoded = json.dumps({'files': entries}).encode()
        padding = b'\x00' * ((-len(encoded)) % 4)
        header_size = 8 + len(encoded) + len(padding)
        return struct.pack('<4I', 4, header_size, header_size - 4, len(encoded)) + encoded + padding + payload

    def test_asar_valid_and_out_of_bounds(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / 'app.asar'
            payload = self.asar({'package.json': b'{"name":"electron-fixture"}', 'main.js': b'ipcMain.handle("test", () => 1);'})
            archive.write_bytes(payload)
            result, report, _ = self.invoke(archive, root / 'runs')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(any(item['kind'] == 'electron-ipc' for item in report['seen']))
            archive.write_bytes(payload[:-1])
            result, report, _ = self.invoke(archive, root / 'runs')
            self.assertEqual(result.returncode, 2)
            self.assertEqual(report['status'], 'blocked')

    def test_symlinks_and_special_files_are_not_opened(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            outside = root / 'private.txt'
            outside.write_text('PRIVATE_CANARY')
            source = root / 'app'
            source.mkdir()
            (source / 'link').symlink_to(outside)
            os.mkfifo(source / 'pipe')
            result, report, _ = self.invoke(source, root / 'runs')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(report['status'], 'partial')
            self.assertEqual(report['files'], [])
            self.assertNotIn('PRIVATE_CANARY', json.dumps(report))
            (root / 'indirect').symlink_to(source, target_is_directory=True)
            result, report, _ = self.invoke(root / 'indirect' / 'link', root / 'runs')
            self.assertEqual(result.returncode, 2)

    def test_symlink_parent_cannot_expose_regular_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'private'
            source.mkdir()
            (source / 'data.txt').write_text('PRIVATE_PARENT_CANARY')
            (root / 'indirect').symlink_to(source, target_is_directory=True)
            result, report, _ = self.invoke(root / 'indirect' / 'data.txt', root / 'runs')
            self.assertEqual(result.returncode, 2)
            self.assertNotIn('PRIVATE_PARENT_CANARY', json.dumps(report))

    def test_output_root_inside_source_is_rejected_before_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'app'
            source.mkdir()
            output = source / 'reports'
            result = subprocess.run(['python3', str(PIPELINE), str(source), '--output-root', str(output)], capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 2)
            self.assertFalse(output.exists())

    def test_url_requires_download_and_report_redacts_credentials(self):
        spec = importlib.util.spec_from_file_location('trusted_pipeline', PIPELINE)
        pipeline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(pipeline)
        fake_network = types.SimpleNamespace(download=mock.Mock(side_effect=AssertionError('network must not run')), DownloadError=RuntimeError)
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(sys.modules, {'public_https': fake_network}), contextlib.redirect_stdout(io.StringIO()) as output:
            code = pipeline.main(['https://username:TOP_SECRET@example.com/app?token=QUERY_SECRET', '--output-root', tmp])
            run = Path(json.loads(output.getvalue())['run_dir'])
            report = (run / 'report.json').read_text()
            self.assertEqual(code, 2)
            fake_network.download.assert_not_called()
            self.assertNotIn('TOP_SECRET', report)
            self.assertNotIn('QUERY_SECRET', report)

    def test_homepage_lists_links_without_following_or_preview_injection(self):
        spec = importlib.util.spec_from_file_location('trusted_pipeline', PIPELINE)
        pipeline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(pipeline)
        payload = b'<html><a href="https://example.com/app.zip?secret=PRIVATE">Download</a><script src="https://example.com/run.js"></script>![track](https://evil.test/x)<script>alert(1)</script></html>'

        def download(url, destination, **kwargs):
            destination.write_bytes(payload)
            return {'url': url, 'final_url': url, 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(), 'content_type': 'text/html', 'redirects': []}

        fake_network = types.SimpleNamespace(download=mock.Mock(side_effect=download), DownloadError=RuntimeError)
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(sys.modules, {'public_https': fake_network}), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(pipeline.main(['https://example.com/', '--download', '--output-root', tmp]), 0)
            run = Path(json.loads(output.getvalue())['run_dir'])
            report = json.loads((run / 'report.json').read_text())
            fake_network.download.assert_called_once()
            links = next(item['data'] for item in report['seen'] if item['kind'] == 'homepage-links-not-fetched')
            self.assertEqual(len(links), 2)
            self.assertNotIn('PRIVATE', json.dumps(report))
            preview = (run / 'report.md').read_text()
            self.assertNotIn('<script>', preview)
            self.assertNotIn('<img', preview)
            self.assertNotIn('<a href', preview)

    def test_zip_entry_budget_rejects_before_metadata_materialization(self):
        spec = importlib.util.spec_from_file_location('trusted_pipeline', PIPELINE)
        pipeline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(pipeline)
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, 'w') as archive:
            for index in range(pipeline.MAX_FILES + 1):
                archive.writestr(f'f{index}', b'')
        with mock.patch.object(pipeline.zipfile, 'ZipFile') as parser:
            with self.assertRaises(pipeline.InspectionError):
                pipeline.Inspector({}).archive('many.zip', payload.getvalue())
            parser.assert_not_called()

    def test_asar_duplicate_keys_are_not_silently_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            encoded = b'{"files":{"a":{"size":0,"offset":"0"},"a":{"size":0,"offset":"0"}}}'
            padding = b'\x00' * ((-len(encoded)) % 4)
            size = 8 + len(encoded) + len(padding)
            archive = root / 'duplicate.asar'
            archive.write_bytes(struct.pack('<4I', 4, size, size - 4, len(encoded)) + encoded + padding)
            result, report, _ = self.invoke(archive, root / 'runs')
            self.assertEqual(result.returncode, 2)
            self.assertEqual(report['status'], 'blocked')

    def test_sensitive_excerpt_and_sample_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'app'
            source.mkdir()
            (source / 'main.js').write_text('ipcMain.handle("x", () => { const token="DO_NOT_REPORT"; });\n' + ' ' * (256 * 1024))
            result, report, _ = self.invoke(source, root / 'runs')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(report['status'], 'partial')
            self.assertNotIn('DO_NOT_REPORT', json.dumps(report))
            self.assertTrue(report['coverage']['truncated'])

    def test_evidence_caps_are_visible_as_partial_coverage(self):
        fixtures = {
            'package.json': json.dumps({'name': 'n' * 501, 'dependencies': {f'd{i}': '1' for i in range(51)}}).encode(),
            'main.js': ('ipcMain.handle("x", () => 42);' + ' ' * 450 + '\n').encode() * 13,
            'urls.txt': '\n'.join(f'https://example.com/{i}' for i in range(13)).encode(),
            'strings.bin': b'\x00' + b'\x00'.join(f'printable-string-{i}'.encode() for i in range(31)),
            'page.html': ('<html>' + ''.join(f'<a href="https://example.com/{i}">x</a>' for i in range(41)) + '</html>').encode(),
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name, payload in fixtures.items():
                with self.subTest(name=name):
                    target = root / name
                    target.write_bytes(payload)
                    result, report, _ = self.invoke(target, root / 'runs')
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(report['status'], 'partial')
                    self.assertTrue(report['coverage']['truncated'])
                    self.assertTrue(report['coverage']['skipped'])

    def test_malformed_urls_never_retain_raw_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            for target in ('https://user:TOP_SECRET@example.com:bad/file?token=QUERY_SECRET',
                           'https://user:TOP_SECRET@[broken/file?token=QUERY_SECRET'):
                with self.subTest(target=target):
                    result, report, run = self.invoke(target, Path(tmp) / 'runs')
                    self.assertEqual(result.returncode, 2)
                    output = result.stdout + result.stderr + (run / 'report.json').read_text()
                    self.assertNotIn('TOP_SECRET', output)
                    self.assertNotIn('QUERY_SECRET', output)
                    self.assertEqual(report['status'], 'blocked')

    def test_empty_directory_count_and_depth_are_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            wide = root / 'wide'
            wide.mkdir()
            for index in range(1501):
                (wide / str(index)).mkdir()
            deep = root / 'deep'
            nested = deep
            for index in range(34):
                nested /= 'd'
            nested.mkdir(parents=True)
            for target in (wide, deep):
                with self.subTest(target=target.name):
                    result, report, _ = self.invoke(target, root / 'runs')
                    self.assertEqual(result.returncode, 2)
                    self.assertEqual(report['status'], 'blocked')
                    self.assertTrue(any(any(word in value.lower() for word in ('limit', 'budget', 'nesting')) for value in report['unknown']))

    def test_tar_metadata_and_decompressed_stream_are_bounded_before_parser(self):
        spec = importlib.util.spec_from_file_location('trusted_pipeline', PIPELINE)
        pipeline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(pipeline)
        for mode in ('w', 'w:gz', 'w:bz2', 'w:xz'):
            with self.subTest(mode=mode):
                payload = io.BytesIO()
                with tarfile.open(fileobj=payload, mode=mode, format=tarfile.GNU_FORMAT) as archive:
                    metadata = tarfile.TarInfo('././@LongLink')
                    metadata.type = tarfile.GNUTYPE_LONGNAME
                    metadata.size = 4096
                    archive.addfile(metadata, io.BytesIO(b'a' * 4095 + b'\x00'))
                    member = tarfile.TarInfo('short')
                    member.size = 1
                    archive.addfile(member, io.BytesIO(b'x'))
                for budget in ('MAX_EXPANDED', 'MAX_HEADER'):
                    with self.subTest(budget=budget), mock.patch.object(pipeline, budget, 1024), mock.patch.object(pipeline.tarfile, 'open') as parser:
                        with self.assertRaises(pipeline.InspectionError):
                            pipeline.Inspector({}).archive('metadata.tar', payload.getvalue())
                        parser.assert_not_called()

    def test_pax_extensions_are_rejected_before_tarfile_parsing(self):
        spec = importlib.util.spec_from_file_location('trusted_pipeline', PIPELINE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        member = tarfile.TarInfo('hidden-body')
        member.size = 2048
        member.pax_headers = {'size': '1'}
        data = member.tobuf(format=tarfile.PAX_FORMAT) + b'x' * 2048 + b'\0' * 1024
        with mock.patch.object(module.tarfile, 'open') as parser:
            with self.assertRaises(module.InspectionError):
                module.bounded_tar(data)
            parser.assert_not_called()

    def test_directory_size_cannot_hide_tar_metadata_from_preflight(self):
        spec = importlib.util.spec_from_file_location('trusted_pipeline', PIPELINE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        extension = tarfile.TarInfo('././@LongLink')
        extension.type = tarfile.GNUTYPE_LONGNAME
        extension.size = 4096
        tail = tarfile.TarInfo('short')
        tail.size = 1
        hidden = extension.tobuf(format=tarfile.GNU_FORMAT) + b'a' * 4095 + b'\0' + tail.tobuf() + b'x' + b'\0' * 511
        directory = tarfile.TarInfo('directory/')
        directory.type = tarfile.DIRTYPE
        directory.size = len(hidden)
        data = directory.tobuf(format=tarfile.GNU_FORMAT) + hidden + b'\0' * 1024
        with mock.patch.object(module, 'MAX_HEADER', 1024), mock.patch.object(module.tarfile, 'open') as parser:
            with self.assertRaises(module.InspectionError):
                module.Inspector({}).archive('differential.tar', data)
            parser.assert_not_called()

    def test_compressed_tar_reports_package_without_extraction(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for mode in ('w:gz', 'w:bz2', 'w:xz'):
                with self.subTest(mode=mode):
                    source = root / mode.replace(':', '.')
                    content = b'{"name":"compressed-app"}'
                    with tarfile.open(source, mode=mode) as archive:
                        member = tarfile.TarInfo('package.json')
                        member.size = len(content)
                        archive.addfile(member, io.BytesIO(content))
                    result, report, run = self.invoke(source, root / 'runs')
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertTrue(any(item['kind'] == 'package' for item in report['seen']))
                    self.assertEqual(len(list(run.iterdir())), 2)

    def test_unreadable_directory_is_reported_as_incomplete(self):
        if os.geteuid() == 0:
            self.skipTest('Permission denial fixture requires an unprivileged user')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'app'
            denied = source / 'denied'
            denied.mkdir(parents=True)
            (source / 'visible.txt').write_text('visible')
            (denied / 'hidden.txt').write_text('hidden')
            denied.chmod(0)
            try:
                result, report, _ = self.invoke(source, root / 'runs')
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(report['status'], 'partial')
                self.assertTrue(report['coverage']['truncated'])
                self.assertTrue(any('denied' in str(item) for item in report['coverage']['skipped']))
            finally:
                denied.chmod(0o700)

    def test_archive_html_relative_links_do_not_invent_public_urls(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'app.zip'
            with zipfile.ZipFile(source, 'w') as archive:
                archive.writestr('index.html', '<html><script src="renderer.js"></script></html>')
            result, report, _ = self.invoke(source, root / 'runs')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(any(item['kind'] == 'homepage-links-not-fetched' for item in report['seen']))


if __name__ == '__main__':
    unittest.main()

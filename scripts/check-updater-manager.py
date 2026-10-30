"""Exercise verified manager refresh with real candidate Python processes and no Docker."""
import copy
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('manager_refresh_checks', 'collector/crowsnest')
spec = importlib.util.spec_from_loader(loader.name, loader)
u = importlib.util.module_from_spec(spec)
loader.exec_module(u)
SOURCE = Path('collector/crowsnest').read_text()


def candidate(manager_version='1.1.0', protocol=1):
    metadata = {**u.METADATA, 'managerVersion': manager_version, 'protocol': protocol, 'minimumProtocol': 1}
    return SOURCE.replace('__MANAGER_METADATA__', json.dumps(metadata, separators=(',', ':'))).encode()


def release(body=None, manager_version='1.1.0', protocol=1):
    body = candidate(manager_version, protocol) if body is None else body
    return {'schema': 1, 'version': '0.11.2', 'protocol': protocol,
            'images': {role: repo + '@sha256:' + 'a' * 64 for role, repo in u.IMAGES.items()},
            'manager': {'version': manager_version, 'minimumVersion': '1.0.0',
                        'sha256': hashlib.sha256(body).hexdigest()}}


def published():
    prefix = 'https://github.com/' + u.REPOSITORY + '/releases/download/collector-v0.11.2/'
    return {'tag_name': 'collector-v0.11.2', 'draft': False, 'prerelease': False,
            'assets': [{'name': name, 'browser_download_url': prefix + name}
                       for name in ['collector-release.json', 'crowsnest']]}


class Refresh(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='crowsnest-refresh-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.manager = u.Manager(self.root)
        self.manager.acquire()
        self.addCleanup(self.manager.lock.close)
        self.target = self.root / 'crowsnest'
        self.original = candidate(u.MANAGER_VERSION)
        self.target.write_bytes(self.original)
        self.target.chmod(0o700)
        self.credentials = self.root / 'collector.json'
        self.credentials.write_text('private installation remains untouched')

    def refresh(self, body, manifest=None):
        with patch.object(u, 'download_bytes', return_value=body), patch.object(u, 'Engine', side_effect=AssertionError('must not use Docker')):
            u.refresh_manager(self.manager, manifest or release(body), self.target)

    def assert_unchanged(self):
        self.assertEqual(self.target.read_bytes(), self.original)
        self.assertEqual(self.credentials.read_text(), 'private installation remains untouched')
        self.assertFalse(list(self.root.glob('.crowsnest-manager-*')))

    def test_verified_refresh_runs_real_probe_and_keeps_private_backup(self):
        body = candidate()
        self.refresh(body)
        self.assertEqual(self.target.read_bytes(), body)
        backup = self.manager.directory / 'manager.previous'
        self.assertEqual(backup.read_bytes(), self.original)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.credentials.read_text(), 'private installation remains untouched')
        # A packaged manager works without its source checkout or sibling metadata.
        probe = json.loads(u.run([u.sys.executable, '-I', '-B', str(self.target), 'manager-info']))
        self.assertEqual(probe['version'], '1.1.0')
        self.assertFalse(list(self.root.glob('.crowsnest-manager-*')))

    def test_checksum_mismatch_never_executes_or_replaces_candidate(self):
        with patch.object(u, 'run', side_effect=AssertionError('must not execute unverified download')):
            with self.assertRaisesRegex(u.Error, 'checksum mismatch'):
                self.refresh(candidate() + b'\n', release(candidate()))
        self.assert_unchanged()

    def test_invalid_python_and_failed_probe_leave_installed_manager_intact(self):
        for body in [b'not python code !', b'raise SystemExit(2)\n']:
            with self.subTest(body=body), self.assertRaises(u.Error):
                self.refresh(body)
            self.assert_unchanged()

    def test_probe_must_match_advertised_version_and_support_protocol(self):
        for manifest in [release(manager_version='1.2.0'), release(protocol=2)]:
            manifest['manager']['sha256'] = hashlib.sha256(candidate()).hexdigest()
            with self.assertRaisesRegex(u.Error, 'advertised release'):
                self.refresh(candidate(), manifest)
            self.assert_unchanged()

    def test_future_protocol_manager_can_be_refreshed_before_container_upgrade(self):
        body = candidate(protocol=2)
        self.refresh(body, release(body, protocol=2))
        self.assertEqual(json.loads(u.run([u.sys.executable, '-I', '-B', str(self.target), 'manager-info']))['protocol'], 2)

    def test_no_downgrade_or_refresh_during_pending_recovery(self):
        with self.assertRaisesRegex(u.Error, 'downgrade'):
            self.refresh(candidate('0.9.0'), release(manager_version='0.9.0'))
        self.assert_unchanged()
        u.atomic_json(self.manager.directory / 'pending.json', {'previous': {}})
        with self.assertRaisesRegex(u.Error, 'pending collector rollback'):
            self.refresh(candidate())
        self.assert_unchanged()

    def test_executable_and_backup_symlinks_and_shared_writes_are_refused(self):
        self.target.chmod(0o777)
        with self.assertRaisesRegex(u.Error, 'not writable'):
            self.refresh(candidate())
        self.target.chmod(0o700)
        backup = self.manager.directory / 'manager.previous'
        backup.symlink_to(self.credentials)
        with self.assertRaisesRegex(u.Error, 'symbolic link'):
            self.refresh(candidate())
        backup.unlink()
        self.target.unlink()
        self.target.symlink_to(self.credentials)
        with self.assertRaisesRegex(u.Error, 'symbolic link'):
            self.refresh(candidate())
        self.assertEqual(self.credentials.read_text(), 'private installation remains untouched')

    def test_self_update_cli_does_not_need_docker_or_modify_container_policy(self):
        self.manager.lock.close()
        policy = {'enabled': True, 'window': '02:00-04:00', 'timezone': 'UTC'}
        u.atomic_json(self.manager.directory / 'auto-update.json', policy)
        with patch.object(u.sys, 'argv', ['crowsnest', '--directory', str(self.root), 'self-update', '--version', '0.11.2']), \
                patch.object(u, 'manifest_for', return_value=release()) as manifest, \
                patch.object(u, 'refresh_manager') as refresh, \
                patch.object(u, 'Engine', side_effect=AssertionError('must not use Docker')):
            self.assertEqual(u.main(), 0)
            manifest.assert_called_once_with('0.11.2', for_manager=True)
            refresh.assert_called_once()
        self.assertEqual(u.read_json(self.manager.directory / 'auto-update.json'), policy)


class Compatibility(unittest.TestCase):
    def manifest(self, item, **kwargs):
        with patch.object(u, 'download_json', side_effect=[published(), item]):
            return u.manifest_for('0.11.2', **kwargs)

    def test_minimum_manager_requirement_has_an_actionable_refresh_command(self):
        item = release()
        item['manager']['minimumVersion'] = '1.1.0'
        with self.assertRaisesRegex(u.Error, r'self-update --version 0\.11\.2'):
            self.manifest(item)
        self.assertEqual(self.manifest(item, for_manager=True), item)

    def test_protocol_compatibility_is_derived_from_metadata(self):
        item = release(protocol=2)
        with self.assertRaisesRegex(u.Error, 'protocol is unsupported'):
            self.manifest(item)
        with patch.object(u, 'PROTOCOL', 2):
            self.assertEqual(self.manifest(item), item)
        with patch.object(u, 'MIN_PROTOCOL', 2), patch.object(u, 'PROTOCOL', 2):
            with self.assertRaises(u.Error):
                self.manifest(release(protocol=1))

    def test_manager_metadata_and_asset_are_required_and_validated(self):
        original = release()
        for field, value in [('sha256', 'latest'), ('version', 'bad'), ('minimumVersion', '9.0.0')]:
            item = copy.deepcopy(original)
            item['manager'][field] = value
            with self.subTest(field=field), self.assertRaises(u.Error):
                self.manifest(item, for_manager=True)
        item = copy.deepcopy(original)
        del item['manager']
        with self.assertRaises(u.Error):
            self.manifest(item)
        pub = published()
        pub['assets'] = pub['assets'][:1]
        with patch.object(u, 'download_json', side_effect=[pub, original]):
            with self.assertRaisesRegex(u.Error, 'standalone manager asset'):
                u.manifest_for('0.11.2', for_manager=True)


if __name__ == '__main__':
    unittest.main()

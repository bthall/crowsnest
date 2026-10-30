"""Behavioral regression checks for transactional collector updates; no live daemon required."""
import argparse
import copy
import datetime as dt
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('crowsnest_updater', 'collector/crowsnest')
spec = importlib.util.spec_from_loader(loader.name, loader)
u = importlib.util.module_from_spec(spec)
loader.exec_module(u)


def release(number='0.11.2'):
    return {'schema': 1, 'version': number, 'protocol': 1,
            'manager': {'version': u.MANAGER_VERSION, 'minimumVersion': u.MANAGER_VERSION, 'sha256': 'a' * 64},
            'images': {role: repo + '@sha256:' + ('b' if role == 'collector' else 'c') * 64
                       for role, repo in u.IMAGES.items()}}


def config(root, legacy=False):
    return {'name': 'my-custom-collector', 'services': {
        'collector': {'image': 'python:old', 'command': ['python', '-u', '/app/collector.py'],
                      'user': '1001:1001', 'environment': {'CUSTOM': 'kept'},
                      'healthcheck': {'test': ['CMD', 'python', '-c', "Path('/tmp/crowsnest-last-success')"]},
                      'volumes': [{'type': 'bind', 'source': str(root / 'private.json'),
                                   'target': '/run/config/collector.json', 'read_only': True}]},
        'socket-proxy': {'image': 'haproxy:old', 'volumes': [
            {'type': 'bind', 'source': '/var/run/docker.sock', 'target': '/var/run/docker.sock', 'read_only': True}]},
        'unrelated': {'image': 'example:keep', 'ports': ['127.0.0.1:9000:9000']}}}


class FakeEngine:
    def __init__(self, data):
        self.data = data
        self.calls = []
        self.checks = [True]
        self.command = ['docker']
        self.daemon_id = 'fixture-daemon-id'
        self.fail_pull = False
        self.fail_deploy = False

    def resolve(self):
        return copy.deepcopy(self.data)

    def capture(self, data, source):
        result = copy.deepcopy(data)
        for service in u.SERVICES:
            result['services'][service]['image'] = 'sha256:' + 'a' * 64
        return result, '0.11.1'

    def pull(self, images):
        self.calls.append('pull')
        if self.fail_pull:
            raise u.Error('pull failed')

    def deploy(self, path):
        self.calls.append(('deploy', u.read_json(path)))
        if self.fail_deploy:
            self.fail_deploy = False
            raise u.Error('startup failed')

    def healthy(self, path, timeout):
        self.calls.append('verify')
        return self.checks.pop(0)

    def recreate_collector(self, path):
        self.calls.append(('restart', u.read_json(path)))


class Updates(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.engine = FakeEngine(config(self.root))
        self.manager = u.Manager(self.root, self.engine, timeout=30)
        u.atomic_json(self.manager.directory / 'state.json', {'version': '0.11.1'})
        (self.root / '.env').write_text('custom environment retained\n')
        (self.root / 'private.json').write_text('credentials unchanged\n')

    def test_success_pulls_before_deploy_and_preserves_overrides(self):
        self.manager.update(release())
        self.assertEqual(self.engine.calls[0], 'pull')
        deployed = self.engine.calls[1][1]
        self.assertEqual(deployed['name'], 'my-custom-collector')
        self.assertEqual(deployed['services']['unrelated'], self.engine.data['services']['unrelated'])
        self.assertEqual(deployed['services']['collector']['environment'], {'CUSTOM': 'kept'})
        self.assertEqual(deployed['services']['collector']['volumes'][0]['source'], str(self.root / 'private.json'))
        self.assertEqual(self.manager.status()['installedVersion'], '0.11.2')
        self.assertFalse(self.manager.status()['pendingRecovery'])
        self.assertEqual((self.root / '.env').read_text(), 'custom environment retained\n')
        self.assertEqual((self.root / 'private.json').read_text(), 'credentials unchanged\n')
        self.assertEqual(self.manager.status()['lastUpdate']['lastResult'], 'updated')
        self.assertEqual((self.manager.directory / 'active.json').stat().st_mode & 0o777, 0o600)

    def test_pull_failure_does_not_restart_or_create_pending(self):
        self.engine.fail_pull = True
        with self.assertRaises(u.Error):
            self.manager.update(release())
        self.assertEqual(self.engine.calls, ['pull'])
        self.assertFalse(self.manager.status()['pendingRecovery'])
        self.assertEqual(self.manager.status()['lastUpdate']['rollback'], 'not_needed')

    def test_credential_restart_preserves_active_images_overrides_and_release_state(self):
        self.manager.update(release())
        active = u.read_json(self.manager.source())
        before = self.manager.status()
        self.engine.calls.clear()
        self.engine.checks = [True]
        self.engine.data['services']['collector']['image'] = 'python:obsolete-template'
        with patch.object(self.engine, 'resolve', side_effect=AssertionError('must not read legacy Compose')):
            self.manager.restart()
        self.assertEqual(self.engine.calls, [('restart', active), 'verify'])
        self.assertEqual(self.manager.status(), before)
        self.assertEqual(u.read_json(self.manager.source()), active)

    def test_credential_restart_refuses_unmanaged_or_interrupted_deployments(self):
        with self.assertRaisesRegex(u.Error, 'No managed deployment'):
            self.manager.restart()
        self.assertEqual(self.engine.calls, [])
        u.atomic_json(self.manager.directory / 'pending.json', {'previous': {}})
        with self.assertRaisesRegex(u.Error, 'pending rollback'):
            self.manager.restart()
        self.assertEqual(self.engine.calls, [])

    def test_failed_credential_restart_never_reverts_to_legacy_configuration(self):
        self.manager.update(release())
        active = u.read_json(self.manager.source())
        self.engine.calls.clear()
        self.engine.checks = [False]
        with self.assertRaisesRegex(u.Error, 'current credentials'):
            self.manager.restart()
        self.assertEqual(self.engine.calls, [('restart', active), 'verify'])
        self.assertEqual(u.read_json(self.manager.source()), active)
        self.assertEqual(self.manager.status()['installedVersion'], '0.11.2')

    def test_credential_restart_works_after_first_migration_rolls_back(self):
        self.engine.checks = [False, True]
        with self.assertRaisesRegex(u.Error, 'previous deployment restored'):
            self.manager.update(release(), migrate=True)
        state = u.read_json(self.manager.directory / 'state.json')
        self.assertNotIn('images', state)
        recovered = u.read_json(self.manager.source())
        self.engine.calls.clear()
        self.engine.checks = [True]
        self.manager.restart()
        self.assertEqual(self.engine.calls, [('restart', recovered), 'verify'])
        self.assertEqual(u.read_json(self.manager.directory / 'state.json'), state)

    def test_changed_docker_daemon_prevents_update_and_rollback(self):
        self.manager.update(release())
        self.engine.calls.clear()
        self.engine.daemon_id = 'another-daemon'
        with self.assertRaisesRegex(u.Error, 'Docker daemon differs'):
            self.manager.update(release('0.11.3'))
        with self.assertRaisesRegex(u.Error, 'Docker daemon differs'):
            self.manager.rollback()
        self.assertFalse(self.engine.calls)

    def test_failed_report_rolls_back_exact_previous_config(self):
        self.engine.checks = [False, True]
        with self.assertRaisesRegex(u.Error, 'previous deployment restored'):
            self.manager.update(release())
        self.assertEqual(self.manager.status()['installedVersion'], '0.11.1')
        self.assertEqual(self.manager.status()['lastUpdate']['lastResult'], 'rolled_back')
        rollback = [call[1] for call in self.engine.calls if isinstance(call, tuple)][1]
        self.assertEqual(rollback['services']['collector']['image'], 'sha256:' + 'a' * 64)
        self.assertEqual(rollback['services']['unrelated'], self.engine.data['services']['unrelated'])
        self.assertFalse(self.manager.status()['pendingRecovery'])
        self.assertEqual(u.read_json(self.manager.directory / 'blocked-version.json')['version'], '0.11.2')

    def test_automatic_update_does_not_repeat_disruptive_failed_release(self):
        self.engine.checks = [False, True]
        with self.assertRaises(u.Error):
            self.manager.update(release())
        u.atomic_json(self.manager.directory / 'auto-update.json',
                      {'enabled': True, 'window': '00:00-23:59', 'timezone': 'UTC'})
        self.engine.calls.clear()
        with patch.object(u, 'in_window', return_value=True), patch.object(u, 'latest_version', return_value='0.11.2'), patch.object(u, 'manifest_for', side_effect=AssertionError('must not retry failed release')):
            u.auto_update(self.manager, argparse.Namespace(action='run'))
        self.assertFalse(self.engine.calls)
        self.assertEqual(self.manager.status()['lastUpdate']['lastResult'], 'rolled_back')
        self.assertEqual(u.read_json(self.manager.directory / 'blocked-version.json')['version'], '0.11.2')

    def test_successful_manual_retry_clears_automatic_release_block(self):
        u.atomic_json(self.manager.directory / 'blocked-version.json', {'version': '0.11.2'})
        self.manager.update(release())
        self.assertFalse((self.manager.directory / 'blocked-version.json').exists())

    def test_failed_start_rolls_back(self):
        self.engine.fail_deploy = True
        with self.assertRaisesRegex(u.Error, 'previous deployment restored'):
            self.manager.update(release())
        self.assertEqual(self.manager.status()['lastUpdate']['lastResult'], 'rolled_back')

    def test_failed_rollback_retains_journal_and_reports_failure(self):
        self.engine.checks = [False, False]
        with self.assertRaisesRegex(u.Error, 'Rollback failed'):
            self.manager.update(release())
        self.assertTrue(self.manager.status()['pendingRecovery'])
        self.assertEqual(self.manager.status()['lastUpdate']['lastResult'], 'rollback_failed')
        self.assertEqual(self.manager.status()['lastUpdate']['rollback'], 'failed')
        self.engine.checks = [True]
        self.manager.recover()
        self.assertFalse(self.manager.status()['pendingRecovery'])
        self.assertEqual(self.manager.status()['installedVersion'], '0.11.1')

    def test_interrupted_transaction_is_recovered_before_next_update(self):
        previous = {'config': self.engine.data, 'state': {'version': '0.11.1'}}
        u.atomic_json(self.manager.directory / 'pending.json', {'previous': previous, 'targetVersion': '0.11.2'})
        self.engine.checks = [True, True]
        self.manager.update(release())
        self.assertEqual(self.engine.calls[0][0], 'deploy')
        self.assertEqual(self.manager.status()['installedVersion'], '0.11.2')

    def test_explicit_rollback_restores_previous_and_can_toggle(self):
        self.engine.checks = [True, True]
        self.manager.update(release())
        self.manager.rollback()
        self.assertEqual(self.manager.status()['installedVersion'], '0.11.1')
        self.assertEqual(self.manager.status()['lastUpdate']['fromVersion'], '0.11.2')
        self.assertEqual(self.manager.status()['lastUpdate']['toVersion'], '0.11.1')
        self.assertEqual(u.read_json(self.manager.directory / 'previous.json')['state']['version'], '0.11.2')

    def test_legacy_update_requires_explicit_migration(self):
        self.engine.data['services']['collector']['volumes'].append(
            {'type': 'bind', 'source': str(self.root / 'collector.py'), 'target': '/app/collector.py'})
        with self.assertRaisesRegex(u.Error, 'migrate once'):
            self.manager.update(release())
        self.assertFalse(self.engine.calls)
        self.manager.update(release(), migrate=True)
        mounts = u.read_json(self.manager.source())['services']['collector']['volumes']
        self.assertFalse(any(m['target'] == '/app/collector.py' for m in mounts))

    def test_custom_code_mount_is_rejected_even_during_migration(self):
        self.engine.data['services']['collector']['volumes'].append(
            {'type': 'bind', 'source': '/elsewhere/custom.py', 'target': '/app/collector.py'})
        with self.assertRaisesRegex(u.Error, 'Custom collector source'):
            self.manager.update(release(), migrate=True)
        self.assertFalse(self.engine.calls)

    def test_auto_window_rechecked_after_pull(self):
        policy = {'window': '02:00-04:00', 'timezone': 'UTC'}
        u.atomic_json(self.manager.directory / 'active.json', self.engine.data)
        with patch.object(u, 'in_window', return_value=False):
            self.manager.update(release(), window_policy=policy)
        self.assertEqual(self.engine.calls, ['pull'])
        self.assertFalse(self.manager.status()['pendingRecovery'])

    def test_automatic_update_uses_saved_snapshot_without_invocation_environment(self):
        saved = copy.deepcopy(self.engine.data)
        saved['services']['collector']['environment'] = {'OVERRIDE_ONLY_IN_INITIAL_SHELL': 'retained'}
        u.atomic_json(self.manager.directory / 'active.json', saved)
        policy = {'window': '02:00-04:00', 'timezone': 'UTC'}
        with patch.object(u, 'in_window', return_value=True), patch.object(self.engine, 'resolve', side_effect=AssertionError('must not resolve original files')):
            self.manager.update(release(), window_policy=policy)
        self.assertEqual(u.read_json(self.manager.source())['services']['collector']['environment'],
                         {'OVERRIDE_ONLY_IN_INITIAL_SHELL': 'retained'})

    def test_migrate_then_update_preserves_original_source_files(self):
        self.engine.data['services']['collector']['volumes'].append(
            {'type': 'bind', 'source': str(self.root / 'collector.py'), 'target': '/app/collector.py'})
        self.engine.checks = [True, True]
        self.manager.update(release(), migrate=True)
        self.manager.update(release('0.11.3'))
        self.assertEqual(self.manager.status()['installedVersion'], '0.11.3')
        self.assertTrue(u.legacy_mount(self.engine.data))

    def test_original_source_install_gains_healthcheck_and_tmpfs(self):
        del self.engine.data['services']['collector']['healthcheck']
        self.manager.update(release(), migrate=True)
        deployed = u.read_json(self.manager.source())['services']['collector']
        self.assertIn('crowsnest-last-success', json.dumps(deployed['healthcheck']))
        self.assertTrue(any(item.startswith('/tmp:') for item in deployed['tmpfs']))

    def test_disabled_auto_recovers_pending_transaction(self):
        previous = {'config': self.engine.data, 'state': {'version': '0.11.1'}}
        u.atomic_json(self.manager.directory / 'pending.json', {'previous': previous, 'targetVersion': '0.11.2'})
        u.auto_update(self.manager, argparse.Namespace(action='run'))
        self.assertEqual(self.engine.calls[0][0], 'deploy')
        self.assertFalse(self.manager.status()['pendingRecovery'])

    def test_lock_prevents_concurrent_update(self):
        other = u.Manager(self.root, self.engine)
        self.manager.acquire()
        try:
            with self.assertRaisesRegex(u.Error, 'already running'):
                other.acquire()
        finally:
            self.manager.lock.close()
            if other.lock:
                other.lock.close()

    def test_state_symlinks_are_rejected(self):
        target = self.root / 'external'
        target.write_text('{}')
        state = self.manager.directory / 'state.json'
        state.unlink()
        state.symlink_to(target)
        with self.assertRaises(u.Error):
            self.manager.status()

    def test_public_status_contains_only_safe_allowlist(self):
        self.manager.publish('failed', '0.11.1', '0.11.2', 'not_needed')
        data = self.manager.status()['lastUpdate']
        self.assertEqual(set(data), {'autoUpdates', 'lastAttempt', 'lastResult', 'fromVersion', 'toVersion', 'rollback'})
        self.assertNotIn(str(self.root), json.dumps(data))
        self.assertEqual(self.manager.public.stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.manager.public / 'update-status.json').stat().st_mode & 0o777, 0o644)

    def test_disable_does_not_need_docker_or_a_working_user_bus(self):
        argv = ['crowsnest', '--directory', str(self.root), 'auto-update', 'disable']
        with patch.object(u.sys, 'argv', argv), patch.object(u, 'Engine', side_effect=AssertionError('Docker must not be queried')), patch.object(u, 'run', side_effect=u.Error('bus unavailable')):
            self.assertEqual(u.main(), 0)
        self.assertFalse(u.read_json(self.manager.directory / 'auto-update.json')['enabled'])
        self.assertFalse(self.manager.status()['lastUpdate']['autoUpdates'])

    def test_timer_enable_failure_leaves_auto_policy_disabled(self):
        args = argparse.Namespace(action='enable', window='02:00-04:00', timezone='America/New_York')
        calls = []

        def fake_run(command, **kwargs):
            calls.append(command)
            if command[0] == 'loginctl':
                return 'yes\n'
            if command[:3] == ['systemctl', '--user', 'enable']:
                raise u.Error('timer enable failed')
            return ''

        with patch.dict(os.environ, {'XDG_CONFIG_HOME': str(self.root / 'user-config')}), patch.object(u, 'run', side_effect=fake_run):
            with self.assertRaisesRegex(u.Error, 'timer enable failed'):
                u.auto_update(self.manager, args)
        self.assertFalse(u.read_json(self.manager.directory / 'auto-update.json')['enabled'])
        self.assertFalse(self.manager.status()['lastUpdate']['autoUpdates'])
        self.assertTrue(any(command[:3] == ['systemctl', '--user', 'daemon-reload'] for command in calls))

    def test_user_timer_rejects_sudo_and_missing_linger(self):
        args = argparse.Namespace(action='enable', window='02:00-04:00', timezone='UTC')
        self.engine.command = ['sudo', '-n', 'docker']
        with self.assertRaisesRegex(u.Error, 'direct Docker access'):
            u.auto_update(self.manager, args)
        self.engine.command = ['docker']
        with patch.object(u, 'run', side_effect=['', 'no\n']):
            with self.assertRaisesRegex(u.Error, 'lingering'):
                u.auto_update(self.manager, args)


class Metadata(unittest.TestCase):
    def test_systemd_path_escaping_preserves_dollars_percent_spaces_and_quotes(self):
        self.assertEqual(u.unit_quote('/srv/collector $name %x "quoted"'),
                         '"/srv/collector $$name %%x \\"quoted\\""')
        self.assertRaises(u.Error, u.unit_quote, '/srv/bad\npath')

    def test_manifest_requires_both_trusted_digest_images(self):
        item = release()
        release_data = {'tag_name': 'collector-v0.11.2', 'draft': False, 'prerelease': False,
                        'assets': [{'name': 'collector-release.json', 'browser_download_url':
                                    'https://github.com/bthall/crowsnest/releases/download/collector-v0.11.2/collector-release.json'}]}
        with patch.object(u, 'download_json', side_effect=[release_data, item]):
            self.assertEqual(u.manifest_for('0.11.2'), item)
        for key, value in [('protocol', 2), ('version', '0.11.3')]:
            invalid = {**item, key: value}
            with patch.object(u, 'download_json', side_effect=[release_data, invalid]):
                with self.assertRaises(u.Error):
                    u.manifest_for('0.11.2')
        for reference in ['ghcr.io/attacker/collector@sha256:' + 'a' * 64, u.IMAGES['collector'] + ':latest']:
            invalid = copy.deepcopy(item)
            invalid['images']['collector'] = reference
            with patch.object(u, 'download_json', side_effect=[release_data, invalid]):
                with self.assertRaises(u.Error):
                    u.manifest_for('0.11.2')

    def test_paginated_patch_only_selection_ignores_dashboard_and_prereleases(self):
        first = [{'tag_name': 'v99.0.0'}] * 99 + [{'tag_name': 'collector-v0.12.0'}]
        second = [{'tag_name': 'collector-v0.11.9'}, {'tag_name': 'collector-v0.11.10'},
                  {'tag_name': 'collector-v0.11.99', 'prerelease': True}]
        with patch.object(u, 'download_json', side_effect=[first, second]):
            self.assertEqual(u.latest_version('0.11.1', patch_only=True), '0.11.10')

    def test_window_supports_overnight_and_named_timezone(self):
        policy = {'window': '23:30-01:30', 'timezone': 'America/New_York'}
        self.assertTrue(u.in_window(policy, dt.datetime(2026, 10, 29, 4, 0, tzinfo=dt.timezone.utc)))
        self.assertFalse(u.in_window(policy, dt.datetime(2026, 10, 29, 6, 0, tzinfo=dt.timezone.utc)))
        self.assertRaises(u.Error, u.valid_window, '04:00-04:00')
        self.assertRaises(u.Error, u.valid_window, '25:00-26:00')


if __name__ == '__main__':
    unittest.main()

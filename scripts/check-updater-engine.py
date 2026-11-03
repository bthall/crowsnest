"""Exercise the production Docker adapter through synthetic CLI responses only."""
import copy
import datetime as dt
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('crowsnest_engine_checks', 'collector/crowsnest')
spec = importlib.util.spec_from_loader(loader.name, loader)
u = importlib.util.module_from_spec(spec)
loader.exec_module(u)


def deployment(root):
    return {'name': 'custom-collector', 'services': {
        'socket-proxy': {'image': 'haproxy:fixture', 'volumes': []},
        'collector': {'image': 'python:fixture', 'environment': {
            'ONE': '$literal', 'TWO': '$$literal', 'THREE': '${HOME}'},
            'volumes': [{'type': 'bind', 'source': str(root / 'private $files' / 'collector.json'),
                         'target': '/run/config/collector.json', 'read_only': True}]}}}


class Adapter(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='crowsnest-engine-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'owner $files'
        self.root.mkdir()
        self.snapshot = self.root / 'candidate.json'
        self.config = deployment(self.root)
        u.atomic_json(self.snapshot, self.config)
        self.engine = object.__new__(u.Engine)
        self.engine.root = self.root
        self.engine.command = ['docker']
        self.engine.daemon_id = 'fixture-daemon'

    def test_daemon_identity_and_compose_capability_are_checked(self):
        with patch.object(u, 'run', side_effect=['fixture-daemon\n', 'Docker Compose version v2.24.7']) as command:
            engine = u.Engine(self.root)
        self.assertEqual(engine.daemon_id, 'fixture-daemon')
        self.assertEqual(command.call_args_list[0].args[0], ['docker', 'info', '--format', '{{.ID}}'])
        self.assertEqual(command.call_args_list[1].args[0], ['docker', 'compose', 'version'])
        self.assertEqual(command.call_args_list[0].kwargs['cwd'], self.root)

    def test_daemon_access_uses_only_noninteractive_sudo_fallback(self):
        with patch.object(u, 'run', side_effect=[u.Error('access denied'), 'fixture-daemon\n', 'v2']) as command:
            engine = u.Engine(self.root)
        self.assertEqual(engine.command, ['sudo', '-n', 'docker'])
        self.assertEqual(command.call_args_list[1].args[0], ['sudo', '-n', 'docker', 'info', '--format', '{{.ID}}'])
        self.assertEqual(command.call_args_list[2].args[0], ['sudo', '-n', 'docker', 'compose', 'version'])

    def test_missing_daemon_identity_stops_before_deployment(self):
        with patch.object(u, 'run', return_value='') as command:
            with self.assertRaisesRegex(u.Error, 'stable identity'):
                u.Engine(self.root)
        self.assertEqual(command.call_count, 1)

    def test_resolve_uses_normal_compose_discovery_and_normalizes_escaped_dollars(self):
        # Compose config --format json quotes dollar bytes for reusable output.
        encoded = json.dumps(self.config).replace('$', '$$')
        with patch.object(u, 'run', return_value=encoded) as command:
            result = self.engine.resolve()
        self.assertEqual(result, self.config)
        command.assert_called_once_with(['docker', 'compose', '--project-directory', str(self.root),
                                         'config', '--format', 'json'], cwd=self.root)

    def test_resolve_rejects_missing_managed_services_or_project_identity(self):
        for invalid in [{'services': {}}, {'name': 'unsafe/name', 'services': self.config['services']},
                        {'name': 'custom-collector', 'services': {'collector': {}}}]:
            with self.subTest(invalid=invalid), patch.object(u, 'run', return_value=json.dumps(invalid)):
                with self.assertRaises(u.Error):
                    self.engine.resolve()

    def test_capture_uses_running_image_ids_and_does_not_mutate_input(self):
        responses = ['proxy-id\n', json.dumps([{'Image': 'sha256:' + 'a' * 64, 'State': {'Running': True}}]),
                     'collector-id\n', json.dumps([{'Image': 'sha256:' + 'b' * 64, 'State': {'Running': True},
                                                   'Config': {'Labels': {'org.opencontainers.image.version': '0.11.1'}}}])]
        with patch.object(u, 'run', side_effect=responses) as command:
            result, installed = self.engine.capture(self.config, self.snapshot)
        self.assertEqual(installed, '0.11.1')
        self.assertEqual(result['services']['socket-proxy']['image'], 'sha256:' + 'a' * 64)
        self.assertEqual(result['services']['collector']['image'], 'sha256:' + 'b' * 64)
        self.assertEqual(self.config['services']['collector']['image'], 'python:fixture')
        self.assertEqual(command.call_args_list[0].args[0][-3:], ['ps', '-q', 'socket-proxy'])
        self.assertEqual(command.call_args_list[1].args[0], ['docker', 'container', 'inspect', 'proxy-id'])
        self.assertEqual(command.call_args_list[2].args[0][-3:], ['ps', '-q', 'collector'])
        self.assertEqual(command.call_args_list[3].args[0], ['docker', 'container', 'inspect', 'collector-id'])

    def test_capture_rejects_ambiguous_or_stopped_containers(self):
        for ids in ['', 'first\nsecond\n']:
            with self.subTest(ids=ids), patch.object(u, 'run', return_value=ids):
                with self.assertRaisesRegex(u.Error, 'Exactly one running'):
                    self.engine.capture(self.config, self.snapshot)
        with patch.object(u, 'run', side_effect=['proxy-id\n', json.dumps([
                {'Image': 'sha256:' + 'a' * 64, 'State': {'Running': False}}])]):
            with self.assertRaisesRegex(u.Error, 'not running'):
                self.engine.capture(self.config, self.snapshot)

    def test_deploy_requotes_execution_snapshot_and_only_recreates_managed_services(self):
        original = self.snapshot.read_bytes()
        with patch.object(u, 'run', return_value='') as command:
            self.engine.deploy(self.snapshot)
        execution = self.snapshot.parent / 'execution-compose.json'
        expected = json.loads(json.dumps(self.config).replace('$', '$$'))
        self.assertEqual(u.read_json(execution), expected)
        self.assertEqual(self.snapshot.read_bytes(), original)
        self.assertEqual(execution.stat().st_mode & 0o777, 0o600)
        command.assert_called_once_with(['docker', 'compose', '--project-directory', str(self.root),
            '-p', 'custom-collector', '-f', str(execution), 'up', '-d', '--no-build', '--pull', 'never',
            '--force-recreate', '--no-deps', 'socket-proxy', 'collector'], cwd=self.root, timeout=180)

    def test_credential_restart_uses_saved_configuration_without_pulls_or_proxy_recreation(self):
        original = self.snapshot.read_bytes()
        with patch.object(u, 'run', return_value='') as command:
            self.engine.recreate_collector(self.snapshot)
        execution = self.snapshot.parent / 'execution-compose.json'
        self.assertEqual(self.snapshot.read_bytes(), original)
        self.assertEqual(u.read_json(execution), json.loads(json.dumps(self.config).replace('$', '$$')))
        command.assert_called_once_with(['docker', 'compose', '--project-directory', str(self.root),
            '-p', 'custom-collector', '-f', str(execution), 'up', '-d', '--no-build', '--pull', 'never',
            '--force-recreate', '--no-deps', 'collector'], cwd=self.root, timeout=180)

    def test_pull_finishes_before_any_deployment_command_and_uses_digest_references(self):
        images = {'collector': u.IMAGES['collector'] + '@sha256:' + 'a' * 64,
                  'proxy': u.IMAGES['proxy'] + '@sha256:' + 'b' * 64}
        with patch.object(u, 'run', return_value='') as command:
            self.engine.pull(images)
        self.assertEqual([call.args[0] for call in command.call_args_list],
                         [['docker', 'pull', reference] for reference in images.values()])
        self.assertTrue(all(call.kwargs['timeout'] == 600 for call in command.call_args_list))

    def health_scenario(self, marker='fresh', legacy=False, logs='', proxy_ok=True, health='healthy'):
        start = '2026-10-29T20:00:00Z'
        started = dt.datetime.fromisoformat(start.replace('Z', '+00:00')).timestamp()
        clock = [0.0]
        wall_clock = started + 10
        states = [{'State': {'Running': True, 'StartedAt': start}},
                  {'State': {'Running': True, 'StartedAt': start}}]
        if health is not None:
            for state in states:
                state['State']['Health'] = {'Status': health}
        data = copy.deepcopy(self.config)
        if legacy:
            data['services']['collector']['volumes'].append(
                {'type': 'bind', 'source': str(self.root / 'collector.py'), 'target': '/app/collector.py'})
        u.atomic_json(self.snapshot, data)
        commands = []

        def transport(args, **kwargs):
            commands.append(args)
            if args[-3:] == ['ps', '-q', 'socket-proxy']:
                return 'proxy-id\n'
            if args[-3:] == ['ps', '-q', 'collector']:
                return 'collector-id\n'
            if args == ['docker', 'container', 'inspect', 'proxy-id', 'collector-id']:
                return json.dumps(states)
            if args[:4] == ['docker', 'exec', 'proxy-id', 'wget']:
                self.assertEqual(args[-1], 'http://127.0.0.1:2375/version')
                if not proxy_ok:
                    raise u.Error('restricted proxy rejected its version request')
                return ''
            if args[:5] == ['docker', 'exec', 'collector-id', 'python', '-c']:
                self.assertEqual(float(args[6]), started)
                # Run the exact generated remote probe with synthetic filesystem/time
                # modules so stale-marker rejection is checked without a real daemon.
                mtime = {'fresh': wall_clock - 1, 'stale': wall_clock - 181,
                         'before_start': started - 1}.get(marker, wall_clock)
                marker_file = SimpleNamespace(exists=lambda: marker != 'missing',
                                              stat=lambda: SimpleNamespace(st_mtime=mtime))
                modules = {'pathlib': SimpleNamespace(Path=lambda path: marker_file),
                           'time': SimpleNamespace(time=lambda: wall_clock)}
                with patch.dict(sys.modules, modules), patch.object(sys, 'argv', ['-c', args[6]]):
                    try:
                        exec(args[5], {})
                    except SystemExit as outcome:
                        if outcome.code:
                            raise u.Error('marker probe failed') from outcome
                return ''
            if args[:3] == ['docker', 'logs', '--since']:
                self.assertEqual(args, ['docker', 'logs', '--since', start, '--tail', '20', 'collector-id'])
                return logs
            self.fail('Unexpected Docker command: ' + repr(args))

        def sleep(seconds):
            clock[0] += seconds

        with patch.object(u, 'run', side_effect=transport), patch.object(u.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(u.time, 'sleep', side_effect=sleep):
            result = self.engine.healthy(self.snapshot, 5)
        return result, commands

    def test_fresh_post_start_marker_and_proxy_read_confirm_reporting(self):
        result, commands = self.health_scenario()
        self.assertTrue(result)
        self.assertTrue(any(command[:4] == ['docker', 'exec', 'proxy-id', 'wget'] for command in commands))
        self.assertFalse(any(command[1] == 'logs' for command in commands))

    def test_stale_missing_or_pre_start_marker_never_verify_packaged_deployment(self):
        for marker in ['stale', 'missing', 'before_start']:
            with self.subTest(marker=marker):
                result, commands = self.health_scenario(marker=marker)
                self.assertFalse(result)
                self.assertFalse(any(command[1] == 'logs' for command in commands))

    def test_legacy_without_healthcheck_requires_exact_post_recreation_delivery_log(self):
        result, _ = self.health_scenario(marker='missing', legacy=True,
                                         logs='Status delivered: 12 containers\n', health=None)
        self.assertTrue(result)
        for logs in ['', 'Reporting failed: HTTP 403; will retry\n',
                     'prefix Status delivered: 12 containers\n', 'Status delivered: x containers\n']:
            with self.subTest(logs=logs):
                result, _ = self.health_scenario(marker='missing', legacy=True, logs=logs, health=None)
                self.assertFalse(result)

    def test_proxy_failure_or_docker_unhealthy_blocks_success_even_with_delivery_marker(self):
        result, commands = self.health_scenario(proxy_ok=False)
        self.assertFalse(result)
        self.assertFalse(any(command[:5] == ['docker', 'exec', 'collector-id', 'python', '-c'] for command in commands))
        result, commands = self.health_scenario(health='unhealthy')
        self.assertFalse(result)
        self.assertFalse(any(command[1] == 'exec' for command in commands))


if __name__ == '__main__':
    unittest.main()

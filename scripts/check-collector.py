"""Exercise actual collector code with synthetic Docker and reporting endpoints."""
import contextlib
import importlib.util
import io
import json
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('collector', Path('worker/collector.py'))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
collector_release = json.loads(Path('collector/version.json').read_text())
collector.COLLECTOR_VERSION = collector_release['version']
collector.COLLECTOR_PROTOCOL = collector_release['protocol']
CONFIG = {'url': 'https://board.example.com', 'hostId': '00000000-0000-4000-8000-000000000000',
          'hostToken': 'test-host-token', 'serviceToken': 'test-service-token'}
INSPECT = {
    'Id': 'a' * 64, 'Name': '/web',
    'Config': {'Image': 'nginx', 'Env': ['SECRET=must-not-collect'], 'Labels': {
        'com.docker.compose.project': 'media', 'com.docker.compose.service': 'web',
        'private.label': 'must-not-collect'}},
    'State': {'Status': 'running', 'Health': {'Status': 'healthy'}},
}


class Response(io.BytesIO):
    status = 200


class Sink:
    def __init__(self, body=b'{"ok":true}'):
        self.requests = []
        self.body = body

    def open(self, request, timeout):
        assert timeout == 20
        self.requests.append(request)
        return Response(self.body)


class CollectorChecks(unittest.TestCase):
    def setUp(self):
        self.heartbeat = self.enterContext(patch.object(collector.Path, "touch"))
        self.inspect = json.loads(json.dumps(INSPECT))
        collector.CPU_SAMPLES.clear()
        self.stats = {'id': 'a' * 64, 'cpu_stats': {'cpu_usage': {'total_usage': 100}, 'system_cpu_usage': 1000, 'online_cpus': 4},
                      'memory_stats': {'usage': 1000, 'limit': 2000, 'stats': {'inactive_file': 200}},
                      'networks': {'private': 'must-not-collect'}, 'name': 'must-not-collect'}

    def test_health_requires_accepted_delivery(self):
        self.report(Sink())
        self.heartbeat.assert_called_once()
        self.heartbeat.reset_mock()
        for reply in [b'{"ok":false}', b'{}', b'[]', b'invalid']:
            with self.assertRaises(ValueError):
                self.report(Sink(reply))
        self.heartbeat.assert_not_called()

    def test_public_updater_metadata_is_bounded_optional_and_allowlisted(self):
        value = {'autoUpdates': False, 'lastAttempt': '2026-10-29T20:00:00Z',
                 'lastResult': 'rolled_back', 'fromVersion': '0.11.1', 'toVersion': '0.11.2',
                 'rollback': 'succeeded', 'privatePath': '/secret', 'token': 'must-not-collect'}
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'update-status.json'
            with patch.object(collector, 'UPDATE_STATUS_PATH', path):
                self.assertIsNone(collector.update_status())
                path.write_text(json.dumps(value))
                public = collector.update_status()
                self.assertEqual(set(public), {'autoUpdates', 'lastAttempt', 'lastResult', 'fromVersion', 'toVersion', 'rollback'})
                sink = Sink()
                self.report(sink)
                report = json.loads(sink.requests[0].data)
                self.assertEqual(report['updateStatus'], public)
                self.assertEqual(report['collectorProtocol'], collector.COLLECTOR_PROTOCOL)
                self.assertNotIn('must-not-collect', json.dumps(report))
                for invalid in ['x' * 4097, '{}', '[]', 'not json',
                                json.dumps({**value, 'autoUpdates': 1}),
                                json.dumps({**value, 'lastAttempt': '2026-99-29T20:00:00Z'}),
                                json.dumps({**value, 'lastResult': 'shell error with credentials'}),
                                json.dumps({**value, 'toVersion': '1.0.0-01'})]:
                    path.write_text(invalid)
                    self.assertIsNone(collector.update_status())
                    self.report(Sink())

    def test_read_only_marker_preserves_delivery_confirmation(self):
        self.heartbeat.side_effect = OSError('Read-only filesystem')
        output = io.StringIO()
        with patch.object(collector, 'get', self.fake_get), contextlib.redirect_stdout(output):
            collector.report(CONFIG, Sink())
        self.heartbeat.assert_called_once()
        self.assertIn('Status delivered: 1 containers', output.getvalue())

    def fake_get(self, path, deadline):
        assert deadline > time.monotonic()
        if path == '/version':
            return {'ApiVersion': '1.50', 'Version': '29'}
        if path.endswith('/containers/json?all=1'):
            return [{'Id': self.inspect['Id']}]
        if path.endswith('/stats?stream=false&one-shot=true'):
            return self.stats
        assert path == '/v1.50/containers/' + self.inspect['Id'] + '/json'
        return self.inspect

    def report(self, sink):
        with patch.object(collector, 'get', self.fake_get), contextlib.redirect_stdout(io.StringIO()):
            collector.report(CONFIG, sink)

    def test_allowlist_and_standalone(self):
        sink = Sink()
        self.report(sink)
        self.inspect['Config']['Labels'] = None
        self.inspect['State']['Health'] = None
        self.report(sink)
        captured = [json.loads(r.data) for r in sink.requests]
        self.assertEqual(captured[0]['collectorVersion'], collector.COLLECTOR_VERSION)
        self.assertEqual(captured[0]['containers'][0]['composeProject'], 'media')
        self.assertEqual(captured[0]['containers'][0]['composeService'], 'web')
        self.assertNotIn('must-not-collect', json.dumps(captured))
        self.assertEqual(captured[1]['containers'][0]['composeProject'], '')
        self.assertEqual(captured[1]['containers'][0]['health'], 'none')
        for request in sink.requests:
            self.assertEqual(request.full_url, CONFIG['url'] + '/api/ingest/' + CONFIG['hostId'])
            self.assertEqual(request.get_header('Authorization'), 'Bearer test-host-token')
            self.assertEqual(request.get_header('Oai-sites-authorization'), 'Bearer test-service-token')

    def test_configuration_rejects_unsafe_destinations(self):
        for url in [None, 7, 'http://board.example.com', 'https://user:password@board.example.com',
                    'https://board.example.com/path', 'https://board.example.com?token=x',
                    'https://board.example.com/#fragment', 'https://board.example.com:8443']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                collector.check_config({**CONFIG, 'url': url})
        for key, value in [('hostId', '../wrong'), ('hostToken', ''), ('serviceToken', 'token\nheader')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                collector.check_config({**CONFIG, key: value})
        self.assertEqual(collector.check_config({**CONFIG, 'url': CONFIG['url'] + '/'}), collector.check_config(CONFIG))

    def test_standalone_configuration_uses_host_credentials_only(self):
        config = {key: value for key, value in CONFIG.items() if key != 'serviceToken'}
        config['url'] = 'https://board.example.com:8443'
        self.assertEqual(collector.check_config(config), config['url'] + '/api/ingest/' + config['hostId'])
        for url in ['http://board.example.com', 'https://board.example.com:99999', 'https://user:pass@board.example.com']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                collector.check_config({**config, 'url': url})

    def test_disappearing_container_does_not_stop_report(self):
        def get(path, deadline):
            if path.endswith('/containers/json?all=1'):
                return [{'Id': 'a' * 64}, {'Id': 'b' * 64}]
            if '/containers/' + 'b' * 64 in path:
                raise urllib.error.HTTPError(path, 404, 'removed', {}, None)
            return self.fake_get(path, deadline)
        with patch.object(collector, 'get', get):
            self.assertEqual([c['id'] for c in collector.collect()['containers']], ['a' * 64])
        for status in [403, 500]:
            def denied(path, deadline):
                if '/containers/' + 'a' * 64 in path:
                    raise urllib.error.HTTPError(path, status, 'failure', {}, None)
                return self.fake_get(path, deadline)
            with patch.object(collector, 'get', denied), self.assertRaises(urllib.error.HTTPError):
                collector.collect()

    def test_bounded_parallel_inspection_preserves_order(self):
        ids = [format(n, '064x') for n in range(12)]
        lock, ready = threading.Lock(), threading.Event()
        active = peak = 0

        def get(path, deadline):
            nonlocal active, peak
            if path == '/version':
                return {'ApiVersion': '1.50', 'Version': '29'}
            if path.endswith('/containers/json?all=1'):
                return [{'Id': id} for id in ids]
            with lock:
                active += 1
                peak = max(peak, active)
                if active == 4:
                    ready.set()
            assert ready.wait(5), 'Inspections did not run concurrently'
            result = {**self.inspect, 'Id': path.split('/')[-2]}
            with lock:
                active -= 1
            return result

        with patch.object(collector, 'get', get):
            self.assertEqual([c['id'] for c in collector.collect()['containers']], ids)
        self.assertEqual(peak, 4)

    def test_bounds_and_acknowledgement(self):
        for body in [b'{}', b'{"ok":false}', b'null', b'<html>login</html>', b'x' * 8193]:
            with self.subTest(body_length=len(body)), self.assertRaises(ValueError):
                self.report(Sink(body))
        with self.assertRaises(ValueError):
            collector.read_json(io.BytesIO(b'x' * 17), 16)
        sink = Sink()
        self.inspect['Config']['Image'] = 'x' * collector.MAX_REPORT_BYTES
        with self.assertRaises(ValueError):
            self.report(sink)
        self.assertEqual(sink.requests, [])
        with self.assertRaises(TimeoutError):
            collector.get('/version', time.monotonic() - 1)

    def test_invalid_container_list_and_api(self):
        for data in [[{'Id': 'x' * 64}], [{'Id': 'a' * 64}] * 2, [None], {}, [{'Id': 'a' * 64}] * 251]:
            def get(path, deadline):
                return data if path.endswith('/containers/json?all=1') else self.fake_get(path, deadline)
            with patch.object(collector, 'get', get), self.assertRaises(ValueError):
                collector.collect()
        with patch.object(collector, 'get', return_value={'ApiVersion': '../x'}), self.assertRaises(ValueError):
            collector.collect()

    def test_redirects_never_reach_destination(self):
        received = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers.get('Content-Length', 0)))
                self.send_response(int(self.path[1:]))
                self.send_header('Location', destination)
                self.end_headers()

            def do_GET(self):
                received.append(dict(self.headers))
                self.send_response(200)
                self.end_headers()

            def log_message(self, *_):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        destination = 'http://127.0.0.1:' + str(server.server_port) + '/sink'
        opener = urllib.request.build_opener(collector.NoRedirect(), urllib.request.ProxyHandler({}))
        try:
            for code in [301, 302, 303, 307, 308]:
                endpoint = destination.replace('/sink', '/' + str(code))
                with patch.object(collector, 'check_config', return_value=endpoint), patch.object(collector, 'collect', return_value={
                        'engineVersion': '29', 'containers': []}), self.assertRaises(urllib.error.HTTPError) as result:
                    collector.report(CONFIG, opener)
                result.exception.close()
                self.assertEqual(result.exception.code, code)
            self.assertEqual(received, [])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_cadence_accounts_for_work(self):
        for elapsed, delay in [(7, 23), (40, 1)]:
            with patch.object(collector.Path, 'read_text', return_value=json.dumps(CONFIG)), patch.object(
                    collector, 'report'), patch.object(collector.time, 'monotonic', side_effect=[0, elapsed]), patch.object(
                    collector.time, 'sleep', side_effect=StopIteration) as sleep, self.assertRaises(StopIteration):
                collector.main()
            sleep.assert_called_once_with(delay)

    def test_resource_warmup_cgroup_cache_and_cpu(self):
        c = {'id': 'a' * 64, 'startedAt': 'first'}
        first = collector.resource_values(self.stats, c, 10)
        self.assertEqual(first['memoryBytes'], 800)
        self.assertIsNone(first['cpuPercent'])
        self.stats['cpu_stats']['cpu_usage']['total_usage'] = 200
        self.stats['cpu_stats']['system_cpu_usage'] = 2000
        second = collector.resource_values(self.stats, c, 40)
        self.assertEqual(second['cpuPercent'], 40)
        self.assertEqual(second['sampleSeconds'], 30)
        self.stats['memory_stats']['stats'] = {'total_inactive_file': 300, 'inactive_file': 100}
        self.assertEqual(collector.resource_values(self.stats, c, 70)['memoryBytes'], 700)
        for changed in [{'startedAt': 'replacement'}, {'startedAt': 'first'}]:
            self.assertIsNone(collector.resource_values(self.stats, {**c, **changed}, 80)['cpuPercent'])
        self.stats['cpu_stats']['cpu_usage']['total_usage'] = 0
        self.assertIsNone(collector.resource_values(self.stats, c, 100)['cpuPercent'])
        self.stats['memory_stats']['usage'] = True
        self.assertIsNone(collector.resource_values(self.stats, c, 101)['memoryBytes'])
        with self.assertRaises(ValueError):
            collector.resource_values({**self.stats, 'id': 'b' * 64}, c, 102)

    def test_optional_metrics_failure_and_privacy(self):
        with patch.object(collector, 'get', self.fake_get):
            result = collector.collect()
        self.assertEqual(result['resourceSampling'], 'warming')
        self.assertNotIn('must-not-collect', json.dumps(result))
        self.assertEqual(set(result['containers'][0]['resources']), {'cpuPercent', 'memoryBytes', 'memoryLimitBytes', 'sampleSeconds'})
        for error in [TimeoutError(), ValueError(), urllib.error.HTTPError('stats', 403, 'old proxy', {}, None)]:
            def get(path, deadline):
                if '/stats?' in path:
                    raise error
                return self.fake_get(path, deadline)
            with patch.object(collector, 'get', get):
                result = collector.collect()
            self.assertEqual(len(result['containers']), 1)
            self.assertEqual(result['resourceSampling'], 'unavailable')
        c = {'id': 'a' * 64, 'state': 'running', 'startedAt': ''}
        with patch.object(collector, 'get') as get:
            self.assertEqual(collector.collect_resources('/v1.40', '1.40', [c], time.monotonic() + 1), 'unsupported')
            self.assertEqual(collector.collect_resources('/v1.50', '1.50', [c], time.monotonic() - 1), 'unavailable')
            get.assert_not_called()

    def test_one_shot_stats_without_id(self):
        # Docker Engine 26's one-shot branch returns counters without name/ID.
        self.stats.pop('id')
        sink = Sink()
        self.report(sink)
        self.stats['cpu_stats']['cpu_usage']['total_usage'] += 100
        self.stats['cpu_stats']['system_cpu_usage'] += 1000
        self.report(sink)
        first, second = [json.loads(r.data) for r in sink.requests]
        self.assertEqual(first['resourceSampling'], 'warming')
        self.assertEqual(second['resourceSampling'], 'complete')
        self.assertEqual(second['containers'][0]['resources']['cpuPercent'], 40)
        self.assertEqual(second['containers'][0]['resources']['memoryBytes'], 800)
        self.assertNotIn('must-not-collect', json.dumps(second))
        c = {'id': 'a' * 64, 'startedAt': ''}
        for supplied_id in [None, True, '', 'b' * 64]:
            with self.subTest(id=supplied_id), self.assertRaises(ValueError):
                collector.resource_values({**self.stats, 'id': supplied_id}, c, 100)
        self.assertEqual(collector.resource_values({**self.stats, 'id': c['id']}, c, 100)['memoryBytes'], 800)

    def test_report_drops_optional_metrics_to_fit_limit(self):
        payload = {'engineVersion': '29', 'resourceSampling': 'complete', 'containers': [
            {'id': 'a' * 64, 'resources': {'extra': 'x' * collector.MAX_REPORT_BYTES}}]}
        sink = Sink()
        with patch.object(collector, 'collect', return_value=payload), contextlib.redirect_stdout(io.StringIO()):
            collector.report(CONFIG, sink)
        sent = json.loads(sink.requests[0].data)
        self.assertEqual(sent['resourceSampling'], 'report_limit')
        self.assertNotIn('resources', sent['containers'][0])


if __name__ == '__main__':
    unittest.main()

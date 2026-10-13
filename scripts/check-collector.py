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
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('collector', Path('worker/collector.py'))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
collector.COLLECTOR_VERSION = json.loads(Path('package.json').read_text())['version']
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
        self.inspect = json.loads(json.dumps(INSPECT))

    def fake_get(self, path, deadline):
        assert deadline > time.monotonic()
        if path == '/version':
            return {'ApiVersion': '1.50', 'Version': '29'}
        if path.endswith('/containers/json?all=1'):
            return [{'Id': self.inspect['Id']}]
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


if __name__ == '__main__':
    unittest.main()

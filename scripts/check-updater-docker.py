"""Real, isolated Docker lifecycle check for migration and failed-report rollback.

Uses the two locally built :ci images and a temporary HTTPS ingest fixture.
Only release discovery/pulling is replaced; Compose resolution, image capture,
deployment, accepted-report checks, and transactional recovery use production code.
"""
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4


REPOSITORY = Path(__file__).resolve().parents[1]


def load_manager():
    loader = importlib.machinery.SourceFileLoader('crowsnest_docker_manager', str(REPOSITORY / 'collector/crowsnest'))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    manager = importlib.util.module_from_spec(spec)
    loader.exec_module(manager)
    return manager


def command(args, root=None, allow_failure=False):
    result = subprocess.run(args, cwd=root, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=180, check=False)
    if result.returncode and not allow_failure:
        raise RuntimeError('Lifecycle command failed: ' + args[0] + '\n' + result.stderr[-3000:])
    return result.stdout.strip()


class Ingest(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, root, collector_name):
        super().__init__(('0.0.0.0', 0), IngestHandler)
        self.allow_reports = threading.Event()
        self.allow_reports.set()
        self.reports = []
        self.reports_lock = threading.Lock()
        self.collector_name = collector_name
        self.host_id = str(uuid4())
        self.host_token = 'synthetic-lifecycle-reporting-token'
        certificate = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        certificate.load_cert_chain(root / 'ca.pem', root / 'key.pem')
        self.socket = certificate.wrap_socket(self.socket, server_side=True)

    def observed(self, accepted):
        with self.reports_lock:
            return [item.copy() for item in self.reports if item['accepted'] is accepted]


class IngestHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        self.connection.settimeout(10)
        count = int(self.headers.get('Content-Length', '0'))
        if count < 2 or count > 131072:
            self.send_error(400)
            return
        data = json.loads(self.rfile.read(count))
        valid = (self.path == '/api/ingest/' + self.server.host_id
                 and self.headers.get('Authorization') == 'Bearer ' + self.server.host_token
                 and isinstance(data.get('containers'), list))
        accepted = valid and self.server.allow_reports.is_set()
        self_id = next((item['id'] for item in data.get('containers', [])
                        if item.get('name') == self.server.collector_name), None)
        with self.server.reports_lock:
            self.server.reports.append({'accepted': accepted, 'selfId': self_id,
                                        'version': data.get('collectorVersion'),
                                        'protocol': data.get('collectorProtocol')})
        body = json.dumps({'ok': accepted}).encode()
        self.send_response(200 if accepted else 503)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def prepare_installation(root, project, collector_name, proxy_name, images, ingest):
    """Start with shipped legacy files plus ordinary Compose overrides."""
    metadata = json.loads((REPOSITORY / 'collector/version.json').read_text())
    source = (REPOSITORY / 'worker/collector.py').read_text()
    source = source.replace('__COLLECTOR_VERSION__', metadata['version'])
    source = source.replace('__COLLECTOR_PROTOCOL__', str(metadata['protocol']))
    assert '__COLLECTOR_VERSION__' not in source and '__COLLECTOR_PROTOCOL__' not in source
    (root / 'collector.py').write_text(source)
    (root / 'proxy.cfg').write_bytes((REPOSITORY / 'worker/proxy.cfg').read_bytes())
    template = (REPOSITORY / 'worker/compose.yaml').read_text()
    template = template.replace('name: crowsnest-collector\n', 'name: ' + project + '\n', 1)
    template = template.replace('container_name: crowsnest-collector', 'container_name: ' + collector_name)
    template = template.replace('container_name: crowsnest-socket-proxy', 'container_name: ' + proxy_name)
    template = re.sub(r'(?m)^    image: python:[^\n]+$', '    image: ' + images['collector'], template)
    template = re.sub(r'(?m)^    image: haproxy:[^\n]+$', '    image: ' + images['proxy'], template)
    (root / 'compose.yaml').write_text(template)
    overrides = {'services': {
        'collector': {
            'extra_hosts': ['host.docker.internal:host-gateway'],
            'environment': {'SSL_CERT_FILE': '/run/test-ca.pem',
                            'PRESERVE_LITERAL': 'literal:$${DO_NOT_EXPAND}:$$:100%'},
            'volumes': [{'type': 'bind', 'source': str(root / 'ca.pem'),
                         'target': '/run/test-ca.pem', 'read_only': True}],
            'healthcheck': {'interval': '1s', 'start_period': '0s', 'retries': 1}},
        'socket-proxy': {'healthcheck': {'interval': '1s', 'start_period': '0s', 'retries': 1}},
    }}
    (root / 'compose.override.yaml').write_text(json.dumps(overrides))
    (root / '.env').write_text('COLLECTOR_UID=' + str(os.getuid()) + '\nCOLLECTOR_GID=' + str(os.getgid()) + '\n')
    (root / 'collector.json').write_text(json.dumps({
        'url': 'https://host.docker.internal:' + str(ingest.server_port),
        'hostId': ingest.host_id, 'hostToken': ingest.host_token}))
    (root / 'collector.json').chmod(0o600)
    (root / '.env').chmod(0o600)
    return metadata


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true' and '--allow-local-docker' not in sys.argv:
        raise RuntimeError('This isolated lifecycle check requires CI; use --allow-local-docker only on a disposable local daemon')
    # Never inherit a production or remote Docker context from the calling shell.
    for key in ['DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'COMPOSE_FILE', 'COMPOSE_PROJECT_NAME']:
        os.environ.pop(key, None)
    os.environ['DOCKER_HOST'] = 'unix:///var/run/docker.sock'
    os.environ.pop('DO_NOT_EXPAND', None)
    manager_module = load_manager()
    images = {role: command(['docker', 'image', 'inspect', '--format', '{{.Id}}', name])
              for role, name in [('collector', 'crowsnest-collector:ci'), ('proxy', 'crowsnest-socket-proxy:ci')]}
    assert all(re.fullmatch(r'sha256:[a-f0-9]{64}', value) for value in images.values())
    project = 'crowsnest-lifecycle-' + uuid4().hex[:12]
    collector_name, proxy_name = project + '-collector', project + '-proxy'
    for name in [collector_name, proxy_name]:
        assert not command(['docker', 'container', 'ls', '-a', '--filter', 'name=^/' + name + '$', '-q'])
    with tempfile.TemporaryDirectory(prefix=project + '-') as temporary:
        root = Path(temporary)
        command(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                 '-subj', '/CN=host.docker.internal', '-addext', 'subjectAltName=DNS:host.docker.internal,IP:127.0.0.1',
                 '-keyout', str(root / 'key.pem'), '-out', str(root / 'ca.pem')])
        (root / 'key.pem').chmod(0o600)
        (root / 'ca.pem').chmod(0o644)
        ingest = Ingest(root, collector_name)
        server_thread = threading.Thread(target=ingest.serve_forever, daemon=True)
        server_thread.start()
        recovery_stop = threading.Event()
        recovery_thread = None
        engine = None
        manager = None
        try:
            metadata = prepare_installation(root, project, collector_name, proxy_name, images, ingest)
            original = {name: (root / name).read_bytes() for name in
                        ['.env', 'collector.json', 'collector.py', 'proxy.cfg', 'compose.yaml', 'compose.override.yaml']}
            engine = manager_module.Engine(root)

            def local_images_only(references):
                # Publication/registry validation has separate tests. CI exercises
                # the runtime using local immutable IDs and never pulls a release.
                assert references == images
                for reference in references.values():
                    assert command(['docker', 'image', 'inspect', '--format', '{{.Id}}', reference]) == reference

            engine.pull = local_images_only
            manager = manager_module.Manager(root, engine=engine, timeout=90)
            manager.acquire()
            resolved = engine.resolve()
            assert resolved['name'] == project
            assert resolved['services']['collector']['environment']['PRESERVE_LITERAL'] == 'literal:${DO_NOT_EXPAND}:$:100%'
            assert manager_module.legacy_mount(resolved)
            manager_module.atomic_json(manager.directory / 'legacy.json', resolved)
            engine.deploy(manager.directory / 'legacy.json')
            assert engine.healthy(manager.directory / 'legacy.json', 90), 'Legacy fixture must deliver an accepted report before migration'
            assert ingest.observed(True), 'HTTPS fixture did not accept a legacy report'
            release = {'schema': 1, 'version': metadata['version'], 'protocol': metadata['protocol'], 'images': images}
            manager.update(release, migrate=True)
            active = manager_module.read_json(manager.source())
            assert not manager_module.legacy_mount(active), 'Migration must remove code/config source bind mounts'
            assert manager.status()['installedVersion'] == metadata['version']
            assert manager.status()['lastUpdate']['lastResult'] == 'updated'
            inspection = json.loads(command(['docker', 'container', 'inspect', collector_name]))[0]
            assert inspection['Image'] == images['collector']
            assert 'PRESERVE_LITERAL=literal:${DO_NOT_EXPAND}:$:100%' in inspection['Config']['Env']
            assert any(mount['Destination'] == '/run/crowsnest' and not mount['RW'] for mount in inspection['Mounts'])
            assert any(item['version'] == metadata['version'] and item['protocol'] == metadata['protocol']
                       for item in ingest.observed(True)), 'Packaged collector must report its independent version/protocol'
            expected, _installed = engine.capture(active, manager.source())
            accepted_before_failure = len(ingest.observed(True))
            ingest.allow_reports.clear()

            def resume_only_during_recovery():
                while not recovery_stop.wait(0.05):
                    if (manager.directory / 'recovery.json').exists():
                        ingest.allow_reports.set()
                        return

            recovery_thread = threading.Thread(target=resume_only_during_recovery, daemon=True)
            recovery_thread.start()
            parts = metadata['version'].split('.')
            parts[-1] = str(int(parts[-1]) + 1)
            failed_release = {**release, 'version': '.'.join(parts)}
            manager.timeout = 45
            try:
                manager.update(failed_release)
                raise AssertionError('A collector whose reports are rejected must not commit the update')
            except manager_module.Error as error:
                assert 'previous deployment restored and reporting verified' in str(error), str(error)
            assert ingest.observed(False), 'Candidate must attempt a real report rejected by the fixture'
            assert len(ingest.observed(True)) > accepted_before_failure, 'Rollback must produce a new accepted report'
            assert manager_module.read_json(manager.source()) == expected, 'Rollback must restore the exact previous effective configuration'
            assert manager.status()['installedVersion'] == metadata['version']
            assert manager.status()['lastUpdate']['lastResult'] == 'rolled_back'
            assert manager.status()['lastUpdate']['rollback'] == 'succeeded'
            assert not manager.status()['pendingRecovery']
            assert manager_module.read_json(manager.directory / 'blocked-version.json')['version'] == failed_release['version']
            restored = json.loads(command(['docker', 'container', 'inspect', collector_name]))[0]
            assert restored['Image'] == images['collector']
            assert restored['Id'] not in {item['selfId'] for item in ingest.observed(False)}, 'Rollback must verify the restored container, not the rejected candidate'
            assert 'PRESERVE_LITERAL=literal:${DO_NOT_EXPAND}:$:100%' in restored['Config']['Env']
            for name, body in original.items():
                assert (root / name).read_bytes() == body, 'Migration/rollback changed user-owned file ' + name
            print('Docker lifecycle passed: legacy report, packaged migration, literal-dollar Compose snapshot, rejected candidate report, exact rollback, and fresh accepted reporting')
        finally:
            recovery_stop.set()
            ingest.allow_reports.set()
            if recovery_thread:
                recovery_thread.join(timeout=2)
            if engine and manager:
                source = manager.source() or manager.directory / 'legacy.json'
                if source.exists():
                    try:
                        command(engine.compose(source) + ['down', '--remove-orphans', '--timeout', '5'], root, allow_failure=True)
                    except Exception:
                        pass
            command(['docker', 'container', 'rm', '--force', collector_name, proxy_name], allow_failure=True)
            network_ids = command(['docker', 'network', 'ls', '--filter', 'label=com.docker.compose.project=' + project, '-q'], allow_failure=True).split()
            if network_ids:
                command(['docker', 'network', 'rm', *network_ids], allow_failure=True)
            if manager and manager.lock:
                manager.lock.close()
            ingest.shutdown()
            ingest.server_close()
            server_thread.join(timeout=5)


if __name__ == '__main__':
    main()

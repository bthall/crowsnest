"""Outbound Docker status collector. Standard library only; never logs credentials."""
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, Lock

DOCKER = 'http://socket-proxy:2375'
COLLECTOR_VERSION = '__APP_VERSION__'
MAX_CONTAINERS = 250
MAX_REPORT_BYTES = 131072
INSPECTION_WORKERS = 4
COLLECTION_BUDGET = 60
RESOURCE_BUDGET = 6
CPU_SAMPLES = {}
CPU_LOCK = Lock()


def nonnegative_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 9007199254740991


def resource_values(data, container, sampled_at):
    """Docker workload measurements only; never copy raw stats into a report."""
    # Docker's one-shot path can omit ID; the request already binds the full ID.
    # Reject an inconsistent ID whenever the daemon does supply one.
    if not isinstance(data, dict) or ('id' in data and data['id'] != container['id']):
        raise ValueError('Resource ID mismatch')
    cpu = data.get('cpu_stats') or {}
    total = (cpu.get('cpu_usage') or {}).get('total_usage')
    system = cpu.get('system_cpu_usage')
    cores = cpu.get('online_cpus')
    if cores is None:
        cores = len((cpu.get('cpu_usage') or {}).get('percpu_usage') or [])
    percent, seconds = None, None
    with CPU_LOCK:
        previous = CPU_SAMPLES.pop(container['id'], None)
        if (isinstance(total, int) and not isinstance(total, bool) and total >= 0
                and isinstance(system, int) and not isinstance(system, bool) and system >= 0
                and isinstance(cores, int) and not isinstance(cores, bool) and 0 < cores <= 4096):
            CPU_SAMPLES[container['id']] = (container['startedAt'], total, system, sampled_at)
            if previous and previous[0] == container['startedAt'] and 0 < sampled_at - previous[3] <= 120:
                total_delta, system_delta = total - previous[1], system - previous[2]
                if total_delta >= 0 and system_delta > 0:
                    candidate = total_delta / system_delta * cores * 100
                    if math.isfinite(candidate) and 0 <= candidate <= 1000000:
                        percent, seconds = round(candidate, 2), round(sampled_at - previous[3], 2)
    memory = data.get('memory_stats') or {}
    usage, limit = memory.get('usage'), memory.get('limit')
    cache = (memory.get('stats') or {}).get('total_inactive_file')
    if cache is None:
        cache = (memory.get('stats') or {}).get('inactive_file', 0)
    return {'cpuPercent': percent, 'sampleSeconds': seconds,
            'memoryBytes': max(0, usage - cache) if nonnegative_int(usage) and nonnegative_int(cache) else None,
            'memoryLimitBytes': limit if nonnegative_int(limit) and limit > 0 else None}


def collect_resources(prefix, api_version, containers, deadline):
    running = [c for c in containers if c['state'] == 'running']
    with CPU_LOCK:
        active = {c['id'] for c in running}
        for container_id in list(CPU_SAMPLES):
            if container_id not in active:
                del CPU_SAMPLES[container_id]
    if tuple(map(int, api_version.split('.'))) < (1, 41):
        return 'unsupported'
    if not running:
        return 'complete'
    resource_deadline = min(deadline, time.monotonic() + RESOURCE_BUDGET)
    denied = Event()

    def sample(container):
        if denied.is_set() or time.monotonic() >= resource_deadline:
            return
        try:
            stats = get(prefix + '/containers/' + container['id'] + '/stats?stream=false&one-shot=true', resource_deadline)
            container['resources'] = resource_values(stats, container, time.monotonic())
        except urllib.error.HTTPError as error:
            if error.code == 403:
                denied.set()  # Old restricted proxies still deliver normal status.
            error.close()
        except Exception:
            pass  # Optional metrics must never prevent a status report.

    with ThreadPoolExecutor(max_workers=INSPECTION_WORKERS) as pool:
        list(pool.map(sample, running))
    measured = [c.get('resources') for c in running]
    if all(r and r['cpuPercent'] is not None and r['memoryBytes'] is not None for r in measured):
        return 'complete'
    if all(r and r['memoryBytes'] is not None for r in measured):
        return 'warming'
    return 'partial' if any(measured) else 'unavailable'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def check_config(config):
    if not isinstance(config, dict):
        raise ValueError('Invalid collector configuration')
    if not isinstance(config.get('url'), str):
        raise ValueError('Invalid private Site destination')
    url = urllib.parse.urlsplit(config['url'])
    port = url.port  # Validate the port even when no platform credential is present.
    if (url.scheme != 'https' or not url.hostname or url.username or url.password
            or ('serviceToken' in config and port not in (None, 443)) or url.path not in ('', '/')
            or url.query or url.fragment
            or not isinstance(config.get('hostId'), str)
            or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', config['hostId'])):
        raise ValueError('Invalid private Site destination')
    for key in ('hostToken',) + (('serviceToken',) if 'serviceToken' in config else ()):
        value = config.get(key)
        if not isinstance(value, str) or not re.fullmatch(r'[\x21-\x7e]{1,8192}', value):
            raise ValueError('Invalid reporting credentials')
    return config['url'].rstrip('/') + '/api/ingest/' + config['hostId']


def read_json(response, limit):
    body = response.read(limit + 1)
    if len(body) > limit:
        raise ValueError('Response exceeds limit')
    return json.loads(body)


def get(path, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('Collection budget exceeded')
    # Each inspection gets its own opener; no mutable handlers are shared by threads.
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.ProxyHandler({}))
    with opener.open(DOCKER + path, timeout=min(10, remaining)) as response:
        return read_json(response, 8 * 1024 * 1024)


def collect():
    deadline = time.monotonic() + COLLECTION_BUDGET
    version = get('/version', deadline)
    api_version = version.get('ApiVersion', '')
    if not isinstance(api_version, str) or not re.fullmatch(r'[0-9]+\.[0-9]+', api_version):
        raise ValueError('Invalid Docker API version')
    prefix = '/v' + api_version
    containers = get(prefix + '/containers/json?all=1', deadline)
    if not isinstance(containers, list) or len(containers) > MAX_CONTAINERS:
        raise ValueError('Invalid or oversized container list')
    ids = [item.get('Id') if isinstance(item, dict) else None for item in containers]
    if any(not isinstance(id, str) or not re.fullmatch(r'[a-f0-9]{64}', id) for id in ids) or len(set(ids)) != len(ids):
        raise ValueError('Invalid container IDs')

    def inspect(container_id):
        try:
            c = get(prefix + '/containers/' + container_id + '/json', deadline)
        except urllib.error.HTTPError as error:
            error.close()
            if error.code == 404:
                # Compose may replace a container after it was listed.
                return None
            raise
        if c.get('Id') != container_id:
            raise ValueError('Container inspection ID mismatch')
        state = c.get('State') or {}
        config = c.get('Config') or {}
        labels = config.get('Labels') or {}
        return {
            'id': container_id, 'name': c.get('Name', '').lstrip('/'),
            'image': config.get('Image', 'unknown'),
            'state': state.get('Status', 'unknown'),
            'health': (state.get('Health') or {}).get('Status', 'none'),
            'restarts': c.get('RestartCount', 0),
            'startedAt': state.get('StartedAt', ''),
            'finishedAt': state.get('FinishedAt', ''),
            'composeProject': labels.get('com.docker.compose.project', ''),
            'composeService': labels.get('com.docker.compose.service', '')
        }

    with ThreadPoolExecutor(max_workers=INSPECTION_WORKERS) as pool:
        result = [c for c in pool.map(inspect, ids) if c is not None]
    return {'containers': result, 'engineVersion': version.get('Version', 'unknown'),
            'collectorVersion': COLLECTOR_VERSION,
            'resourceSampling': collect_resources(prefix, api_version, result, deadline)}


def report(config, opener):
    endpoint = check_config(config)
    data = collect()
    body = json.dumps(data).encode()
    if len(body) > MAX_REPORT_BYTES and 'resourceSampling' in data:
        for container in data['containers']:
            container.pop('resources', None)
        data['resourceSampling'] = 'report_limit'
        body = json.dumps(data).encode()
    if len(body) > MAX_REPORT_BYTES:
        raise ValueError('Report exceeds the dashboard limit')
    request = urllib.request.Request(endpoint, data=body, headers={
        'Content-Type': 'application/json',
        **({'OAI-Sites-Authorization': 'Bearer ' + config['serviceToken']} if 'serviceToken' in config else {}),
        'Authorization': 'Bearer ' + config['hostToken']
    }, method='POST')
    with opener.open(request, timeout=20) as response:
        acknowledgement = read_json(response, 8192)
        if response.status != 200 or not isinstance(acknowledgement, dict) or acknowledgement.get('ok') is not True:
            raise ValueError('Report was not accepted')
    # Health checks require a delivery accepted by the dashboard.
    try:
        Path('/tmp/crowsnest-last-success').touch()
    except OSError:
        pass  # Source-only updates can retain a read-only Compose filesystem.
    print('Status delivered: ' + str(len(data['containers'])) + ' containers', flush=True)


def main():
    config = json.loads(Path('/run/config/collector.json').read_text())
    check_config(config)
    opener = urllib.request.build_opener(NoRedirect())
    while True:
        started = time.monotonic()
        try:
            report(config, opener)
        except urllib.error.HTTPError as error:
            print('Reporting failed: HTTP ' + str(error.code) + '; will retry', flush=True)
            error.close()
        except Exception as error:
            print('Collection failed: ' + type(error).__name__ + '; will retry', flush=True)
        time.sleep(max(1, 30 - (time.monotonic() - started)))


if __name__ == '__main__':
    main()

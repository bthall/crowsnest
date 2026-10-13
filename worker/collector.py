"""Outbound Docker status collector. Standard library only; never logs credentials."""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

DOCKER = 'http://socket-proxy:2375'
COLLECTOR_VERSION = '__APP_VERSION__'
MAX_CONTAINERS = 250
MAX_REPORT_BYTES = 131072
INSPECTION_WORKERS = 4
COLLECTION_BUDGET = 60


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
            'collectorVersion': COLLECTOR_VERSION}


def report(config, opener):
    endpoint = check_config(config)
    data = collect()
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

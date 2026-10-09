import json, os, time, urllib.request, urllib.error, datetime

DOCKER = 'http://socket-proxy:2375'
with open('/run/config/collector.json') as f:
    CONFIG = json.load(f)

def get(path):
    with urllib.request.urlopen(DOCKER + path, timeout=10) as response:
        return json.load(response)

def report():
    version = get('/version')
    prefix = '/v' + version['ApiVersion']
    containers = get(prefix + '/containers/json?all=1')
    if len(containers) > 250:
        raise RuntimeError('Host exceeds the 250-container report limit')
    result = []
    for item in containers:
        c = get(prefix + '/containers/' + item['Id'] + '/json')
        state = c.get('State', {})
        result.append({
            'id': c['Id'], 'name': c.get('Name', '').lstrip('/'),
            'image': c.get('Config', {}).get('Image', 'unknown'),
            'state': state.get('Status', 'unknown'),
            'health': state.get('Health', {}).get('Status', 'none'),
            'restarts': c.get('RestartCount', 0),
            'startedAt': state.get('StartedAt', ''),
            'finishedAt': state.get('FinishedAt', '')
        })
    body = json.dumps({'containers': result, 'engineVersion': version.get('Version', 'unknown')}).encode()
    req = urllib.request.Request(CONFIG['url'] + '/api/ingest/' + CONFIG['hostId'], data=body, headers={
        'Content-Type': 'application/json',
        'OAI-Sites-Authorization': 'Bearer ' + CONFIG['serviceToken'],
        'Authorization': 'Bearer ' + CONFIG['hostToken']
    }, method='POST')
    with urllib.request.urlopen(req, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError('Report rejected')
    print('Status delivered: ' + str(len(result)) + ' containers', flush=True)

while True:
    try:
        report()
    except urllib.error.HTTPError as exc:
        print('Reporting failed: HTTP ' + str(exc.code) + '; will retry', flush=True)
    except Exception as exc:
        print('Collection failed: ' + type(exc).__name__ + '; will retry', flush=True)
    time.sleep(30)

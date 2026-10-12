"""Exercise the actual collector report with a synthetic Docker API and HTTP sink."""
import ast
import contextlib
import io
import json
import pathlib
import urllib.request

source = pathlib.Path('worker/collector.py').read_text()
tree = ast.parse(source)
# Load functions without reading deployed credentials or starting the polling loop.
functions = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)], type_ignores=[])
captured = []
inspect = {
    'Id': 'a' * 64, 'Name': '/web',
    'Config': {'Image': 'nginx', 'Env': ['SECRET=must-not-collect'], 'Labels': {
        'com.docker.compose.project': 'media', 'com.docker.compose.service': 'web',
        'private.label': 'must-not-collect'}},
    'State': {'Status': 'running', 'Health': {'Status': 'healthy'}},
}
def fake_get(path):
    if path == '/version':
        return {'ApiVersion': '1.50', 'Version': '29'}
    if path.endswith('/containers/json?all=1'):
        return [{'Id': inspect['Id']}]
    assert path == '/v1.50/containers/' + inspect['Id'] + '/json'
    return inspect

class Response:
    status = 200
    def __enter__(self):
        return self
    def __exit__(self, *_):
        return False

def fake_urlopen(request, timeout):
    captured.append(json.loads(request.data))
    assert request.method == 'POST' and timeout == 20
    return Response()

version = json.loads(pathlib.Path('package.json').read_text())['version']
namespace = {'json': json, 'urllib': __import__('urllib'), 'COLLECTOR_VERSION': version, 'CONFIG': {
    'url': 'https://board.example.com', 'hostId': 'fixture',
    'hostToken': 'test-host-token', 'serviceToken': 'test-service-token'}}
exec(compile(functions, 'collector.py', 'exec'), namespace)
namespace['get'] = fake_get
original = urllib.request.urlopen
try:
    urllib.request.urlopen = fake_urlopen
    with contextlib.redirect_stdout(io.StringIO()):
        namespace['report']()
        inspect['Config']['Labels'] = None
        namespace['report']()
    assert captured[0]['containers'][0]['composeProject'] == 'media'
    assert captured[0]['collectorVersion'] == version
    assert captured[0]['containers'][0]['composeService'] == 'web'
    assert 'must-not-collect' not in json.dumps(captured)
    assert captured[1]['containers'][0]['composeProject'] == ''
    assert captured[1]['containers'][0]['composeService'] == ''
finally:
    urllib.request.urlopen = original
print('Passed: real collector report includes only Compose project/service labels, handles standalone containers, and excludes environment and arbitrary labels.')

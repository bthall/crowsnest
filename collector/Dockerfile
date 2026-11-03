FROM python:3.13.17-alpine@sha256:bf12ecc0bea3f171d55145dd02c78b5eeb09f30ee2ac9cc2b4c9e4e8f5e30741
WORKDIR /app
COPY worker/collector.py /app/collector.py
COPY collector/version.json /tmp/collector-version.json
RUN python -c "import json,pathlib,re; v=json.loads(pathlib.Path('/tmp/collector-version.json').read_text()); assert re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)',v['version']); assert type(v['protocol']) is int and 0<v['protocol']<65536; p=pathlib.Path('/app/collector.py'); s=p.read_text(); assert '__COLLECTOR_VERSION__' in s and '__COLLECTOR_PROTOCOL__' in s; p.write_text(s.replace('__COLLECTOR_VERSION__',v['version']).replace('__COLLECTOR_PROTOCOL__',str(v['protocol']))); p.chmod(0o444)" \
    && rm /tmp/collector-version.json
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 65534:65534
CMD ["python", "-u", "/app/collector.py"]

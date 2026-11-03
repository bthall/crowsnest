FROM python:3.15.0-alpine@sha256:2699b90f4d562a22e2dd076c82f964032f64814204bff36d271a54ba4cc2c7e2
WORKDIR /app
COPY worker/collector.py /app/collector.py
COPY collector/version.json /tmp/collector-version.json
# The collector uses only the standard library; packaging tools and their bundled
# dependencies are not needed in the runtime.
RUN python -m pip uninstall --yes pip setuptools \
    && python -c "import ensurepip,pathlib,shutil; shutil.rmtree(pathlib.Path(ensurepip.__file__).parent)" \
    && python -c "import json,pathlib,re; v=json.loads(pathlib.Path('/tmp/collector-version.json').read_text()); assert re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)',v['version']); assert type(v['protocol']) is int and 0<v['protocol']<65536; p=pathlib.Path('/app/collector.py'); s=p.read_text(); assert '__COLLECTOR_VERSION__' in s and '__COLLECTOR_PROTOCOL__' in s; p.write_text(s.replace('__COLLECTOR_VERSION__',v['version']).replace('__COLLECTOR_PROTOCOL__',str(v['protocol']))); p.chmod(0o444)" \
    && rm /tmp/collector-version.json
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 65534:65534
CMD ["python", "-u", "/app/collector.py"]

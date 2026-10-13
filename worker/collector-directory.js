// Keep legacy path knowledge here so new setup consistently uses Crowsnest.
function collectorDirectoryCommands(current='/srv/docker/crowsnest-collector',legacy='/srv/docker/docker-dashboard-collector') {
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  return ['if [ -n "${CROWSNEST_COLLECTOR_DIR:-}" ]; then',
    '  cd -- "$CROWSNEST_COLLECTOR_DIR"',
    'elif [ -d '+quote(current)+' ] && [ -d '+quote(legacy)+' ]; then',
    '  echo "Two collector directories exist. Export CROWSNEST_COLLECTOR_DIR to select the installation." >&2',
    '  exit 1',
    'elif [ -d '+quote(current)+' ]; then',
    '  cd -- '+quote(current),
    'else','  cd -- '+quote(legacy),'fi'];
}

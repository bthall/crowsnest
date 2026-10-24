"""Exercise unattended private writer access without contacting production."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("notifier", Path("notifier/notifier.py"))
notifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notifier)
config = {"url": "https://board.example.com", "serviceToken": "test-service-token"}
timestamp = "2026-10-10T10:00:00Z"


class Opener:
    def __init__(self, replies):
        self.replies = list(replies)
        self.requests = []

    def open(self, request, timeout):
        assert timeout == 180
        self.requests.append(request)
        data = self.replies.pop(0)
        return io.BytesIO(data if isinstance(data, bytes) else json.dumps(data).encode())


for url in ["http://board.example.com", "https://user:password@board.example.com", "https://board.example.com/path", "https://board.example.com?token=x"]:
    try:
        notifier.check_config({**config, "url": url})
        raise AssertionError("Invalid destination accepted")
    except ValueError:
        pass
opener = Opener([{"ok": True, "at": timestamp}, {"ok": True, "at": timestamp, "checked": 3, "pending": 0}])
assert notifier.sweep(config, opener)["checked"] == 3
assert [r.method for r in opener.requests] == ["POST", "GET"]
for request in opener.requests:
    assert request.full_url == "https://board.example.com/api/notifications/sweep"
    assert request.get_header("Authorization") == "Bearer test-service-token"
    assert request.get_header("Oai-sites-authorization") == "Bearer test-service-token"
assert notifier.NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://other.example.com") is None
for replies in [[{"ok": False}], [None], [[]], [{"ok": True, "at": timestamp}, None], [{"ok": True, "at": timestamp}, {"at": "different"}], [b"x" * 8193]]:
    try:
        notifier.sweep(config, Opener(replies))
        raise AssertionError("Invalid sweep accepted")
    except ValueError:
        pass
for config_value in [None, [], {**config, "url": 7}, {**config, "serviceToken": "test-service-token" + "\nheader"}]:
    try:
        notifier.check_config(config_value)
        raise AssertionError("Invalid configuration accepted")
    except ValueError:
        pass
print("Passed: unattended sweep HTTPS/private credentials, redirect denial, bounded responses, and persisted readback verification.")

# Run one real main-loop iteration, then stop at its sleep boundary.
class StopLoop(Exception):
    pass

for result, marker_error in [({"at": timestamp}, None), (ValueError("readback failed"), None),
                             ({"at": timestamp, "lastDeliveryError": True}, OSError("Read-only filesystem"))]:
    with patch.object(notifier.Path, "read_text", return_value=json.dumps(config)), \
            patch.object(notifier.Path, "touch", side_effect=marker_error) as heartbeat, \
            patch.object(notifier, "sweep") as sweep, \
            patch.object(notifier.time, "sleep", side_effect=StopLoop):
        if isinstance(result, Exception):
            sweep.side_effect = result
        else:
            sweep.return_value = result
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            try:
                notifier.main()
            except StopLoop:
                pass
        assert heartbeat.call_count == (0 if isinstance(result, Exception) else 1)
        if not isinstance(result, Exception):
            assert "Sweep confirmed:" in output.getvalue()
            assert "Sweep failed:" not in output.getvalue()
            if result.get("lastDeliveryError"):
                assert "ntfy delivery is pending" in output.getvalue()
print("Passed: confirmed sweeps advance health markers; read-only markers preserve confirmation and delivery diagnostics.")

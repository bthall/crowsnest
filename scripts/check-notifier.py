"""Exercise unattended private writer access without contacting production."""
import importlib.util
import io
import json
from pathlib import Path

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

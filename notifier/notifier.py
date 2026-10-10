"""Optional unattended sweep runner for private Crowsnest Sites; standard library only."""
import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def check_config(config):
    url = urllib.parse.urlsplit(config.get("url", ""))
    if (url.scheme != "https" or not url.hostname or url.username or url.password
            or url.port not in (None, 443) or url.path not in ("", "/")
            or url.query or url.fragment or not isinstance(config.get("serviceToken"), str)
            or not config["serviceToken"]):
        raise ValueError("Invalid private Site configuration")
    return config["url"].rstrip("/") + "/api/notifications/sweep"


def sweep(config, opener):
    endpoint = check_config(config)
    headers = {"OAI-Sites-Authorization": "Bearer " + config["serviceToken"],
               "Authorization": "Bearer " + config["serviceToken"],
               "Content-Type": "application/json"}

    def call(method):
        request = urllib.request.Request(endpoint, data=b"{}" if method == "POST" else None,
                                         headers=headers, method=method)
        with opener.open(request, timeout=180) as response:
            body = response.read(8193)
            if len(body) > 8192:
                raise ValueError("Unexpected sweep response")
            return json.loads(body)

    result = call("POST")
    if result.get("ok") is not True:
        raise ValueError("Sweep was not accepted")
    saved = call("GET")
    if not saved.get("at") or (not result.get("skipped") and saved["at"] != result.get("at")):
        raise ValueError("Sweep readback did not match")
    return saved


def main():
    config = json.loads(Path("/config/notifier.json").read_text())
    check_config(config)
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    while True:
        started = time.monotonic()
        try:
            result = sweep(config, opener)
            print("Sweep confirmed: checked={checked} sent={sent} pending={pending} at={at}".format(
                checked=result.get("checked", 0), sent=result.get("sent", 0),
                pending=result.get("pending", 0), at=result["at"]), flush=True)
            if result.get("lastDeliveryError"):
                print("ntfy delivery is pending; check the dashboard delivery status.", flush=True)
        except urllib.error.HTTPError as error:
            print("Sweep failed: HTTP {}. Retrying on the next check.".format(error.code), flush=True)
        except Exception as error:
            # Transport details can include credentials. Log only the error type.
            print("Sweep failed: {}. Retrying on the next check.".format(type(error).__name__), flush=True)
        time.sleep(max(1, 60 - (time.monotonic() - started)))


if __name__ == "__main__":
    main()

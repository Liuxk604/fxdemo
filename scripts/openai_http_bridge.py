import json
import socket
import sys
import urllib.error
import urllib.request


def main():
    try:
        raw = sys.stdin.buffer.read().decode("utf-8")
        request = json.loads(raw or "{}")
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "status": None,
            "error": f"Invalid bridge input: {exc}",
            "body": None
        }))
        return 0

    url = request.get("url")
    api_key = request.get("api_key")
    payload = request.get("payload")
    timeout_ms = request.get("timeout_ms") or 90000

    if not url or not api_key:
        print(json.dumps({
            "ok": False,
            "status": None,
            "error": "Missing url or api_key",
            "body": None
        }))
        return 0

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=max(timeout_ms / 1000, 1)) as resp:
            body_text = resp.read().decode("utf-8")
            try:
                body = json.loads(body_text)
            except Exception:
                body = body_text
            print(json.dumps({
                "ok": True,
                "status": resp.status,
                "body": body
            }))
            return 0
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(body_text)
        except Exception:
            body = body_text
        print(json.dumps({
            "ok": False,
            "status": exc.code,
            "error": str(exc),
            "body": body
        }))
        return 0
    except (urllib.error.URLError, socket.timeout, TimeoutError) as exc:
        print(json.dumps({
            "ok": False,
            "status": None,
            "error": str(exc.reason if hasattr(exc, "reason") else exc),
            "body": None
        }))
        return 0
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "status": None,
            "error": str(exc),
            "body": None
        }))
        return 0


if __name__ == "__main__":
    sys.exit(main())

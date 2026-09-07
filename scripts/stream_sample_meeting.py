#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import re
import socket
import time
from datetime import datetime, timezone
from urllib import error, request
from urllib.parse import urlsplit
from uuid import uuid4


SAMPLE_LINES = [
    ("Maria", "Can we agree on the launch date today? We need a decision before the planning meeting."),
    ("Dan", "I am not sure we have enough data. I think we should validate the migration cost first."),
    ("Priya", "My concern is the compliance review. If that slips, the rest of the schedule is at risk."),
    ("Alex", "That said, I hear the timeline pressure, but I am not convinced we should expand the scope."),
    ("Maria", "What specific data would let us decide today?"),
    ("Dan", "If we can confirm the migration cost and owner, I can support moving forward."),
    ("Priya", "Who owns the compliance review? We need someone accountable by tomorrow."),
    ("Alex", "Keep it small for this release. The analytics work feels out of scope."),
]


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def send(opener, url: str, method: str, token: str, payload=None) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(payload if payload is not None else {}).encode("utf-8")
    for attempt in range(3):
        req = request.Request(url, data=data, headers=headers, method=method)
        try:
            with opener.open(req, timeout=10) as response:
                result = json.load(response)
                if not isinstance(result, dict):
                    raise ValueError("invalid_response")
                return result
        except error.HTTPError as exc:
            status = exc.code
            exc.close()
            if status not in {408, 429, 500, 502, 503, 504} or attempt == 2:
                raise RuntimeError(f"http_{status}") from None
        except (error.URLError, TimeoutError, socket.timeout, ConnectionError):
            if attempt == 2:
                raise RuntimeError("connection_failed") from None
        time.sleep(0.25 * (2**attempt))
    raise RuntimeError("retry_exhausted")


def main() -> None:
    parser = argparse.ArgumentParser(description="Stream synthetic captions; print metadata only.")
    parser.add_argument("--base-url", default="http://localhost:8010")
    parser.add_argument("--session", default=None)
    parser.add_argument("--delay", type=float, default=1.2)
    parser.add_argument("--end", action="store_true", help="End and clear the session after streaming.")
    args = parser.parse_args()
    session = args.session if args.session is not None else f"sample-{uuid4().hex[:16]}"
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", session):
        parser.error("session must contain 1-80 ASCII letters, digits, underscores or hyphens")
    if not math.isfinite(args.delay) or args.delay < 0:
        parser.error("delay must be finite and nonnegative")
    try:
        parsed = urlsplit(args.base_url)
        valid_url = (parsed.scheme in {"http", "https"} and parsed.hostname
                     and not parsed.username and not parsed.password
                     and not parsed.query and not parsed.fragment)
        parsed.port
    except ValueError:
        valid_url = False
    if not valid_url:
        parser.error("base URL must be HTTP(S), without credentials, query or fragment")
    token = os.getenv("MEETING_OBSERVER_ACCESS_TOKEN", "")
    opener = request.build_opener(NoRedirect())
    endpoint = f"{args.base_url.rstrip('/')}/api/sessions/{session}"
    run_id = uuid4().hex
    created = False
    failed = False
    try:
        snapshot = send(opener, endpoint, "POST", token)
        if snapshot.get("status") != "active":
            raise RuntimeError("session_not_active")
        created = True
        print(json.dumps({"session": session, "status": "active", "synthetic": True}), flush=True)
        for index, (speaker, line) in enumerate(SAMPLE_LINES, start=1):
            payload = {
                "speaker": speaker,
                "text": line,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "source": "sample-stream",
                "sequence": index,
                "client_event_id": f"{run_id}-{index}",
            }
            result = send(opener, f"{endpoint}/events", "POST", token, payload)
            if result.get("accepted") is not True:
                raise RuntimeError("event_not_accepted")
            print(json.dumps({"event": index, "accepted": True,
                              "duplicate": result.get("duplicate") is True}), flush=True)
            if index < len(SAMPLE_LINES):
                remaining = args.delay
                while remaining > 0:
                    interval = min(remaining, 30.0)
                    time.sleep(interval)
                    remaining -= interval
                    if interval == 30.0:
                        send(opener, f"{endpoint}/heartbeat", "POST", token)
    except (RuntimeError, ValueError, OSError) as exc:
        failed = True
        # Only our fixed error codes are printable; exceptions can contain URLs/content.
        code = str(exc) if isinstance(exc, RuntimeError) else "invalid_response_or_configuration"
        print(json.dumps({"status": "failed", "category": code}), flush=True)
    except KeyboardInterrupt:
        failed = True
        print(json.dumps({"status": "interrupted"}), flush=True)
    finally:
        if args.end and created:
            try:
                send(opener, endpoint, "DELETE", token)
                print(json.dumps({"session": session, "status": "ended"}), flush=True)
            except (RuntimeError, ValueError, OSError):
                failed = True
                print(json.dumps({"status": "failed", "category": "end_failed"}), flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

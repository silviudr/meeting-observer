#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from urllib import request


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


def post_event(base_url: str, session: str, speaker: str, text: str, sequence: int) -> None:
    payload = {
        "speaker": speaker,
        "text": text,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "sample-stream",
        "sequence": sequence,
    }
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        f"{base_url.rstrip('/')}/api/sessions/{session}/events",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=10) as response:
        response.read()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8010")
    parser.add_argument("--session", default="demo")
    parser.add_argument("--delay", type=float, default=1.2)
    args = parser.parse_args()

    for index, (speaker, text) in enumerate(SAMPLE_LINES, start=1):
        print(f"{speaker}: {text}")
        post_event(args.base_url, args.session, speaker, text, index)
        time.sleep(args.delay)


if __name__ == "__main__":
    main()

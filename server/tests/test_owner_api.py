from __future__ import annotations

import httpx
import pytest

from app.main import create_app


async def client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_session_creation_accepts_an_owner_and_still_accepts_no_body() -> None:
    app = create_app(access_token="")
    async with app.router.lifespan_context(app):
        async with await client(app) as http:
            with_owner = await http.post("/api/sessions/one", json={"owner_speaker": "Maria"})
            assert with_owner.status_code == 200
            assert with_owner.json()["owner_speaker"] == "Maria"

            legacy = await http.post("/api/sessions/two")
            assert legacy.status_code == 200
            assert legacy.json()["owner_speaker"] is None
            assert legacy.json()["cues"] == []


@pytest.mark.asyncio
async def test_owner_endpoint_sets_clears_and_reports_match() -> None:
    app = create_app(access_token="")
    async with app.router.lifespan_context(app):
        async with await client(app) as http:
            await http.post("/api/sessions/demo")
            await http.post("/api/sessions/demo/events", json={"speaker": "Maria", "text": "Hello."})

            set_owner = await http.post("/api/sessions/demo/owner", json={"owner_speaker": "Maria"})
            assert set_owner.status_code == 200
            assert set_owner.json()["owner_matched"] is True
            assert [p["speaker"] for p in set_owner.json()["participants"] if p["is_owner"]] == ["Maria"]

            cleared = await http.post("/api/sessions/demo/owner", json={"owner_speaker": None})
            assert cleared.json()["owner_speaker"] is None
            assert cleared.json()["owner_matched"] is False


@pytest.mark.asyncio
async def test_owner_endpoint_rejects_unknown_and_ended_sessions() -> None:
    app = create_app(access_token="")
    async with app.router.lifespan_context(app):
        async with await client(app) as http:
            missing = await http.post("/api/sessions/nope/owner", json={"owner_speaker": "Maria"})
            assert missing.status_code == 404

            await http.post("/api/sessions/demo")
            await http.delete("/api/sessions/demo")
            ended = await http.post("/api/sessions/demo/owner", json={"owner_speaker": "Maria"})
            assert ended.status_code == 410


@pytest.mark.asyncio
async def test_owner_endpoint_requires_the_access_token_when_one_is_set() -> None:
    app = create_app(access_token="local-secret")
    async with app.router.lifespan_context(app):
        async with await client(app) as http:
            await http.post(
                "/api/sessions/demo", headers={"Authorization": "Bearer local-secret"}
            )
            unauthorized = await http.post(
                "/api/sessions/demo/owner", json={"owner_speaker": "Maria"}
            )
            assert unauthorized.status_code == 401

            authorized = await http.post(
                "/api/sessions/demo/owner",
                json={"owner_speaker": "Maria"},
                headers={"Authorization": "Bearer local-secret"},
            )
            assert authorized.status_code == 200


@pytest.mark.asyncio
async def test_unanswered_question_cue_reaches_the_snapshot() -> None:
    app = create_app(access_token="")
    async with app.router.lifespan_context(app):
        async with await client(app) as http:
            await http.post("/api/sessions/demo", json={"owner_speaker": "Maria"})
            await http.post(
                "/api/sessions/demo/events",
                json={"speaker": "Dan", "text": "What is the migration cost?"},
            )

            snapshot = (await http.get("/api/sessions/demo")).json()
            kinds = [cue["kind"] for cue in snapshot["cues"]]
            assert "unanswered_question" in kinds

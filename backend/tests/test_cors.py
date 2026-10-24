"""CORS used to be "*" in production: .env.example documented ALLOWED_ORIGINS,
the setting read ALLOWED_ORIGINS_RAW, so the restriction never applied."""
import pytest
from httpx import ASGITransport, AsyncClient

from core.config import Settings

pytestmark = pytest.mark.asyncio


async def _preflight(origin: str):
    from main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        return await ac.options(
            "/health",
            headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
        )


@pytest.mark.parametrize("origin", [
    "https://asaju.vercel.app",
    "https://asaju-dev.vercel.app",
    "https://mantle-agentic-event-jf49milf8-psianturis-projects.vercel.app",
    "https://mantle-agentic-event-git-main-psianturis-projects.vercel.app",
    "http://localhost:5173",
])
async def test_known_frontends_are_allowed(origin):
    resp = await _preflight(origin)
    assert resp.headers.get("access-control-allow-origin") == origin


@pytest.mark.parametrize("origin", [
    "https://evil.example",
    "https://asaju.vercel.app.evil.example",
    "https://mantle-agentic-event-x-otherteam.vercel.app",
])
async def test_other_origins_are_refused(origin):
    resp = await _preflight(origin)
    assert "access-control-allow-origin" not in resp.headers


def test_both_env_names_are_read(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example,https://b.example")
    assert Settings(_env_file=None).allowed_origins == ["https://a.example", "https://b.example"]
    monkeypatch.delenv("ALLOWED_ORIGINS")
    monkeypatch.setenv("ALLOWED_ORIGINS_RAW", "*")
    assert Settings(_env_file=None).allowed_origins == ["*"]

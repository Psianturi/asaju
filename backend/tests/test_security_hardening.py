"""
Tests for the two hardening items: signed mandate revocation and rate limits
on the write-heavy unauthenticated endpoints.

The revocation tests matter because the previous DELETE took no signature —
anyone who knew an agent_id could switch off another owner's background runs.
That is not a fund risk, but it is a silent way to stop someone's agent from
learning, and it would have looked like our own bug.
"""
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import HTTPException

from core import agent_mandate
from core.agent_mandate import (
    confirm_mandate_revocation,
    issue_mandate_challenge,
    issue_mandate_revocation_challenge,
)
from core.rate_limit import reset_state


pytestmark = pytest.mark.asyncio


class _FakeDoc:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data or {})

    async def delete(self):
        self._data = None


class _FakeRef:
    def __init__(self, store, doc_id):
        self._store = store
        self._doc_id = doc_id

    async def get(self):
        return _FakeDoc(self._store.get(self._doc_id))

    async def set(self, data):
        self._store[self._doc_id] = dict(data)

    async def update(self, data):
        self._store.setdefault(self._doc_id, {}).update(data)

    async def delete(self):
        self._store.pop(self._doc_id, None)


class _FakeCollection:
    def __init__(self, store):
        self._store = store

    def document(self, doc_id):
        return _FakeRef(self._store, doc_id)


class _FakeDb:
    def __init__(self):
        self.mandates = {}
        self.challenges = {}
        self.revocations = {}
        self.agents = {}

    def collection(self, name):
        if name == agent_mandate.MANDATES_COLLECTION:
            return _FakeCollection(self.mandates)
        if name == agent_mandate.MANDATE_CHALLENGES_COLLECTION:
            return _FakeCollection(self.challenges)
        if name == agent_mandate.REVOCATION_CHALLENGES_COLLECTION:
            return _FakeCollection(self.revocations)
        if name == "agents":
            return _FakeCollection(self.agents)
        raise AssertionError(f"unexpected collection {name}")


def _patch_owner(monkeypatch, owner):
    async def read(_wallet, _chain):
        return owner

    monkeypatch.setattr("core.agent_auth._read_agent_owner_on_chain", read)


def _sign(message, signer):
    return Account.sign_message(
        encode_defunct(text=message), signer.key
    ).signature.hex()


async def _seed_mandate(db, monkeypatch, owner):
    db.agents["agent-1"] = {"agent_wallet": "0x" + "aa" * 20, "ownership_epoch": 0}
    _patch_owner(monkeypatch, owner.address)
    challenge = await issue_mandate_challenge(
        db,
        agent_id="agent-1",
        agent_wallet="0x" + "aa" * 20,
        chain_id=97,
        scopes=["attend_event"],
        max_runs_per_day=2,
    )
    await agent_mandate.grant_mandate(
        db, nonce=challenge["nonce"], signature=_sign(challenge["message"], owner)
    )


# ── signed revocation ──────────────────────────────────────────────────────


async def test_revocation_requires_owner_signature(monkeypatch):
    owner = Account.create()
    db = _FakeDb()
    await _seed_mandate(db, monkeypatch, owner)

    challenge = await issue_mandate_revocation_challenge(db, agent_id="agent-1", chain_id=97)
    assert db.mandates["agent-1:97"].get("revoked_at") is None, "challenge must not revoke yet"

    result = await confirm_mandate_revocation(
        db, nonce=challenge["nonce"], signature=_sign(challenge["message"], owner)
    )
    assert result["revoked"] is True
    assert db.mandates["agent-1:97"]["revoked_at"]


async def test_stranger_cannot_revoke_someone_elses_mandate(monkeypatch):
    owner = Account.create()
    stranger = Account.create()
    db = _FakeDb()
    await _seed_mandate(db, monkeypatch, owner)

    challenge = await issue_mandate_revocation_challenge(db, agent_id="agent-1", chain_id=97)

    with pytest.raises(HTTPException) as exc:
        await confirm_mandate_revocation(
            db, nonce=challenge["nonce"], signature=_sign(challenge["message"], stranger)
        )
    assert exc.value.status_code == 403
    assert db.mandates["agent-1:97"].get("revoked_at") is None


async def test_revocation_challenge_404s_without_a_mandate(monkeypatch):
    db = _FakeDb()
    with pytest.raises(HTTPException) as exc:
        await issue_mandate_revocation_challenge(db, agent_id="ghost", chain_id=97)
    assert exc.value.status_code == 404


async def test_revocation_signature_cannot_be_replayed(monkeypatch):
    owner = Account.create()
    db = _FakeDb()
    await _seed_mandate(db, monkeypatch, owner)

    challenge = await issue_mandate_revocation_challenge(db, agent_id="agent-1", chain_id=97)
    signature = _sign(challenge["message"], owner)

    await confirm_mandate_revocation(db, nonce=challenge["nonce"], signature=signature)
    # The challenge was deleted on use, so the same signature cannot re-revoke
    # a mandate the owner later grants again.
    with pytest.raises(HTTPException) as exc:
        await confirm_mandate_revocation(db, nonce=challenge["nonce"], signature=signature)
    assert exc.value.status_code == 401


# ── rate limiting ──────────────────────────────────────────────────────────


class _FakeClient:
    def __init__(self, host):
        self.host = host


class _FakeRequest:
    def __init__(self, host="203.0.113.9"):
        self.client = _FakeClient(host)


def test_rate_limit_blocks_past_the_budget():
    from fastapi import HTTPException as FastAPIHTTPException
    from core.rate_limit import enforce

    reset_state()
    request = _FakeRequest()
    for _ in range(3):
        enforce(request, "test-bucket", limit=3, window_seconds=60)
    with pytest.raises(FastAPIHTTPException) as exc:
        enforce(request, "test-bucket", limit=3, window_seconds=60)
    assert exc.value.status_code == 429
    assert "Retry-After" in (exc.value.headers or {})
    reset_state()


def test_rate_limit_is_per_bucket():
    from core.rate_limit import enforce

    reset_state()
    request = _FakeRequest()
    enforce(request, "bucket-a", limit=1, window_seconds=60)
    # A different bucket on the same host is unaffected.
    enforce(request, "bucket-b", limit=1, window_seconds=60)
    reset_state()


def test_rate_limit_is_per_host():
    from fastapi import HTTPException as FastAPIHTTPException
    from core.rate_limit import enforce

    reset_state()
    first = _FakeRequest("198.51.100.1")
    second = _FakeRequest("198.51.100.2")
    for _ in range(2):
        enforce(first, "shared", limit=2, window_seconds=60)
    # Exhausting one host must not lock out everyone else behind another IP.
    enforce(second, "shared", limit=2, window_seconds=60)
    with pytest.raises(FastAPIHTTPException):
        enforce(first, "shared", limit=2, window_seconds=60)
    reset_state()


class _ProxiedRequest:
    """What Cloud Run hands uvicorn: one proxy address, real IP in X-Forwarded-For."""

    def __init__(self, forwarded_for):
        self.client = _FakeClient("169.254.169.126")
        self.headers = {"x-forwarded-for": forwarded_for}


def test_rate_limit_keys_on_forwarded_client_not_the_proxy():
    from core.rate_limit import enforce

    reset_state()
    # Two users behind Cloud Run's single proxy address must not share a bucket.
    enforce(_ProxiedRequest("198.51.100.1"), "proxied", limit=1, window_seconds=60)
    enforce(_ProxiedRequest("198.51.100.2"), "proxied", limit=1, window_seconds=60)
    reset_state()


def test_rate_limit_ignores_spoofed_forwarded_entries():
    from fastapi import HTTPException as FastAPIHTTPException
    from core.rate_limit import client_ip, enforce

    reset_state()
    # The caller controls everything left of what Cloud Run appended.
    assert client_ip(_ProxiedRequest("6.6.6.6, 198.51.100.1")) == "198.51.100.1"
    enforce(_ProxiedRequest("1.1.1.1, 198.51.100.1"), "spoof", limit=1, window_seconds=60)
    with pytest.raises(FastAPIHTTPException):
        enforce(_ProxiedRequest("2.2.2.2, 198.51.100.1"), "spoof", limit=1, window_seconds=60)
    reset_state()


def test_rate_limit_window_slides(monkeypatch):
    import time as time_module
    from core import rate_limit as rl
    from core.rate_limit import enforce

    reset_state()
    request = _FakeRequest()
    base = time_module.time()
    # Two calls inside the window (both fit under the limit of 2), then one
    # call long after the window, where the old hits have aged out.
    times = iter([base, base + 1, base + 200])
    monkeypatch.setattr(rl.time, "time", lambda: next(times))

    enforce(request, "sliding", limit=2, window_seconds=60)
    enforce(request, "sliding", limit=2, window_seconds=60)
    # Long after the window, the caller is free again.
    enforce(request, "sliding", limit=2, window_seconds=60)
    reset_state()
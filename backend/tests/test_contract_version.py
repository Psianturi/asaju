"""Ownership must follow the contract an agent lives on. A V7 Passport can be
transferred on any chain (Mantle included), so its owner is never taken from
the Firestore mirror; legacy Mantle V4 agents keep the old fallback."""
import pytest
from fastapi import HTTPException

from core import agent_auth
from core.contract_version import V4, V6, V7, contract_version_of, is_v7

pytestmark = pytest.mark.asyncio

WALLET = "0x" + "11" * 20
FIRESTORE_OWNER = "0x" + "22" * 20
V7_OWNER = "0x" + "33" * 20


class _Doc:
    def __init__(self, data):
        self._data, self.exists = data, data is not None

    def to_dict(self):
        return dict(self._data or {})


class _Db:
    def __init__(self, data):
        self._data = data

    def collection(self, _name):
        return self

    def document(self, _id):
        return self

    async def get(self):
        return _Doc(self._data)


def test_version_defaults_keep_existing_agents_unchanged():
    assert contract_version_of({"chain_id": 5003}) == V4
    assert contract_version_of({}) == V4
    assert contract_version_of({"chain_id": 97}) == V6
    assert contract_version_of({"chain_id": 5003, "contract_version": 7}) == V7
    assert is_v7({"contract_version": 7}) and not is_v7({"chain_id": 46630})


@pytest.fixture
def readers(monkeypatch):
    calls = {"v7": 0, "legacy": 0}

    def install(v7_owner, legacy_owner=None):
        async def v7(_w, _c):
            calls["v7"] += 1
            return v7_owner

        async def legacy(_w, _c):
            calls["legacy"] += 1
            return legacy_owner

        monkeypatch.setattr(agent_auth, "_read_v7_owner_on_chain", v7)
        monkeypatch.setattr(agent_auth, "_read_agent_owner_on_chain", legacy)
        return calls

    return install


async def test_v7_agent_owner_comes_from_the_passport(readers):
    calls = readers(V7_OWNER)
    db = _Db({"chain_id": 5003, "contract_version": 7, "user_wallet": FIRESTORE_OWNER})
    assert await agent_auth.current_owner_of(db, "a", WALLET, 5003) == V7_OWNER
    assert calls == {"v7": 1, "legacy": 0}


async def test_v7_agent_on_mantle_fails_closed_instead_of_trusting_firestore(readers):
    readers(None)
    db = _Db({"chain_id": 5003, "contract_version": 7, "user_wallet": FIRESTORE_OWNER})
    with pytest.raises(HTTPException) as exc:
        await agent_auth.current_owner_of(db, "a", WALLET, 5003)
    assert exc.value.status_code == 503


async def test_legacy_mantle_agent_keeps_the_firestore_fallback(readers):
    calls = readers(V7_OWNER, legacy_owner=None)
    db = _Db({"chain_id": 5003, "user_wallet": FIRESTORE_OWNER})
    assert (await agent_auth.current_owner_of(db, "a", WALLET, 5003)).lower() == FIRESTORE_OWNER
    assert calls["v7"] == 0

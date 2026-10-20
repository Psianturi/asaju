"""
A direct spawn exists only once spawnAgent() lands on-chain.

Before this, POST /agent/spawn wrote the agent record first and nothing undid
it when the owner's transaction failed (e.g. not enough MNT): the attempt then
showed up as a real agent, counted toward the 3-agent quota, and could even
attend videos.
"""
import time

import pytest

from core import pending_spawn
from routers import agents as agents_router
from routers import monitoring as monitoring_router

pytestmark = pytest.mark.asyncio

OWNER = "0x" + "AB" * 20


class _Doc:
    def __init__(self, store, doc_id):
        self._store, self.id = store, doc_id
        self.exists = doc_id in store

    def to_dict(self):
        return dict(self._store.get(self.id) or {})


class _Ref:
    def __init__(self, store, doc_id):
        self._store, self._id = store, doc_id

    async def get(self):
        return _Doc(self._store, self._id)

    async def set(self, data):
        self._store[self._id] = dict(data)

    async def update(self, data):
        self._store.setdefault(self._id, {}).update(data)

    async def delete(self):
        self._store.pop(self._id, None)


class _Query:
    def __init__(self, store):
        self._store = store

    def where(self, *_, **__):
        return self

    async def get(self):
        return [_Doc(self._store, k) for k in list(self._store)]

    def stream(self):
        docs = [_Doc(self._store, k) for k in list(self._store)]

        async def gen():
            for d in docs:
                yield d

        return gen()


class _Collection(_Query):
    def document(self, doc_id):
        return _Ref(self._store, doc_id)


class _Db:
    def __init__(self):
        self.stores = {}

    def collection(self, name):
        return _Collection(self.stores.setdefault(name, {}))

    @property
    def agents(self):
        return self.stores.setdefault("agents", {})

    @property
    def archived(self):
        return self.stores.setdefault("archived_agents", {})


def _agent(agent_id, *, funded, age=0.0, bred=False):
    return {
        "agent_id": agent_id,
        "agent_name": agent_id,
        "agent_wallet": "0x" + agent_id[-1] * 40,
        "user_wallet": OWNER,
        "chain_id": 5003,
        "funded": funded,
        "ownership_status": "bred" if bred else "original-creator",
        "created_at": time.time() - age,
    }


@pytest.fixture
def env(monkeypatch):
    db = _Db()
    on_chain = {}

    async def is_spawned(wallet, _chain):
        return on_chain.get(wallet, False)

    monkeypatch.setattr(agents_router, "get_db", lambda: db)
    monkeypatch.setattr(monitoring_router, "get_db", lambda: db)
    monkeypatch.setattr(agents_router.web3_service, "is_agent_spawned", is_spawned)

    async def built(data, needs_funding):
        return data["agent_id"]

    monkeypatch.setattr(agents_router, "_build_agent_response", built)

    async def no_balance(*_a, **_k):
        return 0.0

    monkeypatch.setattr(agents_router.web3_service, "get_native_balance", no_balance)
    return db, on_chain


async def test_failed_spawn_is_hidden_from_my_agents(env):
    db, _ = env
    db.agents["live1"] = _agent("live1", funded=True)
    db.agents["pend2"] = _agent("pend2", funded=False)  # spawnAgent() reverted
    listed = await agents_router.list_agents_by_wallet(wallet=OWNER)
    assert listed == ["live1"]


async def test_confirmed_spawn_heals_a_missed_mark_funded(env):
    db, on_chain = env
    db.agents["pend3"] = _agent("pend3", funded=False)
    on_chain[db.agents["pend3"]["agent_wallet"]] = True  # tx landed, browser closed
    listed = await agents_router.list_agents_by_wallet(wallet=OWNER)
    assert listed == ["pend3"]
    assert db.agents["pend3"]["funded"] is True


async def test_bred_offspring_awaiting_activation_stay_visible(env):
    db, _ = env
    db.agents["bred4"] = _agent("bred4", funded=False, bred=True)
    assert await agents_router.list_agents_by_wallet(wallet=OWNER) == ["bred4"]


async def test_failed_attempts_do_not_use_up_the_quota(env):
    db, _ = env
    for i in range(3):
        db.agents[f"old{i}"] = _agent(f"old{i}", funded=False, age=3600)
    quota = await monitoring_router.get_spawn_quota(OWNER, chain_id=5003)
    assert quota["spawned_count"] == 0 and quota["can_spawn"] is True


async def test_old_unconfirmed_attempts_are_archived_with_their_key(env):
    db, _ = env
    db.agents["old5"] = {**_agent("old5", funded=False, age=3600), "private_key_enc": "enc"}
    db.agents["new6"] = _agent("new6", funded=False, age=30)  # may still be in flight
    for data in list(db.agents.values()):
        if await pending_spawn.confirm_on_chain(db, "agents", data) is False:
            await pending_spawn.archive_abandoned(db, "agents", data)
    assert "old5" not in db.agents and db.archived["old5"]["private_key_enc"] == "enc"
    assert "new6" in db.agents


async def test_unreadable_chain_never_counts_or_archives(env, monkeypatch):
    db, _ = env
    db.agents["old7"] = _agent("old7", funded=False, age=3600)

    async def down(*_a, **_k):
        return None

    monkeypatch.setattr(agents_router.web3_service, "is_agent_spawned", down)
    assert await pending_spawn.confirm_on_chain(db, "agents", db.agents["old7"]) is None
    assert "old7" in db.agents

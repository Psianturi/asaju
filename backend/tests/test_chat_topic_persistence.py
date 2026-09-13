"""Regression tests for chat topic persistence and recall."""

import time
from typing import Any

import pytest

from services import wisdom_cache
from services.wisdom_cache import (
    CHAT_TOPICS_COLLECTION,
    persist_chat_topic,
    recall_chat_topics,
)


pytestmark = pytest.mark.asyncio


# ── Fake DB ─────────────────────────────────────────────────────────────────


class _FakeDoc:
    def __init__(self, data: dict | None = None, exists: bool = True):
        self._data = data or {}
        self.exists = exists

    def to_dict(self) -> dict:
        return dict(self._data)


class _FakeDocRef:
    def __init__(self, parent: "_FakeCollection", doc_id: str):
        self.parent = parent
        self.doc_id = doc_id
        self._data = parent._docs.get(doc_id, {})

    async def get(self) -> _FakeDoc:
        return _FakeDoc(self._data, exists=self.doc_id in self.parent._docs)

    async def set(self, data: dict) -> None:
        self._data.update(data)
        self.parent._docs[self.doc_id] = self._data

    async def update(self, patch: dict) -> None:
        self._data.update(patch)
        self.parent._docs[self.doc_id] = self._data


class _FakeCollection:
    def __init__(self):
        self._docs: dict[str, dict] = {}

    def document(self, doc_id: str) -> _FakeDocRef:
        return _FakeDocRef(self, doc_id)

    def where(self, field, op=None, value=None):  # noqa: ARG002
        return _FakeQuery(self, [(field, op, value)])

    def order_by(self, field, direction="ASCENDING") -> "_FakeQuery":
        return _FakeQuery(self, [], order_field=field, order_dir=direction)

    def limit(self, n: int) -> "_FakeQuery":
        return _FakeQuery(self, [], limit=n)


class _FakeQuery:
    def __init__(
        self,
        parent: _FakeCollection,
        filters: list[tuple[str, str, Any]],
        order_field: str | None = None,
        order_dir: str = "ASCENDING",
        limit: int | None = None,
    ):
        self.parent = parent
        self._filters = filters
        self._order_field = order_field
        self._order_dir = order_dir
        self._limit = limit

    def where(self, field, op=None, value=None) -> "_FakeQuery":  # noqa: ARG002
        return _FakeQuery(
            self.parent,
            self._filters + [(field, op, value)],
            order_field=self._order_field,
            order_dir=self._order_dir,
            limit=self._limit,
        )

    def order_by(self, field, direction="ASCENDING") -> "_FakeQuery":
        return _FakeQuery(
            self.parent,
            self._filters,
            order_field=field,
            order_dir=direction,
            limit=self._limit,
        )

    def limit(self, n: int) -> "_FakeQuery":
        return _FakeQuery(
            self.parent,
            self._filters,
            order_field=self._order_field,
            order_dir=self._order_dir,
            limit=n,
        )

    async def get(self):
        """Return an iterable of DocumentSnapshot-likes matching the filters."""
        results = []
        for doc_id, data in self.parent._docs.items():
            ok = True
            for field, op, value in self._filters:
                val = data.get(field)
                if op == "==":
                    if val != value:
                        ok = False
                        break
            if ok:
                results.append((doc_id, data))
        if self._order_field:
            field = self._order_field
            reverse = self._order_dir == "DESCENDING"
            results.sort(key=lambda kv: kv[1].get(field) or 0, reverse=reverse)
        if self._limit:
            results = results[: self._limit]
        # Real Firestore returns Awaitable[QuerySnapshot]; we return a list
        # of DocumentSnapshot-likes which is iterable.
        return [_FakeDoc(data) for _, data in results]


class _FakeDB:
    def __init__(self):
        self.collections: dict[str, _FakeCollection] = {}

    def collection(self, name: str) -> _FakeCollection:
        if name not in self.collections:
            self.collections[name] = _FakeCollection()
        return self.collections[name]


# ── persist_chat_topic ───────────────────────────────────────────────────────


async def test_persist_returns_false_without_user_wallet():
    assert await persist_chat_topic(
        agent_id="a", user_wallet="", niche="Trading/Investment",
        user_message="hi", agent_reply="hello",
    ) is False


async def test_persist_returns_false_without_agent_id():
    assert await persist_chat_topic(
        agent_id="", user_wallet="0xabc", niche="Trading/Investment",
        user_message="hi", agent_reply="hello",
    ) is False


async def test_persist_returns_false_for_empty_message():
    assert await persist_chat_topic(
        agent_id="a", user_wallet="0xabc", niche="Trading/Investment",
        user_message="   ", agent_reply="hello",
    ) is False


async def test_persist_writes_doc_with_envelope(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(wisdom_cache, "get_db", lambda: db)

    ok = await persist_chat_topic(
        agent_id="agent-1",
        user_wallet="0xABCDEF",
        niche="Trading/Investment",
        user_message="What's BTC funding rate?",
        agent_reply="Top pairs show funding around 0.01%...",
        intent="data_fetch",
        tool_source="coinmarketcap:derivatives",
    )
    assert ok is True
    topics = db.collection(CHAT_TOPICS_COLLECTION)._docs
    assert len(topics) == 1
    doc = list(topics.values())[0]
    assert doc["agent_id"] == "agent-1"
    assert doc["user_wallet"] == "0xabcdef"  # lowercased for consistent query
    assert doc["niche"] == "Trading/Investment"
    assert doc["user_message"] == "What's BTC funding rate?"
    assert doc["intent"] == "data_fetch"
    assert doc["tool_source"] == "coinmarketcap:derivatives"


async def test_persist_swallows_db_failures(monkeypatch):
    def boom():
        raise RuntimeError("firestore down")

    monkeypatch.setattr(wisdom_cache, "get_db", boom)

    ok = await persist_chat_topic(
        agent_id="a", user_wallet="0xabc", niche="Trading/Investment",
        user_message="hi", agent_reply="hello",
    )
    assert ok is False


async def test_persist_truncates_long_reply(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(wisdom_cache, "get_db", lambda: db)

    long_reply = "x" * 5000
    await persist_chat_topic(
        agent_id="a", user_wallet="0xabc", niche="Trading/Investment",
        user_message="hi", agent_reply=long_reply, max_reply_chars=500,
    )
    doc = list(db.collection(CHAT_TOPICS_COLLECTION)._docs.values())[0]
    assert len(doc["agent_reply"]) == 500


# ── recall_chat_topics ───────────────────────────────────────────────────────


async def test_recall_returns_empty_without_inputs(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(wisdom_cache, "get_db", lambda: db)
    assert await recall_chat_topics(agent_id="", user_wallet="0xabc") == []
    assert await recall_chat_topics(agent_id="a", user_wallet="") == []


async def test_recall_returns_recent_topics_in_descending_order(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(wisdom_cache, "get_db", lambda: db)

    # Seed 3 topics at different timestamps
    now = time.time()
    await persist_chat_topic(agent_id="a", user_wallet="0xabc", niche="Trading/Investment", user_message="oldest", agent_reply="r1")
    await persist_chat_topic(agent_id="a", user_wallet="0xabc", niche="Trading/Investment", user_message="middle", agent_reply="r2")
    await persist_chat_topic(agent_id="a", user_wallet="0xabc", niche="Trading/Investment", user_message="newest", agent_reply="r3")

    topics = await recall_chat_topics(agent_id="a", user_wallet="0xabc", limit=4)
    assert len(topics) == 3
    # Most recent first
    assert topics[0]["user_message"] == "newest"
    assert topics[2]["user_message"] == "oldest"


async def test_recall_is_scoped_to_owner(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(wisdom_cache, "get_db", lambda: db)

    await persist_chat_topic(agent_id="a", user_wallet="0xalice", niche="Trading/Investment", user_message="alice", agent_reply="a1")
    await persist_chat_topic(agent_id="a", user_wallet="0xbob", niche="Trading/Investment", user_message="bob", agent_reply="b1")

    alice_topics = await recall_chat_topics(agent_id="a", user_wallet="0xALICE", limit=4)
    bob_topics = await recall_chat_topics(agent_id="a", user_wallet="0xbob", limit=4)

    assert len(alice_topics) == 1
    assert alice_topics[0]["user_message"] == "alice"
    assert len(bob_topics) == 1
    assert bob_topics[0]["user_message"] == "bob"


async def test_recall_caps_at_50(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(wisdom_cache, "get_db", lambda: db)

    # Try to recall more than 50 — limit must clamp to 50
    topics = await recall_chat_topics(agent_id="a", user_wallet="0xabc", limit=999)
    assert topics == []  # no data, but the call didn't crash


async def test_recall_swallows_db_failures(monkeypatch):
    def boom():
        raise RuntimeError("firestore down")

    monkeypatch.setattr(wisdom_cache, "get_db", boom)
    topics = await recall_chat_topics(agent_id="a", user_wallet="0xabc", limit=4)
    assert topics == []

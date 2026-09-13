"""Regression tests for scout mint caps and LOW_GAS auto-disable."""

import time
from typing import Any

import pytest
from fastapi import HTTPException

from routers import agents as agents_module
from routers.agents import (
    AGENTS_COLLECTION,
    EVENTS_COLLECTION,
    SCOUT_LOGS_COLLECTION,
    _maybe_auto_disable_on_low_gas,
)

pytestmark = pytest.mark.asyncio


# ── Helpers ──────────────────────────────────────────────────────────────────


class _FakeDoc:
    def __init__(self, data: dict | None = None, exists: bool = True):
        self._data = data or {}
        self.exists = exists

    def to_dict(self) -> dict:
        return dict(self._data)


class _FakeDocRef:
    """Stub of the agent document — update() applies the patch in-place."""

    def __init__(self, parent: "_FakeCollection", doc_id: str):
        self.parent = parent
        self.doc_id = doc_id
        self._data = parent._docs.get(doc_id, {})

    async def get(self) -> _FakeDoc:
        return _FakeDoc(self._data, exists=self.doc_id in self.parent._docs)

    async def update(self, patch: dict) -> None:
        self._data.update(patch)
        self.parent._docs[self.doc_id] = self._data


class _FakeCollection:
    def __init__(self):
        self._docs: dict[str, dict] = {}

    def document(self, doc_id: str) -> _FakeDocRef:
        return _FakeDocRef(self, doc_id)

    def where(self, filter) -> "_FakeQuery":
        return _FakeQuery(self, filter.field_path, filter.op_string, filter.value)

    async def add(self, data: dict) -> tuple[_FakeDocRef, str]:
        import uuid
        doc_id = str(uuid.uuid4())
        ref = _FakeDocRef(self, doc_id)
        ref._data = data
        self._docs[doc_id] = data
        return ref, doc_id


class _FakeQuery:
    def __init__(self, parent: _FakeCollection, field: str, op: str, value: Any):
        self.parent = parent
        self.field = field
        self.op = op
        self.value = value
        self._filters: list[dict] = [{"field": field, "op": op, "value": value}]
        self._order_field: str | None = None
        self._order_dir: str = "ASCENDING"
        self._limit: int | None = None

    def where(self, filter) -> "_FakeQuery":
        new = _FakeQuery(self.parent, filter.field_path, filter.op_string, filter.value)
        new._filters = list(self._filters) + [{"field": filter.field_path, "op": filter.op_string, "value": filter.value}]
        new._order_field = self._order_field
        new._order_dir = self._order_dir
        new._limit = self._limit
        return new

    def order_by(self, field: str, direction: str = "ASCENDING") -> "_FakeQuery":
        self._order_field = field
        self._order_dir = direction
        return self

    def limit(self, n: int) -> "_FakeQuery":
        self._limit = n
        return self

    async def stream(self):
        results = []
        for doc_id, data in self.parent._docs.items():
            ok = True
            for f in self._filters:
                val = data.get(f["field"])
                if f["op"] == "==":
                    if val != f["value"]:
                        ok = False
                        break
                elif f["op"] == ">=":
                    if val is None or val < f["value"]:
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
        for doc_id, data in results:
            yield _FakeDoc(data, exists=True)


class _FakeFirestore:
    """Just enough to satisfy _maybe_auto_disable_on_low_gas — only one collection needed."""

    def __init__(self):
        self._collections: dict[str, _FakeCollection] = {}

    def collection(self, name: str) -> _FakeCollection:
        if name not in self._collections:
            self._collections[name] = _FakeCollection()
        return self._collections[name]


def _make_doc_ref(db: _FakeFirestore, collection: str, doc_id: str, data: dict):
    col = db.collection(collection)
    col._docs[doc_id] = dict(data)
    return _FakeDocRef(col, doc_id)


# ── Tests ────────────────────────────────────────────────────────────────────


async def test_auto_disable_flips_after_three_consecutive_low_gas_logs():
    db = _FakeFirestore()
    agent_id = "agent-low-gas"
    doc_ref = _make_doc_ref(
        db,
        AGENTS_COLLECTION,
        agent_id,
        {"auto_scout_enabled": True},
    )
    now = time.time()

    # Seed three LOW_GAS scout logs (most recent first when read desc)
    for i in range(3):
        log_id = f"log-{i}"
        db.collection(SCOUT_LOGS_COLLECTION)._docs[log_id] = {
            "agent_id": agent_id,
            "run_at": now - i * 60,
            "reason_code": "LOW_GAS",
            "action": "SKIPPED",
        }

    await _maybe_auto_disable_on_low_gas(db, doc_ref, agent_id, now)

    updated = db.collection(AGENTS_COLLECTION)._docs[agent_id]
    assert updated["auto_scout_enabled"] is False
    assert "Auto-disabled after 3 consecutive LOW_GAS" in updated["auto_scout_disabled_reason"]
    assert updated["auto_scout_disabled_at"] == now


async def test_auto_disable_does_nothing_if_less_than_three_low_gas_runs():
    db = _FakeFirestore()
    agent_id = "agent-partial"
    doc_ref = _make_doc_ref(
        db,
        AGENTS_COLLECTION,
        agent_id,
        {"auto_scout_enabled": True},
    )
    now = time.time()
    db.collection(SCOUT_LOGS_COLLECTION)._docs["log-1"] = {
        "agent_id": agent_id, "run_at": now, "reason_code": "LOW_GAS", "action": "SKIPPED",
    }
    db.collection(SCOUT_LOGS_COLLECTION)._docs["log-2"] = {
        "agent_id": agent_id, "run_at": now - 60, "reason_code": "LOW_SCORE", "action": "SKIPPED",
    }

    await _maybe_auto_disable_on_low_gas(db, doc_ref, agent_id, now)

    assert db.collection(AGENTS_COLLECTION)._docs[agent_id]["auto_scout_enabled"] is True


async def test_auto_disable_idempotent_when_already_disabled():
    db = _FakeFirestore()
    agent_id = "agent-already-off"
    doc_ref = _make_doc_ref(
        db,
        AGENTS_COLLECTION,
        agent_id,
        {"auto_scout_enabled": False},
    )
    now = time.time()
    for i in range(3):
        db.collection(SCOUT_LOGS_COLLECTION)._docs[f"log-{i}"] = {
            "agent_id": agent_id, "run_at": now - i * 60, "reason_code": "LOW_GAS", "action": "SKIPPED",
        }

    await _maybe_auto_disable_on_low_gas(db, doc_ref, agent_id, now)

    # disabled_reason must NOT be set — we don't want to overwrite a manual disable
    assert "auto_scout_disabled_reason" not in db.collection(AGENTS_COLLECTION)._docs[agent_id]


async def test_auto_disable_swallows_db_errors():
    """The helper is best-effort: it must never raise, even if Firestore is down."""

    class _BoomCollection:
        def document(self, _id):  # noqa: ARG002
            raise RuntimeError("firestore down")

    class _BoomDB:
        def collection(self, _name):  # noqa: ARG002
            return _BoomCollection()

    db = _BoomDB()
    doc_ref = _FakeDocRef(_FakeCollection(), "agent-x")
    # Must not raise
    await _maybe_auto_disable_on_low_gas(db, doc_ref, "agent-x", time.time())

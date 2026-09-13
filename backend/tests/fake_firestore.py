"""
Minimal in-memory stand-in for google.cloud.firestore.AsyncClient.

This is NOT a mock (no assert_called_with on it) — it's a small real
implementation of the exact subset of the Firestore async API that
routers/agents.py calls (collection().document().get/set/update, batch(),
where().stream()). Tests run the real breed_agents() code path against it,
so a guardrail test failure means the actual endpoint logic is broken —
not that a mock's expectations drifted from the mock.
"""

from __future__ import annotations

import copy


class FakeDocSnapshot:
    def __init__(self, doc_id: str, data: dict | None, reference=None):
        self.id = doc_id
        self._data = data
        self.reference = reference
        self.exists = data is not None

    def to_dict(self) -> dict | None:
        return copy.deepcopy(self._data) if self._data is not None else None


class FakeDocRef:
    def __init__(self, collection: "FakeCollection", doc_id: str):
        self._collection = collection
        self._doc_id = doc_id

    async def get(self) -> FakeDocSnapshot:
        return FakeDocSnapshot(
            self._doc_id,
            self._collection._docs.get(self._doc_id),
            reference=self,
        )

    async def set(self, data: dict) -> None:
        self._collection._docs[self._doc_id] = copy.deepcopy(data)

    async def update(self, data: dict) -> None:
        existing = self._collection._docs.setdefault(self._doc_id, {})
        existing.update(copy.deepcopy(data))


class FakeQuery:
    def __init__(self, collection: "FakeCollection", field_path: str, op_string: str, value):
        self._collection = collection
        self._field_path = field_path
        self._op_string = op_string
        self._value = value

    async def stream(self):
        for doc_id, data in list(self._collection._docs.items()):
            if data is None:
                continue
            matched = self._op_string == "==" and data.get(self._field_path) == self._value
            if matched:
                yield FakeDocSnapshot(doc_id, data)


class FakeCollection:
    def __init__(self):
        self._docs: dict[str, dict] = {}

    def document(self, doc_id: str) -> FakeDocRef:
        return FakeDocRef(self, doc_id)

    def where(self, filter) -> FakeQuery:  # noqa: A002 — mirrors real Firestore kwarg name
        return FakeQuery(self, filter.field_path, filter.op_string, filter.value)

    async def add(self, data: dict) -> tuple[FakeDocRef, str]:
        """Generate a new doc ID and set data on it. Returns (ref, doc_id)."""
        import uuid
        doc_id = str(uuid.uuid4())
        ref = FakeDocRef(self, doc_id)
        await ref.set(data)
        return ref, doc_id

    def __len__(self) -> int:
        return len(self._docs)


class FakeBatch:
    def __init__(self):
        self._ops: list[tuple[str, FakeDocRef, dict]] = []

    def set(self, ref: FakeDocRef, data: dict) -> None:
        self._ops.append(("set", ref, data))

    def update(self, ref: FakeDocRef, data: dict) -> None:
        self._ops.append(("update", ref, data))

    async def commit(self) -> None:
        for op, ref, data in self._ops:
            if op == "set":
                await ref.set(data)
            else:
                await ref.update(data)
        self._ops.clear()


class FakeFirestoreClient:
    """Drop-in fake for google.cloud.firestore.AsyncClient (subset used by agents.py)."""

    def __init__(self):
        self._collections: dict[str, FakeCollection] = {}

    def collection(self, name: str) -> FakeCollection:
        return self._collections.setdefault(name, FakeCollection())

    def batch(self) -> FakeBatch:
        return FakeBatch()

    def seed(self, collection: str, doc_id: str, data: dict) -> None:
        """Test helper — pre-populate a document without going through the API."""
        self.collection(collection)._docs[doc_id] = copy.deepcopy(data)

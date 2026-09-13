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
        self._filters: list[tuple[str, str, object]] = [(field_path, op_string, value)]
        self._order_field: str | None = None
        self._order_dir: str = "ASCENDING"
        self._limit_n: int | None = None

    def where(self, *args, **kwargs) -> "FakeQuery":
        if args and hasattr(args[0], "field_path"):
            f = args[0]
            new = FakeQuery(self._collection, f.field_path, f.op_string, f.value)
        elif len(args) >= 3:
            new = FakeQuery(self._collection, args[0], args[1], args[2])
        else:
            field = args[0] if args else kwargs.get("field_path") or kwargs.get("field")
            op = kwargs.get("op_string") or kwargs.get("op", "==")
            value = kwargs.get("value")
            new = FakeQuery(self._collection, field, op, value)
        new._filters = self._filters + new._filters
        new._order_field = self._order_field
        new._order_dir = self._order_dir
        new._limit_n = self._limit_n
        return new

    def order_by(self, field_path: str, direction: str = "ASCENDING") -> "FakeQuery":
        self._order_field = field_path
        self._order_dir = direction
        return self

    def limit(self, n: int) -> "FakeQuery":
        self._limit_n = n
        return self

    def _matches(self, data: dict) -> bool:
        for fp, op, val in self._filters:
            dv = data.get(fp)
            if op == "==":
                if dv != val:
                    return False
            elif op == ">=":
                if dv is None or not (dv >= val):
                    return False
            elif op == "<=":
                if dv is None or not (dv <= val):
                    return False
            elif op == "in":
                if not isinstance(val, (list, tuple)) or dv not in val:
                    return False
        return True

    async def stream(self):
        results: list[tuple[str, dict]] = []
        for doc_id, data in list(self._collection._docs.items()):
            if data is None:
                continue
            if self._matches(data):
                results.append((doc_id, data))
        if self._order_field:
            field = self._order_field
            reverse = self._order_dir == "DESCENDING"
            results.sort(key=lambda kv: kv[1].get(field) or 0, reverse=reverse)
        if self._limit_n is not None:
            results = results[: self._limit_n]
        for doc_id, data in results:
            yield FakeDocSnapshot(doc_id, data)

    async def get(self):
        out: list[FakeDocSnapshot] = []
        async for snap in self.stream():
            out.append(snap)
        return out


class FakeCollection:
    def __init__(self):
        self._docs: dict[str, dict] = {}

    def document(self, doc_id: str) -> FakeDocRef:
        return FakeDocRef(self, doc_id)

    def where(self, *args, **kwargs) -> FakeQuery:
        # Support Firestore's various where() invocations:
        #   where(FieldFilter("field", "==", value))   - positional
        #   where(filter=FieldFilter(...))             - keyword
        #   where("field", "==", value)                - all positional
        #   where("field", op="==", value=...)         - mixed keyword
        filter_obj = kwargs.pop("filter", None)
        if filter_obj is not None and hasattr(filter_obj, "field_path"):
            return FakeQuery(self, filter_obj.field_path, filter_obj.op_string, filter_obj.value)
        if args and hasattr(args[0], "field_path"):
            return FakeQuery(self, args[0].field_path, args[0].op_string, args[0].value)
        if len(args) >= 3:
            return FakeQuery(self, args[0], args[1], args[2])
        # Fallback for keyword-only style
        field = args[0] if args else kwargs.get("field_path") or kwargs.get("field")
        op = kwargs.get("op_string") or kwargs.get("op", "==")
        value = kwargs.get("value")
        return FakeQuery(self, field, op, value)

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

"""Which ASAJU contract an agent lives on.

Agents created before V7 carry no `contract_version`; they are V4 on Mantle
(5003) and V6 elsewhere. V7 agents (spawned or migrated) store 7 explicitly.
"""
from __future__ import annotations

V4 = 4
V6 = 6
V7 = 7


def contract_version_of(data: dict) -> int:
    version = data.get("contract_version")
    if version in (4, 5, 6, 7):
        return int(version)
    return V4 if int(data.get("chain_id") or 5003) == 5003 else V6


def is_v7(data: dict) -> bool:
    return contract_version_of(data) == V7

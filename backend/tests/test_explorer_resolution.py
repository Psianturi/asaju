"""Explorer URL resolution per chain.

Renaming Settings.mantle_explorer_url to a generic explorer_url left
routers/events.py still reading the old name. Nothing caught it: the
expression short-circuits on `chain_id == 5003`, so only Mantle — where
every live agent runs — hit the AttributeError, and no test covered it.
Every supported chain is asserted here so the next rename fails loudly.
"""

import pytest

from core.config import CHAIN_CONFIGS
from routers.events import _resolve_explorer_base


@pytest.mark.parametrize("chain_id", sorted(CHAIN_CONFIGS))
def test_every_supported_chain_resolves_an_explorer(chain_id):
    base = _resolve_explorer_base(chain_id)
    assert base.startswith("https://"), f"chain {chain_id} gave {base!r}"
    assert not base.endswith("/")


def test_each_chain_gets_its_own_explorer():
    """A shared explorer would link Mantle txs to BscScan and vice versa."""
    resolved = {c: _resolve_explorer_base(c) for c in CHAIN_CONFIGS}
    assert len(set(resolved.values())) == len(resolved), resolved


def test_mantle_explorer_env_override_is_honoured():
    from core.config import settings

    original = settings.mantle_explorer_url
    settings.mantle_explorer_url = "https://custom.mantle.example/"
    try:
        assert _resolve_explorer_base(5003) == "https://custom.mantle.example"
    finally:
        settings.mantle_explorer_url = original


def test_unknown_chain_falls_back_instead_of_crashing():
    assert _resolve_explorer_base(999999).startswith("https://")

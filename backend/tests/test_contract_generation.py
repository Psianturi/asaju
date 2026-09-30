"""V4 vs V5 vs V6 generation handling in web3_service.

V5 moved who pays for an offspring's activation: breedAgents() prepays the
spawn fee into escrow, so spawnBredAgent() became non-payable. That makes the
value we attach generation-specific in a way that fails hard either way —
sending value to V5 reverts, omitting it on V4 reverts — and neither shows up
until a real breed happens on a real chain. Hence these tests.

V6 removed MINTER_ROLE entirely: spawnBredAgent/mintAttendanceNFT/
recordExecutedProposal all revert if MINTER_SERVICE tries to sign them, and
would burn its real gas doing so. The _sync_* methods must detect V6 and
raise in Python *before* touching MINTER_SERVICE's key at all — these tests
assert that guard fires, and that the minter key is never even fetched.
"""

from unittest.mock import MagicMock, patch

import pytest

from services.web3_service import MAEF_ABI, ZERO_ADDRESS, Web3Service


def _contract(*, is_v5: bool, is_v6: bool = False, spawn_fee_wei: int = 10**18) -> MagicMock:
    """Fake contract whose agentOwner()/minAgentBalanceForExecution() presence
    marks the generation. V6 has both agentOwner (still V5-shaped) and
    minAgentBalanceForExecution (V6-only) — the real deployed contracts work
    the same way, since V6 kept the ownership registry from V5."""
    contract = MagicMock()
    if is_v5 or is_v6:
        contract.functions.agentOwner.return_value.call.return_value = ZERO_ADDRESS
    else:
        contract.functions.agentOwner.side_effect = Exception("no such function")
    if is_v6:
        contract.functions.minAgentBalanceForExecution.return_value.call.return_value = 0
    else:
        contract.functions.minAgentBalanceForExecution.side_effect = Exception("no such function")
    contract.functions.spawnFee.return_value.call.return_value = spawn_fee_wei
    return contract


def test_detects_v5_by_agent_owner_getter():
    svc = Web3Service()
    assert svc._is_v5(_contract(is_v5=True), chain_id=97) is True


def test_detects_v4_when_agent_owner_missing():
    svc = Web3Service()
    assert svc._is_v5(_contract(is_v5=False), chain_id=5003) is False


def test_generation_is_cached_per_chain():
    """A deployed address never changes generation, so probe it once."""
    svc = Web3Service()
    contract = _contract(is_v5=True)
    svc._is_v5(contract, chain_id=97)
    svc._is_v5(contract, chain_id=97)
    assert contract.functions.agentOwner.call_count == 1


def test_generations_are_tracked_separately():
    """Mantle stays V4 while the newer chains are V5 — one must not poison the other."""
    svc = Web3Service()
    assert svc._is_v5(_contract(is_v5=False), chain_id=5003) is False
    assert svc._is_v5(_contract(is_v5=True), chain_id=97) is True
    assert svc._is_v5(_contract(is_v5=False), chain_id=5003) is False


def test_v5_spawn_bred_agent_sends_no_value():
    """The breeder already paid; attaching value to a non-payable fn reverts."""
    svc = Web3Service()
    contract = _contract(is_v5=True, spawn_fee_wei=10**18)
    value = 0 if svc._is_v5(contract, chain_id=97) else svc._read_spawn_fee_wei(contract)
    assert value == 0


def test_v4_spawn_bred_agent_still_pays_the_spawn_fee():
    """Live Mantle is V4 and has no escrow — omitting value would revert."""
    svc = Web3Service()
    contract = _contract(is_v5=False, spawn_fee_wei=10**18)
    value = 0 if svc._is_v5(contract, chain_id=5003) else svc._read_spawn_fee_wei(contract)
    assert value == 10**18


def test_abi_exposes_the_v5_ownership_surface():
    names = {item.get("name") for item in MAEF_ABI}
    assert {"agentOwner", "transferAgentOwnership", "AgentOwnershipTransferred"} <= names


# ── V6: no MINTER_ROLE anywhere ─────────────────────────────────────────────


def test_detects_v6_by_min_agent_balance_getter():
    svc = Web3Service()
    assert svc._is_v6(_contract(is_v5=True, is_v6=True), chain_id=97) is True


def test_v5_is_not_mistaken_for_v6():
    svc = Web3Service()
    assert svc._is_v6(_contract(is_v5=True, is_v6=False), chain_id=97) is False


def test_v6_generation_is_cached_per_chain():
    svc = Web3Service()
    contract = _contract(is_v5=True, is_v6=True)
    svc._is_v6(contract, chain_id=97)
    svc._is_v6(contract, chain_id=97)
    assert contract.functions.minAgentBalanceForExecution.call_count == 1


def test_abi_exposes_the_v6_gas_floor_getter():
    names = {item.get("name") for item in MAEF_ABI}
    assert "minAgentBalanceForExecution" in names


def _patched_service(contract):
    """A Web3Service whose network calls are stubbed to a fake V6 contract,
    so _sync_* methods reach their generation check without a real RPC."""
    svc = Web3Service()
    svc._init_w3 = MagicMock(return_value=MagicMock())
    svc._init_contract = MagicMock(return_value=contract)
    return svc


def test_spawn_bred_agent_refuses_v6_before_touching_the_minter_key():
    svc = _patched_service(_contract(is_v5=True, is_v6=True))
    with patch("services.web3_service.get_minter_service_private_key") as get_key:
        with pytest.raises(PermissionError, match="breeder's own wallet"):
            svc._sync_spawn_bred_agent("0x" + "1" * 40, "aa" * 32, chain_id=97)
        get_key.assert_not_called()


def test_spawn_bred_agent_still_uses_minter_on_v5():
    """V5 keeps working exactly as before — only V6 changes behaviour."""
    svc = _patched_service(_contract(is_v5=True, is_v6=False))
    with patch("services.web3_service.get_minter_service_private_key") as get_key:
        get_key.return_value = "0x" + "11" * 32
        try:
            svc._sync_spawn_bred_agent("0x" + "1" * 40, "aa" * 32, chain_id=5003)
        except Exception:
            pass  # the fake w3/contract can't complete a real tx — that's fine
        get_key.assert_called()


def test_mint_refuses_v6_mode_a_before_touching_the_minter_key():
    svc = _patched_service(_contract(is_v5=True, is_v6=True))
    with patch("services.web3_service.get_minter_service_private_key") as get_key:
        with pytest.raises(PermissionError, match="no minter fallback"):
            svc._sync_mint(
                agent_wallet="0x" + "2" * 40,
                event_title="t", event_url="u", platform="yt",
                agent_name="a", summary="s", niche="n",
                agent_private_key=None,
                chain_id=97,
            )
        get_key.assert_not_called()


def test_record_executed_proposal_refuses_v6_mode_a_before_touching_the_minter_key():
    svc = _patched_service(_contract(is_v5=True, is_v6=True))
    with patch("services.web3_service.get_minter_service_private_key") as get_key:
        with pytest.raises(PermissionError, match="no minter fallback"):
            svc._sync_record_executed_proposal(
                "0x" + "3" * 40, "0x" + "aa" * 32, chain_id=97, agent_private_key=None,
            )
        get_key.assert_not_called()

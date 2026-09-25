"""V4 vs V5 generation handling in web3_service.

V5 moved who pays for an offspring's activation: breedAgents() prepays the
spawn fee into escrow, so spawnBredAgent() became non-payable. That makes the
value we attach generation-specific in a way that fails hard either way —
sending value to V5 reverts, omitting it on V4 reverts — and neither shows up
until a real breed happens on a real chain. Hence these tests.
"""

from unittest.mock import MagicMock

from services.web3_service import MAEF_ABI, ZERO_ADDRESS, Web3Service


def _contract(*, is_v5: bool, spawn_fee_wei: int = 10**18) -> MagicMock:
    """Fake contract whose agentOwner() presence marks the generation."""
    contract = MagicMock()
    if is_v5:
        contract.functions.agentOwner.return_value.call.return_value = ZERO_ADDRESS
    else:
        contract.functions.agentOwner.side_effect = Exception("no such function")
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

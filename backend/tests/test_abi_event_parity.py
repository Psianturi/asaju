"""Guards against the hand-maintained MAEF_ABI drifting from the deployed
contract's real event signatures.

ProposalExecuted was missing a `timestamp` field the Solidity source
always had — the Python ABI's computed event topic0 never matched the
real on-chain log, so contract.events.ProposalExecuted().process_receipt()
silently returned zero logs on every single approve, forever (heritage
score showed "—" in the UI instead of the real number, even though the
on-chain transfer/state-update itself always succeeded).

Expected topic0 hashes below were computed directly from
contracts/artifacts/contracts/MAEFNFTV4.sol/MAEFDynamicNFTV4.json (the
real compiled ABI) on 2026-09-19 — see verify_event_signatures() to
regenerate them if the contract is ever redeployed with a changed event.
This file intentionally does NOT read the artifact at test time: it's
gitignored build output, not present in a fresh clone or CI.
"""

import pytest
from web3 import Web3

from services.web3_service import MAEF_ABI

# keccak256("EventName(type1,type2,...)") for every event MAEF_ABI declares,
# verified against the compiled artifact — see module docstring.
EXPECTED_TOPIC0 = {
    "NFTMinted": "0x" + Web3.keccak(text="NFTMinted(uint256,address,string,string,uint256,uint256)").hex(),
    "WisdomUnlocked": "0x" + Web3.keccak(text="WisdomUnlocked(address,uint256)").hex(),
    "AgentsBred": "0x" + Web3.keccak(
        text="AgentsBred(address,bytes32,address,address,uint256,uint256,uint256)"
    ).hex(),
    "ProposalExecuted": "0x" + Web3.keccak(
        text="ProposalExecuted(address,bytes32,uint256,uint256,uint256)"
    ).hex(),
}


def _events_in_abi() -> dict[str, list[dict]]:
    return {item["name"]: item["inputs"] for item in MAEF_ABI if item.get("type") == "event"}


@pytest.mark.parametrize("event_name", sorted(EXPECTED_TOPIC0))
def test_event_topic0_matches_deployed_contract(event_name):
    events = _events_in_abi()
    assert event_name in events, f"{event_name} missing from MAEF_ABI entirely"

    inputs = events[event_name]
    signature = event_name + "(" + ",".join(i["type"] for i in inputs) + ")"
    computed_topic0 = "0x" + Web3.keccak(text=signature).hex()

    assert computed_topic0 == EXPECTED_TOPIC0[event_name], (
        f"{event_name}: MAEF_ABI computes topic0 {computed_topic0} from '{signature}', "
        f"but the deployed contract's real topic0 is {EXPECTED_TOPIC0[event_name]}. "
        "contract.events.{}().process_receipt() will silently return zero logs "
        "for every real transaction until MAEF_ABI's inputs are corrected to match "
        "contracts/contracts/MAEFNFTV4.sol exactly.".format(event_name)
    )

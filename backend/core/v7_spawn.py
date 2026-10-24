"""EIP-712 SpawnConsent for AsajuAgentV7: the agent wallet agrees that its
Passport is minted to `owner`. Without it the contract refuses the spawn."""
from __future__ import annotations

from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

DOMAIN_NAME = "AsajuAgentV7"
DOMAIN_VERSION = "1"


def spawn_consent_payload(agent_wallet: str, owner: str, chain_id: int, verifying_contract: str) -> dict:
    return {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "SpawnConsent": [
                {"name": "agentWallet", "type": "address"},
                {"name": "owner", "type": "address"},
            ],
        },
        "primaryType": "SpawnConsent",
        "domain": {
            "name": DOMAIN_NAME,
            "version": DOMAIN_VERSION,
            "chainId": int(chain_id),
            "verifyingContract": Web3.to_checksum_address(verifying_contract),
        },
        "message": {
            "agentWallet": Web3.to_checksum_address(agent_wallet),
            "owner": Web3.to_checksum_address(owner),
        },
    }


def sign_spawn_consent(private_key: str, owner: str, chain_id: int, verifying_contract: str) -> str:
    account = Account.from_key(private_key)
    payload = spawn_consent_payload(account.address, owner, chain_id, verifying_contract)
    signed = Account.sign_message(encode_typed_data(full_message=payload), private_key)
    return Web3.to_hex(signed.signature)

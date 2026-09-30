"""
Web3 service: connects to Mantle Sepolia and mints NFTs via MAEFDynamicNFT.

The backend's AGENT_WALLET (stored in Secret Manager as AGENT_PRIVATE_KEY) holds
MINTER_ROLE on the contract.  The `agentWallet` parameter is the NFT *recipient*
address (user's MetaMask or the agent's derived address).
"""

import asyncio
import logging
from typing import Any

from eth_account import Account
from web3 import Web3
from web3.logs import DISCARD

from core.config import settings
from core.secrets import get_mantle_rpc_url, get_minter_service_private_key

logger = logging.getLogger(__name__)

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

# ── Minimal ABI (only what backend needs to call) ─────────────────────────────
MAEF_ABI: list[dict] = [
    {
        "inputs": [
            {"internalType": "address", "name": "agentWallet", "type": "address"},
            {"internalType": "string", "name": "eventTitle", "type": "string"},
            {"internalType": "string", "name": "eventUrl", "type": "string"},
            {"internalType": "string", "name": "platform", "type": "string"},
            {"internalType": "string", "name": "agentName", "type": "string"},
            {"internalType": "string", "name": "summary", "type": "string"},
            {"internalType": "string", "name": "niche", "type": "string"},
        ],
        "name": "mintAttendanceNFT",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "getTotalMinted",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "spawnFee",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "agentProvision",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    # Uppercase legacy getters — Mantle's live contract (0x66fD...) predates the
    # mutable-fee upgrade and only has these, not the lowercase pair above.
    # See Web3Service._read_spawn_fee_wei / _read_agent_provision_wei.
    {
        "inputs": [],
        "name": "SPAWN_FEE",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "AGENT_PROVISION",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "internalType": "uint256", "name": "tokenId", "type": "uint256"},
            {"indexed": True, "internalType": "address", "name": "agentWallet", "type": "address"},
            {"indexed": False, "internalType": "string", "name": "eventTitle", "type": "string"},
            {"indexed": False, "internalType": "string", "name": "agentName", "type": "string"},
            {"indexed": False, "internalType": "uint256", "name": "agentLevel", "type": "uint256"},
            {"indexed": False, "internalType": "uint256", "name": "timestamp", "type": "uint256"},
        ],
        "name": "NFTMinted",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "internalType": "address", "name": "agentWallet", "type": "address"},
            {"indexed": False, "internalType": "uint256", "name": "totalEvents", "type": "uint256"},
        ],
        "name": "WisdomUnlocked",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "internalType": "address", "name": "user", "type": "address"},
            {"indexed": True, "internalType": "bytes32", "name": "offspringKey", "type": "bytes32"},
            {"indexed": False, "internalType": "address", "name": "parent1Wallet", "type": "address"},
            {"indexed": False, "internalType": "address", "name": "parent2Wallet", "type": "address"},
            {"indexed": False, "internalType": "uint256", "name": "generation", "type": "uint256"},
            {"indexed": False, "internalType": "uint256", "name": "heritageScore", "type": "uint256"},
            {"indexed": False, "internalType": "uint256", "name": "cost", "type": "uint256"},
        ],
        "name": "AgentsBred",
        "type": "event",
    },
    {
        "inputs": [
            {"internalType": "address", "name": "parent1Wallet", "type": "address"},
            {"internalType": "address", "name": "parent2Wallet", "type": "address"},
            {"internalType": "bytes32", "name": "offspringId", "type": "bytes32"},
            {"internalType": "uint256", "name": "generation", "type": "uint256"},
            {"internalType": "uint256", "name": "heritageScore", "type": "uint256"},
        ],
        "name": "breedAgents",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "address", "name": "agentWallet", "type": "address"},
            {"internalType": "bytes32", "name": "offspringId", "type": "bytes32"},
        ],
        "name": "spawnBredAgent",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function",
    },
    # ── V5 only — agent ownership. Absent on V4 deployments (e.g. live Mantle),
    # which is exactly how _is_v5() tells the two generations apart.
    {
        "inputs": [{"internalType": "address", "name": "", "type": "address"}],
        "name": "agentOwner",
        "outputs": [{"internalType": "address", "name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function",
    },
    # V6 only — its presence is exactly how _is_v6() tells V5 and V6 apart.
    {
        "inputs": [],
        "name": "minAgentBalanceForExecution",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "address", "name": "agentWallet", "type": "address"},
            {"internalType": "address", "name": "newOwner", "type": "address"},
        ],
        "name": "transferAgentOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True,  "internalType": "address", "name": "agentWallet",   "type": "address"},
            {"indexed": True,  "internalType": "address", "name": "previousOwner", "type": "address"},
            {"indexed": True,  "internalType": "address", "name": "newOwner",      "type": "address"},
            {"indexed": False, "internalType": "uint256", "name": "timestamp",     "type": "uint256"},
        ],
        "name": "AgentOwnershipTransferred",
        "type": "event",
    },
    {
        "inputs": [
            {"internalType": "address", "name": "agentWallet", "type": "address"},
            {"internalType": "bytes32", "name": "proposalHash", "type": "bytes32"},
        ],
        "name": "recordExecutedProposal",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True,  "internalType": "address", "name": "agentWallet",           "type": "address"},
            {"indexed": True,  "internalType": "bytes32", "name": "proposalHash",           "type": "bytes32"},
            {"indexed": False, "internalType": "uint256", "name": "proposalsApprovedTotal", "type": "uint256"},
            {"indexed": False, "internalType": "uint256", "name": "heritageScoreAfter",     "type": "uint256"},
            {"indexed": False, "internalType": "uint256", "name": "timestamp",              "type": "uint256"},
        ],
        "name": "ProposalExecuted",
        "type": "event",
    },
]


class Web3Service:
    def __init__(self) -> None:
        # Per-chain caches — keyed by chain_id (e.g. 5003, 11155111)
        self._w3_cache: dict[int, Web3] = {}
        self._contract_cache: dict[int, Any] = {}
        self._is_v5_cache: dict[int, bool] = {}
        self._is_v6_cache: dict[int, bool] = {}

    # ── Connection helpers ────────────────────────────────────────────────────

    def _init_w3(self, chain_id: int = 5003) -> Web3:
        if chain_id in self._w3_cache and self._w3_cache[chain_id].is_connected():
            return self._w3_cache[chain_id]

        from core.config import get_chain_config
        # Mantle: allow Secret Manager override via get_mantle_rpc_url()
        # Other chains: use hardcoded RPC from CHAIN_CONFIGS
        if chain_id == 5003:
            rpc_url = get_mantle_rpc_url()
        else:
            rpc_url = get_chain_config(chain_id)["rpc_url"]

        w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 60}))
        if not w3.is_connected():
            logger.warning("Initial connection check failed for chain %d RPC: %s", chain_id, rpc_url)
            try:
                w3.eth.get_block("latest")
                logger.info("RPC connection verified via get_block for chain %d", chain_id)
            except Exception as retry_exc:
                raise ConnectionError(
                    f"Cannot connect to chain {chain_id} RPC: {rpc_url} | Error: {retry_exc}"
                ) from retry_exc

        self._w3_cache[chain_id] = w3
        return w3

    def _init_contract(self, chain_id: int = 5003) -> Any:
        if chain_id in self._contract_cache:
            return self._contract_cache[chain_id]

        from core.config import get_chain_config
        w3 = self._init_w3(chain_id)

        # Mantle: contract address from Cloud Run env var (CONTRACT_ADDRESS) for flexibility
        # Other chains: hardcoded address from CHAIN_CONFIGS
        if chain_id == 5003:
            addr = settings.contract_address
        else:
            addr = get_chain_config(chain_id)["contract_address"]

        if not addr or not Web3.is_address(addr):
            raise ValueError(
                f"No valid contract address for chain {chain_id}. "
                "Check CHAIN_CONFIGS or CONTRACT_ADDRESS env var."
            )

        self._contract_cache[chain_id] = w3.eth.contract(
            address=Web3.to_checksum_address(addr),
            abi=MAEF_ABI,
        )
        return self._contract_cache[chain_id]

    # ── Public async interface ────────────────────────────────────────────────

    async def mint_attendance_nft(
        self,
        agent_wallet: str,
        event_title: str,
        event_url: str,
        platform: str,
        agent_name: str,
        summary: str,
        niche: str = "General",
        agent_private_key: str | None = None,  # Agent's own key for autonomy
        allow_mode_b_fallback: bool = True,
        chain_id: int = 5003,
    ) -> dict[str, Any]:
        """
        Signs and broadcasts mintAttendanceNFT to the target chain.

        If agent_private_key is provided, the agent signs its own transaction
        (true agentic autonomy). Otherwise, falls back to backend master key.

        Runs the blocking web3 call in a thread executor so FastAPI stays non-blocking.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self._sync_mint,
            agent_wallet,
            event_title,
            event_url,
            platform,
            agent_name,
            summary,
            niche,
            agent_private_key,
            allow_mode_b_fallback,
            chain_id,
        )

    async def get_total_minted(self, chain_id: int = 5003) -> int:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._sync_total_minted, chain_id)

    async def get_event_logs(
        self,
        event_name: str,
        *,
        chain_id: int = 5003,
        from_block: int = 0,
        to_block: int | str = 'latest',
        argument_filters: dict | None = None,
    ) -> list[dict]:
        """Generic event-log reader. Wraps web3.eth.get_logs in an executor so
        FastAPI stays non-blocking. The caller is responsible for decoding the
        raw `data` field for non-indexed args if it needs them.

        `argument_filters` maps event argument names to values to filter on.
        Use only indexed args (`agentWallet`, `previousOwner`, `newOwner` for
        AgentOwnershipTransferred — all three are indexed in V5)."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._sync_get_event_logs(event_name, chain_id, from_block, to_block, argument_filters),
        )

    def _sync_get_event_logs(self, event_name, chain_id, from_block, to_block, argument_filters):
        w3 = self._init_w3(chain_id)
        contract = self._init_contract(chain_id)
        event = getattr(contract.events, event_name, None)
        if event is None:
            raise ValueError(f"Contract {type(contract).__name__} has no event named {event_name!r}")
        # Build filter — only indexed args are filterable on-chain.
        filter_kwargs: dict = {"fromBlock": from_block, "toBlock": to_block}
        if argument_filters:
            for arg_name, value in argument_filters.items():
                if not value:
                    continue
                if not hasattr(event.args, arg_name):
                    logger.warning(
                        "Event %s has no indexed arg %r — filtering on non-indexed args "
                        "is only possible with a per-topic event filter.",
                        event_name,
                        arg_name,
                    )
                    continue
                if not getattr(event.args, arg_name).indexed:
                    logger.warning(
                        "Event %s arg %r is not indexed — filter may not work.",
                        event_name,
                        arg_name,
                    )
                filter_kwargs[f"argument_{arg_name}"] = value
        logs = event.get_logs(**filter_kwargs)
        return [
            {
                "blockNumber": log.blockNumber,
                "transactionHash": log.transactionHash.hex(),
                "logIndex": log.logIndex,
                "args": dict(log.args),
                "event": event_name,
            }
            for log in logs
        ]

    async def get_native_balance(self, address: str, chain_id: int = 5003) -> float:
        """Return the wallet's native token balance from the target chain RPC in ether units."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._sync_native_balance, address, chain_id)

    async def get_balance(self, address: str, chain_id: int = 5003) -> int:
        """Return the wallet's native balance in wei (for gas monitoring endpoints)."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._sync_balance_wei, address, chain_id)

    async def get_agent_provision(self, chain_id: int = 5003) -> float:
        """
        Live-read agentProvision for a chain (in ether units) — the amount a
        freshly-spawned agent receives as its starting gas reserve. Used to size
        gas-health thresholds *relative* to what's normal for that chain, instead
        of hardcoding one absolute number that only makes sense for Mantle.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._sync_agent_provision, chain_id)

    def _sync_agent_provision(self, chain_id: int = 5003) -> float:
        contract = self._init_contract(chain_id)
        provision_wei = self._read_agent_provision_wei(contract)
        return float(Web3.from_wei(provision_wei, "ether"))

    def _read_spawn_fee_wei(self, contract) -> int:
        """
        Read spawnFee tolerating both contract generations. Mantle's original
        deployment (0x66fD...) predates the mutable-fee upgrade added 10 Aug
        2026 — it still has the immutable `SPAWN_FEE` constant (uppercase),
        not the new owner-mutable `spawnFee()` getter — and was never
        redeployed, since that would orphan every existing Mantle agent.
        This fallback is therefore permanent, not a transitional shim.
        """
        try:
            return contract.functions.spawnFee().call()
        except Exception:
            return contract.functions.SPAWN_FEE().call()

    def _read_agent_provision_wei(self, contract) -> int:
        """Same generational fallback as _read_spawn_fee_wei, for agentProvision."""
        try:
            return contract.functions.agentProvision().call()
        except Exception:
            return contract.functions.AGENT_PROVISION().call()

    def _is_v5(self, contract, chain_id: int) -> bool:
        """
        True when the deployed contract is V5 (has the agentOwner registry).
        V5 changed who pays: breedAgents() prepays the offspring's spawn fee into
        escrow, so spawnBredAgent() is non-payable — sending value to it on V5
        reverts, and omitting value on V4 reverts. Cached per chain; a deployed
        address never changes generation under us.
        """
        cached = self._is_v5_cache.get(chain_id)
        if cached is not None:
            return cached
        try:
            contract.functions.agentOwner(ZERO_ADDRESS).call()
            result = True
        except Exception:
            result = False
        self._is_v5_cache[chain_id] = result
        logger.info("Contract on chain %s detected as %s", chain_id, "V5" if result else "V4")
        return result

    def _is_v6(self, contract, chain_id: int) -> bool:
        """
        True when the deployed contract is V6 (has no MINTER_ROLE at all).
        V6 also has agentOwner, so _is_v5() is true for it too — check this
        one first when the two branches actually differ. Detected via
        minAgentBalanceForExecution(), a getter that only exists on V6.

        Where V6 changes behaviour vs V5:
          - spawnBredAgent has no MINTER_ROLE fallback — only record.breeder
            may call it, so the backend can never sign this tx itself anymore.
          - mintAttendanceNFT / recordExecutedProposal have no Mode A path —
            attempting one with MINTER_SERVICE's key reverts, wasting its gas
            on a doomed transaction instead of failing fast in Python.
        """
        cached = self._is_v6_cache.get(chain_id)
        if cached is not None:
            return cached
        try:
            contract.functions.minAgentBalanceForExecution().call()
            result = True
        except Exception:
            result = False
        self._is_v6_cache[chain_id] = result
        if result:
            logger.info("Contract on chain %s detected as V6 (no MINTER_ROLE)", chain_id)
        return result

    def is_v6_chain(self, chain_id: int) -> bool:
        """Public wrapper so routers can branch on contract generation without
        reaching into _init_contract/_is_v6 directly."""
        contract = self._init_contract(chain_id)
        return self._is_v6(contract, chain_id)

    def check_minter_balance_health(self, chain_id: int = 5003) -> None:
        """
        Log-only early warning — call right before MINTER_SERVICE is about to spend
        its own balance (spawnBredAgent, recordExecutedProposal). Does NOT block the
        transaction; this is deliberately just a loud, greppable Cloud Run log line
        for the operator, not a user-facing alert (MINTER_SERVICE isn't the user's
        concern) and not an automatic treasury sweep (would require the deployer's
        cold-admin key to become hot — see reference_contracts_wallets memory).

        Threshold is relative — 4x spawnFee for the chain — so it means the same
        thing ("~4 more operations left") on every chain, not one absolute MNT
        number that's meaningless once a chain's economy is calibrated differently.
        """
        try:
            w3 = self._init_w3(chain_id)
            contract = self._init_contract(chain_id)
            private_key = get_minter_service_private_key()
            minter_address = Account.from_key(private_key).address

            balance_wei = w3.eth.get_balance(minter_address)
            balance = float(Web3.from_wei(balance_wei, "ether"))
            spawn_fee_wei = self._read_spawn_fee_wei(contract)
            spawn_fee = float(Web3.from_wei(spawn_fee_wei, "ether"))
            threshold = spawn_fee * 4

            if balance < threshold:
                logger.warning(
                    "MINTER_SERVICE_LOW_BALANCE chain=%d address=%s balance=%.4f "
                    "threshold=%.4f spawn_fee=%.4f — top up before bred-agent "
                    "activations / proposal recordings start failing silently",
                    chain_id, minter_address, balance, threshold, spawn_fee,
                )
        except Exception as exc:
            # Never let a monitoring check break the actual transaction it's guarding.
            logger.warning("MINTER_SERVICE balance health check failed (non-fatal): %s", exc)

    def get_minter_balance_status(self, chain_id: int = 5003) -> dict:
        """Same threshold logic as check_minter_balance_health, but returns data
        instead of only logging — for the operator observability endpoint."""
        try:
            w3 = self._init_w3(chain_id)
            contract = self._init_contract(chain_id)
            private_key = get_minter_service_private_key()
            minter_address = Account.from_key(private_key).address

            balance_wei = w3.eth.get_balance(minter_address)
            balance = float(Web3.from_wei(balance_wei, "ether"))
            spawn_fee_wei = self._read_spawn_fee_wei(contract)
            spawn_fee = float(Web3.from_wei(spawn_fee_wei, "ether"))
            threshold = spawn_fee * 4

            return {
                "chain_id": chain_id,
                "address": minter_address,
                "balance": balance,
                "threshold": threshold,
                "healthy": balance >= threshold,
            }
        except Exception as exc:
            return {"chain_id": chain_id, "error": str(exc)[:200]}

    # ── Synchronous implementations (run in thread pool) ─────────────────────

    def _sync_mint(
        self,
        agent_wallet: str,
        event_title: str,
        event_url: str,
        platform: str,
        agent_name: str,
        summary: str,
        niche: str,
        agent_private_key: str | None = None,
        allow_mode_b_fallback: bool = True,
        chain_id: int = 5003,
    ) -> dict[str, Any]:
        w3 = self._init_w3(chain_id)
        contract = self._init_contract(chain_id)
        is_v6 = self._is_v6(contract, chain_id)

        using_agent_key = bool(agent_private_key)
        if using_agent_key:
            private_key = agent_private_key
            logger.info(
                "Agent signing its own transaction (autonomous mode, fallback=%s)",
                allow_mode_b_fallback,
            )
        else:
            if is_v6:
                # V6 has no MINTER_ROLE — this call would revert on-chain and
                # still burn MINTER_SERVICE's gas. Fail fast in Python instead.
                raise PermissionError(
                    "mintAttendanceNFT on a V6 contract requires the agent's own "
                    "key — there is no minter fallback anymore."
                )
            private_key = get_minter_service_private_key()
            self.check_minter_balance_health(chain_id)
            logger.info("Minter service wallet signing transaction (Mode A)")

        signer = Account.from_key(private_key)
        signer_address = signer.address

        recipient = Web3.to_checksum_address(agent_wallet)
        nonce = w3.eth.get_transaction_count(signer_address, "pending")
        gas_price = w3.eth.gas_price

        fn_call = contract.functions.mintAttendanceNFT(
            recipient, event_title, event_url, platform, agent_name, summary, niche
        )

        try:
            gas_estimate = fn_call.estimate_gas({"from": signer_address})
            gas_limit = int(gas_estimate * 1.2)
        except Exception as exc:
            exc_str = str(exc)
            exc_lower = exc_str.lower()
            actual_signing_mode = "B" if using_agent_key else "A"
            if using_agent_key:
                lacks_minter = any(
                    s in exc_str for s in ("0xe2517d3f", "AccessControl", "MINTER_ROLE")
                )
                insufficient_gas = "insufficient funds" in exc_lower

                if not allow_mode_b_fallback:
                    if lacks_minter:
                        raise PermissionError(
                            "Mode B rejected: agent wallet is not authorized to mint on this contract. "
                            "Ensure spawnAgent() was executed on the active V2 contract."
                        ) from exc
                    if insufficient_gas:
                        raise RuntimeError(
                            "Mode B rejected: agent wallet out of gas. Top up the agent wallet and retry."
                        ) from exc
                    raise RuntimeError(
                        f"Mode B rejected: autonomous gas estimation failed ({exc_str[:180]})"
                    ) from exc

                if lacks_minter or insufficient_gas:
                    if is_v6:
                        raise PermissionError(
                            "Mode B failed and this is a V6 contract — there is no "
                            "minter fallback to try. Top up the agent wallet and retry."
                        ) from exc
                    logger.warning(
                        "Mode B fallback triggered (%s). Falling back to minter service wallet.",
                        "missing role" if lacks_minter else "insufficient gas",
                    )
                    private_key = get_minter_service_private_key()
                    self.check_minter_balance_health(chain_id)
                    signer = Account.from_key(private_key)
                    signer_address = signer.address
                    nonce = w3.eth.get_transaction_count(signer_address, "pending")
                    actual_signing_mode = "A"
                    try:
                        gas_estimate = fn_call.estimate_gas({"from": signer_address})
                        gas_limit = int(gas_estimate * 1.2)
                    except Exception as exc2:
                        logger.warning("Gas estimation failed with service wallet, using 300 000: %s", exc2)
                        gas_limit = 300_000
                else:
                    logger.warning("Gas estimation failed in Mode B, using default 300 000: %s", exc)
                    gas_limit = 300_000
            else:
                logger.warning("Gas estimation failed, using default 300 000: %s", exc)
                gas_limit = 300_000
        else:
            actual_signing_mode = "B" if using_agent_key else "A"

        raw_tx = fn_call.build_transaction(
            {
                "chainId": chain_id,
                "from": signer_address,
                "nonce": nonce,
                "gas": gas_limit,
                "gasPrice": gas_price,
            }
        )

        signed = w3.eth.account.sign_transaction(raw_tx, private_key=private_key)
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)  # web3.py v6 uses camelCase
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

        # Extract tokenId from NFTMinted event log
        token_id: int | None = None
        level_up: bool = False
        try:
            mint_logs = contract.events.NFTMinted().process_receipt(receipt, errors=DISCARD)
            if mint_logs:
                token_id = int(mint_logs[0]["args"]["tokenId"])
        except Exception as exc:
            logger.warning("Could not parse NFTMinted event logs: %s", exc)

        return {
            "tx_hash": tx_hash.hex(),
            "token_id": str(token_id) if token_id is not None else None,
            "gas_used": str(receipt["gasUsed"]),
            "block_number": receipt["blockNumber"],
            "status": "success" if receipt["status"] == 1 else "failed",
            "level_up": level_up,
            "signing_mode": actual_signing_mode,
        }

    def _sync_total_minted(self, chain_id: int = 5003) -> int:
        contract = self._init_contract(chain_id)
        return int(contract.functions.getTotalMinted().call())

    def _sync_native_balance(self, address: str, chain_id: int = 5003) -> float:
        w3 = self._init_w3(chain_id)
        if not Web3.is_address(address):
            raise ValueError("Invalid Ethereum wallet address")

        try:
            wei_balance = w3.eth.get_balance(Web3.to_checksum_address(address))
        except Exception as exc:
            raise ConnectionError(f"Failed to fetch native balance from chain {chain_id} RPC: {exc}") from exc

        return float(Web3.from_wei(wei_balance, "ether"))

    def _sync_balance_wei(self, address: str, chain_id: int = 5003) -> int:
        """Return wallet's native balance in wei (int) for gas monitoring."""
        w3 = self._init_w3(chain_id)
        if not Web3.is_address(address):
            raise ValueError("Invalid Ethereum wallet address")

        try:
            wei_balance = w3.eth.get_balance(Web3.to_checksum_address(address))
        except Exception as exc:
            raise ConnectionError(f"Failed to fetch balance from chain {chain_id} RPC: {exc}") from exc

        return int(wei_balance)

    async def send_spawn_bred_agent_tx(
        self,
        offspring_wallet: str,
        offspring_id: str,
        chain_id: int = 5003,
    ) -> dict[str, Any]:
        """
        Register a bred offspring on V4 via spawnBredAgent() — signed by MINTER_SERVICE.

        Pays spawnFee (read live from the contract, not hardcoded — it's owner-mutable
        and differs per chain) from minter wallet, sets isAgentSpawned[offspringWallet]=true.
        offspring_id must be the 64-char hex bytes32 parsed from the AgentsBred event
        (breed_tx_data["offspring_key"]) — this is what the contract stored in breedRecords.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self._sync_spawn_bred_agent,
            offspring_wallet,
            offspring_id,
            chain_id,
        )

    def _sync_spawn_bred_agent(
        self, offspring_wallet: str, offspring_id: str, chain_id: int = 5003
    ) -> dict[str, Any]:
        w3 = self._init_w3(chain_id)
        contract = self._init_contract(chain_id)

        if self._is_v6(contract, chain_id):
            # V6's spawnBredAgent has no MINTER_ROLE fallback — only
            # record.breeder may call it, and MINTER_SERVICE is never that.
            # Submitting anyway would revert on-chain and still burn its gas,
            # so fail fast in Python instead. The caller (routers/agents.py)
            # must have the breeder's own wallet call this from the browser.
            raise PermissionError(
                "spawnBredAgent is V6-only callable by the breeder's own wallet — "
                "the backend has no key that can sign this. The frontend must call "
                "it directly after breedAgents() confirms."
            )

        self.check_minter_balance_health(chain_id)
        private_key = get_minter_service_private_key()
        signer = Account.from_key(private_key)

        offspring_wallet_cs = Web3.to_checksum_address(offspring_wallet)
        # offspring_id is the raw bytes32 from the AgentsBred event (64-char hex)
        # Strip 0x prefix defensively — web3.py .hex() returns without it, but be safe
        offspring_id_bytes = bytes.fromhex(offspring_id.replace("0x", ""))

        fn_call = contract.functions.spawnBredAgent(offspring_wallet_cs, offspring_id_bytes)
        # V5: the breeder already prepaid this into escrow, and the function is
        # non-payable — sending value would revert. V4: the caller still funds it.
        spawn_value = 0 if self._is_v5(contract, chain_id) else self._read_spawn_fee_wei(contract)

        nonce = w3.eth.get_transaction_count(signer.address, "pending")
        gas_price = w3.eth.gas_price

        try:
            gas_estimate = fn_call.estimate_gas({"from": signer.address, "value": spawn_value})
            gas_limit = int(gas_estimate * 1.2)
        except Exception as exc:
            logger.warning("spawnBredAgent gas estimation failed, using 250_000: %s", exc)
            gas_limit = 250_000

        raw_tx = fn_call.build_transaction(
            {
                "chainId": chain_id,
                "from": signer.address,
                "nonce": nonce,
                "gas": gas_limit,
                "gasPrice": gas_price,
                "value": spawn_value,
            }
        )

        signed = w3.eth.account.sign_transaction(raw_tx, private_key=private_key)
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

        status = "success" if receipt["status"] == 1 else "failed"
        logger.info(
            "spawnBredAgent(%s) → %s (tx: %s)",
            offspring_wallet[:10], status, tx_hash.hex(),
        )
        return {
            "tx_hash": tx_hash.hex(),
            "status": status,
            "block_number": receipt["blockNumber"],
            "gas_used": str(receipt["gasUsed"]),
        }

    async def send_record_executed_proposal_tx(
        self,
        agent_wallet: str,
        proposal_hash_hex: str,
        chain_id: int = 5003,
        agent_private_key: str | None = None,
    ) -> dict[str, Any]:
        """
        Call recordExecutedProposal(agentWallet, proposalHash) on V4/V5.

        Default signer: the AGENT wallet (Mode B). The agent signs and pays
        gas out of its own provisioned balance — no platform subsidy. This is
        the right model at mainnet because every user's proposal execution is
        paid by that user, not by ASAJU.

        Fallback signer: MINTER_SERVICE (Mode A). Only used when the agent
        wallet has insufficient gas — in which case we log + return a clear
        error so the user knows to top up the agent, not the platform.

        Pass `agent_private_key` to sign with the agent's own key (already
        KMS-decrypted by the caller). If None, fall back to MINTER_SERVICE.
        proposal_hash_hex: 0x-prefixed hex string from Web3.keccak(text=...).
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self._sync_record_executed_proposal,
            agent_wallet,
            proposal_hash_hex,
            chain_id,
            agent_private_key,
        )

    def _sync_record_executed_proposal(
        self, agent_wallet: str, proposal_hash_hex: str, chain_id: int = 5003,
        agent_private_key: str | None = None,
    ) -> dict[str, Any]:
        w3 = self._init_w3(chain_id)
        contract = self._init_contract(chain_id)

        agent_wallet_cs = Web3.to_checksum_address(agent_wallet)
        # Convert 0x hex string → raw bytes32 for the ABI encoder
        proposal_hash_bytes = bytes.fromhex(proposal_hash_hex.removeprefix("0x"))

        # Prefer agent-signed (Mode B). The agent's private key was already
        # KMS-decrypted by the caller; we just use it as the signer.
        if agent_private_key:
            signer = Account.from_key(agent_private_key)
            if Web3.to_checksum_address(signer.address) != agent_wallet_cs:
                raise ValueError(
                    f"agent_private_key address {signer.address} does not match "
                    f"agent_wallet {agent_wallet_cs}"
                )
            logger.info(
                "recordExecutedProposal Mode B: signing with agent wallet %s on chain %d",
                agent_wallet_cs, chain_id,
            )
        else:
            if self._is_v6(contract, chain_id):
                # V6's recordExecutedProposal accepts only agentOwner or the
                # agent itself — MINTER_SERVICE would revert. The proposals
                # router already blocks this case before calling in (see the
                # Mode A safety belt), but guard here too since this method
                # has its own callers.
                raise PermissionError(
                    "recordExecutedProposal on a V6 contract requires the owner's "
                    "or the agent's own key — there is no minter fallback."
                )
            # Fallback: MINTER_SERVICE (Mode A). Only reached when the caller
            # explicitly skipped agent-key decryption. We still check balance
            # for log visibility but don't gate the call on it.
            self.check_minter_balance_health(chain_id)
            logger.info(
                "recordExecutedProposal Mode A fallback (minter service): "
                "agent wallet %s has no gas; platform wallet signs chain %d",
                agent_wallet_cs, chain_id,
            )
            private_key = get_minter_service_private_key()
            signer = Account.from_key(private_key)

        fn_call = contract.functions.recordExecutedProposal(
            agent_wallet_cs, proposal_hash_bytes
        )

        nonce = w3.eth.get_transaction_count(signer.address, "pending")
        gas_price = w3.eth.gas_price

        try:
            gas_estimate = fn_call.estimate_gas({"from": signer.address})
            gas_limit = int(gas_estimate * 1.2)
        except Exception as exc:
            logger.warning("recordExecutedProposal gas estimation failed, using 80_000: %s", exc)
            gas_limit = 80_000

        raw_tx = fn_call.build_transaction(
            {
                "chainId": chain_id,
                "from": signer.address,
                "nonce": nonce,
                "gas": gas_limit,
                "gasPrice": gas_price,
            }
        )

        signed = w3.eth.account.sign_transaction(raw_tx, private_key=private_key)
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

        status = "success" if receipt["status"] == 1 else "failed"

        # Parse ProposalExecuted event for heritageScoreAfter
        heritage_score_after: int | None = None
        proposals_approved_total: int | None = None
        try:
            logs = contract.events.ProposalExecuted().process_receipt(receipt)
            if logs:
                heritage_score_after = int(logs[0]["args"]["heritageScoreAfter"])
                proposals_approved_total = int(logs[0]["args"]["proposalsApprovedTotal"])
        except Exception as exc:
            logger.warning("ProposalExecuted event parse failed: %s", exc)

        logger.info(
            "recordExecutedProposal(%s) → %s | heritage=%s proposals=%s (tx: %s)",
            agent_wallet[:10], status, heritage_score_after,
            proposals_approved_total, tx_hash.hex(),
        )
        return {
            "tx_hash": tx_hash.hex(),
            "status": status,
            "block_number": receipt["blockNumber"],
            "gas_used": str(receipt["gasUsed"]),
            "heritage_score_after": heritage_score_after,
            "proposals_approved_total": proposals_approved_total,
        }

    async def execute_autonomous_transfer(
        self,
        agent_wallet: str,
        agent_private_key: str,
        amount_mnt: float = 0.1,
        vault_address: str = "",
        chain_id: int = 5003,
    ) -> dict[str, Any]:
        """
        Agent signs a native token transfer from its own wallet to the autonomous vault.
        Used by Option A: Semi-Autonomous Proposal Execution — no MINTER_ROLE needed.
        agent_private_key must already be KMS-decrypted by the caller.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self._sync_autonomous_transfer,
            agent_wallet,
            agent_private_key,
            amount_mnt,
            vault_address,
            chain_id,
        )

    def _sync_autonomous_transfer(
        self,
        agent_wallet: str,
        agent_private_key: str,
        amount_mnt: float,
        vault_address: str,
        chain_id: int = 5003,
    ) -> dict[str, Any]:
        w3 = self._init_w3(chain_id)

        signer = Account.from_key(agent_private_key)
        from_address = signer.address
        to_address = Web3.to_checksum_address(vault_address)
        amount_wei = Web3.to_wei(amount_mnt, "ether")
        buffer_wei = Web3.to_wei(0.05, "ether")  # 0.05 MNT reserved for gas

        balance_wei = w3.eth.get_balance(from_address)
        if balance_wei < amount_wei + buffer_wei:
            balance_mnt = float(Web3.from_wei(balance_wei, "ether"))
            raise RuntimeError(
                f"Agent wallet balance too low: {balance_mnt:.4f} MNT "
                f"(need {amount_mnt + 0.05:.2f} MNT including gas buffer)"
            )

        nonce = w3.eth.get_transaction_count(from_address, "pending")
        gas_price = w3.eth.gas_price

        raw_tx = {
            "chainId": chain_id,
            "from": from_address,
            "to": to_address,
            "nonce": nonce,
            "gas": 21_000,  # native transfer always costs exactly 21000 gas
            "gasPrice": gas_price,
            "value": amount_wei,
            "data": b"",
        }

        signed = w3.eth.account.sign_transaction(raw_tx, private_key=agent_private_key)
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)

        status = "success" if receipt["status"] == 1 else "failed"
        logger.info(
            "Autonomous transfer: %s MNT from %s → %s | %s (tx: %s)",
            amount_mnt, from_address[:10], to_address[:10], status, tx_hash.hex(),
        )
        return {
            "tx_hash": tx_hash.hex(),
            "status": status,
            "amount_mnt": amount_mnt,
            "from_address": from_address,
            "to_address": to_address,
            "block_number": receipt["blockNumber"],
            "gas_used": str(receipt["gasUsed"]),
        }

    async def verify_breed_tx(
        self,
        tx_hash: str,
        expected_user_wallet: str,
        max_age_seconds: int = 3600,
        chain_id: int = 5003,
    ) -> dict[str, Any]:
        """
        Verify an on-chain breedAgents() transaction.
        Returns metadata dict if valid; raises ValueError with human-readable reason if not.
        """
        import asyncio
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self._sync_verify_breed_tx,
            tx_hash,
            expected_user_wallet,
            max_age_seconds,
            chain_id,
        )

    def _sync_verify_breed_tx(
        self,
        tx_hash: str,
        expected_user_wallet: str,
        max_age_seconds: int = 3600,
        chain_id: int = 5003,
    ) -> dict[str, Any]:
        import time as _time
        w3 = self._init_w3(chain_id)

        # 1. Fetch receipt
        try:
            receipt = w3.eth.get_transaction_receipt(tx_hash)
        except Exception as exc:
            raise ValueError(f"Cannot fetch transaction: {exc}") from exc

        if receipt is None:
            raise ValueError("Transaction not found — it may not be mined yet")

        if receipt.get("status") != 1:
            raise ValueError("Transaction was reverted")

        # 2. Verify destination is the MAEF contract on the parents' chain
        contract = self._init_contract(chain_id)
        contract_addr = contract.address
        tx_to = receipt.get("to") or ""
        if not tx_to or Web3.to_checksum_address(tx_to) != contract_addr:
            raise ValueError("Transaction was not sent to the MAEF contract")
        try:
            events = contract.events.AgentsBred().process_receipt(receipt, errors=DISCARD)
        except Exception as exc:
            raise ValueError(f"Could not parse contract events: {exc}") from exc

        if not events:
            raise ValueError("AgentsBred event not found — did the breedAgents() call succeed?")

        event = events[0]
        tx_user = event["args"].get("user", "")

        if Web3.to_checksum_address(tx_user) != Web3.to_checksum_address(expected_user_wallet):
            raise ValueError("Transaction sender does not match your wallet address")

        # 4. Check recency — prevent replaying old breed transactions
        try:
            block = w3.eth.get_block(receipt["blockNumber"])
            age = _time.time() - block["timestamp"]
            if age > max_age_seconds:
                raise ValueError(f"Transaction is too old ({int(age / 3600)}h). Use a fresh breed transaction.")
        except ValueError:
            raise
        except Exception:
            pass  # Block timestamp check is best-effort

        cost_wei = event["args"].get("cost", 0)
        return {
            "tx_hash": tx_hash,
            "user": tx_user,
            "cost_wei": cost_wei,
            "cost_mnt": float(Web3.from_wei(cost_wei, "ether")),
            "block_number": receipt["blockNumber"],
            "offspring_key": event["args"].get("offspringKey", b"").hex(),
            "generation": int(event["args"].get("generation", 2)),
            "heritage_score": int(event["args"].get("heritageScore", 0)),
        }


# Singleton — re-used across all requests
web3_service = Web3Service()

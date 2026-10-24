from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Multi-chain configuration — mirrors src/lib/blockchain/chains.ts
# Add new chains here; both backend and frontend must stay in sync.
CHAIN_CONFIGS: dict[int, dict] = {
    5003: {
        "name": "Mantle Sepolia",
        "native_symbol": "MNT",
        "rpc_url": "https://rpc.sepolia.mantle.xyz",
        # contract_address for Mantle is read from settings.contract_address (Cloud Run env var)
        # so it can be updated without code changes.
        "contract_address": "",
        "explorer_url": "https://explorer.sepolia.mantle.xyz",
    },
    11155111: {
        "name": "Ethereum Sepolia",
        "native_symbol": "ETH",
        "rpc_url": "https://ethereum-sepolia-rpc.publicnode.com",
        "contract_address": "0xD8F5691436B6647bE7a05BeF7dD637FbbCf819ab",  # ASAJU V6, 30 Sep 2026 — no MINTER_ROLE
        "explorer_url": "https://sepolia.etherscan.io",
        "marketplace_address": "0x1d6422DfF98f839c92cc2E23E0E0600d2C31965C",  # native escrow, 17 Oct 2026
    },
    97: {
        "name": "BNB Smart Chain Testnet",
        "native_symbol": "tBNB",
        "rpc_url": "https://bsc-testnet-rpc.publicnode.com",
        "contract_address": "0x1d6422DfF98f839c92cc2E23E0E0600d2C31965C",  # ASAJU V6, 30 Sep 2026 — no MINTER_ROLE
        "explorer_url": "https://testnet.bscscan.com",
        "marketplace_address": "0xa32977dFE542C244F5375c618Da091191C841001",  # native escrow, 17 Oct 2026
    },
    # VibeVibe testnet runs on Robinhood Chain (an Arbitrum Orbit L2). This is
    # where the ASA token lives, so the ERC-20 marketplace settles in ASA here.
    46630: {
        "name": "Robinhood Chain Testnet",
        "native_symbol": "ETH",
        "rpc_url": "https://rpc.testnet.chain.robinhood.com/rpc",
        "contract_address": "0x480E7BA834348ef45a140Aa8F5b09c4997c5F0a3",  # ASAJU V6, 17 Oct 2026 — no MINTER_ROLE
        "explorer_url": "https://explorer.testnet.chain.robinhood.com",
        # ASA (name "Asaju", symbol ASA, 18 decimals) — the marketplace unit of account here.
        "payment_token": "0x1c919078B57326EeE9990E9C30D92a182eDe8f5C",
        "payment_token_symbol": "ASA",
        "payment_token_decimals": 18,
        # Marketplace escrow contract (ERC-20 / ASA settlement)
        "marketplace_address": "0x110edEa5DB874589ec4492d15660082634E173f0",  # 17 Oct 2026
    },
}


# Mantle Sepolia's live agent contract (MAEFNFTV4), the same address the
# frontend uses. CONTRACT_ADDRESS still overrides it; without a default, a
# revision deployed without that env var refused every Mantle attend and scout
# with "Smart contract not configured for chain 5003".
MANTLE_CONTRACT_DEFAULT = "0x66fD8b5411856D42c08D9356e879a6e7dF0c9419"


def mantle_contract_address() -> str:
    return (settings.contract_address or "").strip() or MANTLE_CONTRACT_DEFAULT


def get_chain_config(chain_id: int) -> dict:
    """Return chain config or raise ValueError for unsupported chain_id."""
    cfg = CHAIN_CONFIGS.get(chain_id)
    if not cfg:
        supported = list(CHAIN_CONFIGS.keys())
        raise ValueError(f"Unsupported chain_id {chain_id}. Supported: {supported}")
    return cfg


class Settings(BaseSettings):
    # Optional second LLM provider, used only by Agent Room dialogue. Gemini
    # stays the default and the fallback because it guarantees JSON output,
    # which proposals and wisdom reports depend on.
    #
    # The key is a MiniMax *subscription* key (sk-cp-), valid only against the
    # M Plan quota — a pay-as-you-go key is not interchangeable with it.
    minimax_api_key: str = ""
    minimax_model: str = "MiniMax-M3.1-Flash-Preview"
    minimax_effort: str = "high"

    # GCP Project
    gcp_project_id: str = "agentic-event-factory"

    # Network — BNB testnet (97) is the new default. Mantle Sepolia (5003)
    # remains fully supported with live V4 agents. The chain_id default is
    # used only when the request does not specify one.
    rpc_url: str = "https://bsc-testnet-rpc.publicnode.com"
    contract_address: str = ""
    chain_id: int = 97
    explorer_url: str = "https://testnet.bscscan.com"

    # Mantle-only explorer override (Cloud Run env MANTLE_EXPLORER_URL).
    # Kept as its own field because Mantle's contract address is env-driven
    # too — the pair lets Mantle be repointed without a deploy.
    mantle_explorer_url: str = ""

    # App
    environment: str = "development"
    use_secret_manager: bool = True

    # GCP KMS — set in production to encrypt agent private keys
    kms_key_name: str = ""

    # Cloud Run service URL — used as OIDC token audience for Cloud Scheduler auth.
    # Override in Cloud Run env vars if the URL changes.
    cloud_run_url: str = "https://mantle-agentic-event-21898396920.asia-southeast1.run.app"
    # Service accounts whose OIDC tokens may call scheduler/indexer endpoints
    # (comma-separated). Default: the one Cloud Scheduler jobs use today.
    scheduler_service_accounts: str = "21898396920-compute@developer.gserviceaccount.com"

    # Option A: Semi-Autonomous Proposal Execution — treasury/vault address
    autonomous_vault_address: str = ""

    # CORS — comma-separated origins, or "*". Read from ALLOWED_ORIGINS_RAW or
    # ALLOWED_ORIGINS (the name .env.example used to document, silently ignored).
    allowed_origins_raw: str = Field(
        default=(
            "https://asaju.vercel.app,https://asaju-dev.vercel.app,"
            "http://localhost:5173,http://localhost:5174,http://localhost:4173"
        ),
        validation_alias=AliasChoices("ALLOWED_ORIGINS_RAW", "ALLOWED_ORIGINS"),
    )
    # Vercel deployment and branch URLs of this project (previews, PR builds).
    allowed_origin_regex: str = r"https://mantle-agentic-event-[a-z0-9-]+-psianturis-projects\.vercel\.app"

    @property
    def allowed_origins(self) -> list[str]:
        raw = self.allowed_origins_raw.strip()
        if raw == "*":
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        # A stray key in .env (e.g. a frontend VITE_* var) must not stop the
        # backend from starting; unknown keys are ignored, not fatal.
        extra="ignore",
    )


settings = Settings()

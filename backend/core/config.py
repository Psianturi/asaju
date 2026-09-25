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
        "contract_address": "0x0fE75B47bFE360A305F5D56607d976448fF7c9e7",  # ASAJU V5, 25 Sep 2026
        "explorer_url": "https://sepolia.etherscan.io",
    },
    97: {
        "name": "BNB Smart Chain Testnet",
        "native_symbol": "tBNB",
        "rpc_url": "https://bsc-testnet-rpc.publicnode.com",
        "contract_address": "0x4cCB2f96f66B4E06E5A78da25797b7386814C313",  # ASAJU V5, 25 Sep 2026
        "explorer_url": "https://testnet.bscscan.com",
    },
}


def get_chain_config(chain_id: int) -> dict:
    """Return chain config or raise ValueError for unsupported chain_id."""
    cfg = CHAIN_CONFIGS.get(chain_id)
    if not cfg:
        supported = list(CHAIN_CONFIGS.keys())
        raise ValueError(f"Unsupported chain_id {chain_id}. Supported: {supported}")
    return cfg


class Settings(BaseSettings):
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

    # Option A: Semi-Autonomous Proposal Execution — treasury/vault address
    autonomous_vault_address: str = ""

    # CORS — comma-separated origins or "*"
    # "*" is safe here because allow_credentials=False (no cookies/sessions)
    allowed_origins_raw: str = "*"

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
    )


settings = Settings()

/**
 * Deploy AsajuMarketplaceERC20 — escrow sale settled in an ERC-20 token
 * instead of the chain's native coin.
 *
 * Primary use: VibeVibe testnet (Robinhood Chain, 46630), where the project's
 * own ASA token (name "Asaju", symbol ASA, 18 decimals) is the intended unit
 * of account for marketplace trades.
 *
 *   npx hardhat run scripts/deploy-marketplace-erc20.js --network robinhoodTestnet
 *
 * Requires DEPLOYER_PRIVATE_KEY in contracts/.env. The deployer must be the
 * owner of the AsajuAgentV6 contract on that chain so setMarketplaceApproval
 * succeeds after deployment.
 *
 * Env overrides:
 *   ASA_TOKEN         ERC-20 address (defaults to the live ASA on 46630)
 *   AGENT_CONTRACT    AsajuAgentV6 address on this chain
 *   MARKET_FEE_BPS    platform fee in basis points (default 1200 = 12%)
 */
import hre from "hardhat";

const EXPLORERS = {
  robinhoodTestnet: "https://explorer.testnet.chain.robinhood.com",
};

// Live AsajuAgentV6 deployments, keyed by network name. Add the address here
// after running deploy-v6.js on that chain.
const AGENT_CONTRACT = {
  robinhoodTestnet: process.env.AGENT_CONTRACT || "",
};

// The ASA token on Robinhood Chain testnet (VibeVibe).
const ASA_TOKEN = {
  robinhoodTestnet:
    process.env.ASA_TOKEN || "0x1c919078B57326EeE9990E9C30D92a182eDe8f5C",
};

const FEE_BPS = Number(process.env.MARKET_FEE_BPS || 1200); // 12%

async function main() {
  const net = await hre.network.create();
  const { ethers } = net;
  const networkName = net.networkName;

  const explorer = EXPLORERS[networkName];
  if (!explorer) {
    throw new Error(
      `Unsupported network: ${networkName}. This script targets robinhoodTestnet only.`,
    );
  }

  const agentAddr = AGENT_CONTRACT[networkName];
  if (!agentAddr) {
    throw new Error(
      "AGENT_CONTRACT is not set for this network. Deploy AsajuAgentV6 first " +
        "(npx hardhat run scripts/deploy-v6.js --network " + networkName + ") " +
        "then set AGENT_CONTRACT=0x... and re-run.",
    );
  }

  const tokenAddr = ASA_TOKEN[networkName];
  if (!tokenAddr) throw new Error("ASA_TOKEN is not configured for this network.");

  const [deployer] = await ethers.getSigners();
  console.log("Network   :", networkName);
  console.log("Deployer  :", deployer.address);
  console.log("Agent V6  :", agentAddr);
  console.log("ASA token :", tokenAddr);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("ETH balance:", ethers.formatEther(balance));
  if (balance === 0n) {
    throw new Error(
      `Deployer has no ETH on ${networkName}. VibeVibe testnet ETH comes from the ` +
        "faucet, not from your mainnet balance.",
    );
  }

  // Sanity-check the payment token before deploying against it.
  const token = await ethers.getContractAt("IERC20", tokenAddr);
  const [decimals, symbol, name] = await Promise.all([
    token.decimals(),
    token.symbol(),
    token.name(),
  ]);
  console.log(`\nPayment token verified: ${name} (${symbol}), ${decimals} decimals`);
  if (decimals > 18) {
    throw new Error(`Unexpected decimals ${decimals} — fee maths assumes <= 18.`);
  }

  console.log(`\nDeploying AsajuMarketplaceERC20 (fee ${FEE_BPS / 100}%)...`);
  const M = await ethers.getContractFactory("AsajuMarketplaceERC20");
  const market = await M.deploy(agentAddr, tokenAddr, FEE_BPS);
  await market.waitForDeployment();
  const marketAddr = await market.getAddress();

  console.log("SUCCESS: AsajuMarketplaceERC20 deployed to:", marketAddr);
  console.log("Explorer :", `${explorer}/address/${marketAddr}`);

  console.log("\nApproving marketplace on the agent contract (setMarketplaceApproval)...");
  const agent = await ethers.getContractAt("AsajuAgentV6", agentAddr);
  await (await agent.setMarketplaceApproval(marketAddr, true)).wait();
  const approved = await agent.isApprovedMarketplace(marketAddr);
  console.log("  approved:", approved);
  if (!approved) {
    throw new Error("Approval did not take — is the deployer the agent-contract owner?");
  }

  console.log("\nNEXT STEPS:");
  console.log("  1. Backend: set MARKETPLACE_ADDRESS_46630=" + marketAddr);
  console.log("     (backend/core/config.py -> CHAIN_CONFIGS[46630]['marketplace_address'])");
  console.log("  2. Frontend: VITE_MARKETPLACE_ADDRESS_46630=" + marketAddr);
  console.log("  3. Buyers need two approvals before buy():");
  console.log("     - setMarketplaceApproval already done by the seller (contract-level)");
  console.log("     - ERC-20 approve(allowance) to the marketplace address, per listing");
  console.log(`\nAsajuMarketplaceERC20 ready on ${networkName}: ${marketAddr}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
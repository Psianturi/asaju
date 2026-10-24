/**
 * Deploy AsajuMarketplace (Fase 2 escrow sale) and approve it on the V6 agent
 * contract so it can settle ownership transfers.
 *
 *   npx hardhat run scripts/deploy-marketplace.js --network bscTestnet
 *   npx hardhat run scripts/deploy-marketplace.js --network ethereumSepolia
 *
 * Requires DEPLOYER_PRIVATE_KEY in contracts/.env, and the deployer must be the
 * owner of the V6 agent contract (so setMarketplaceApproval succeeds).
 * Only BNB and ETH Sepolia run V6 today — Mantle is still V4 and has no
 * ownership-transfer primitive, so it is intentionally excluded.
 */
import hre from "hardhat";

const EXPLORERS = {
  bscTestnet:      "https://testnet.bscscan.com",
  ethereumSepolia: "https://sepolia.etherscan.io",
};

// Live V6 agent contracts (keep in sync with src/lib/blockchain/chains.ts).
const AGENT_CONTRACT = {
  bscTestnet:      "0x1d6422DfF98f839c92cc2E23E0E0600d2C31965C",
  ethereumSepolia: "0xD8F5691436B6647bE7a05BeF7dD637FbbCf819ab",
};

const FEE_BPS = 1200; // 12% platform fee on the sale price

async function main() {
  const net = await hre.network.create();
  const { ethers } = net;
  const networkName = net.networkName;
  const [deployer] = await ethers.getSigners();

  const explorer = EXPLORERS[networkName];
  const agentAddr = AGENT_CONTRACT[networkName];
  if (!explorer || !agentAddr) {
    throw new Error(`Unsupported network: ${networkName}. Marketplace runs on bscTestnet and ethereumSepolia only (V6 chains).`);
  }

  console.log("Network  :", networkName);
  console.log("Deployer :", deployer.address);
  console.log("Agent V6 :", agentAddr);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance  :", ethers.formatEther(balance));
  if (balance === 0n) throw new Error(`Deployer has no funds on ${networkName}. Use a faucet first.`);

  console.log(`\nDeploying AsajuMarketplace (fee ${FEE_BPS / 100}%)...`);
  const M = await ethers.getContractFactory("AsajuMarketplace");
  const market = await M.deploy(agentAddr, FEE_BPS);
  await market.waitForDeployment();
  const marketAddr = await market.getAddress();
  console.log("SUCCESS: AsajuMarketplace deployed to:", marketAddr);
  console.log("Explorer:", `${explorer}/address/${marketAddr}`);

  console.log("\nApproving marketplace on the agent contract (setMarketplaceApproval)...");
  const agent = await ethers.getContractAt("AsajuAgentV6", agentAddr);
  await (await agent.setMarketplaceApproval(marketAddr, true)).wait();
  const approved = await agent.isApprovedMarketplace(marketAddr);
  console.log("  approved:", approved);
  if (!approved) throw new Error("Approval did not take — is the deployer the agent-contract owner?");

  console.log("\nNEXT STEPS:");
  console.log(`  1. Set the frontend env for ${networkName}:`);
  console.log(`     VITE_MARKETPLACE_ADDRESS_${networkName === "bscTestnet" ? "97" : "11155111"}=${marketAddr}`);
  console.log("  2. Wire the buy() flow in the frontend to this address.");
  console.log(`\nAsajuMarketplace ready on ${networkName}: ${marketAddr}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

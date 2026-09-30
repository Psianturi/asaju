/**
 * Deploy AsajuAgentV6 (no platform-held key, anywhere).
 *
 *   npx hardhat run scripts/deploy-v6.js --network bscTestnet
 *   npx hardhat run scripts/deploy-v6.js --network ethereumSepolia
 *
 * Requires DEPLOYER_PRIVATE_KEY in contracts/.env.
 * V5's deploy-v5.js is left untouched — V5 stays live wherever it's already
 * deployed. This script has no grantMinterRole step: V6 has no such role.
 */

import hre from "hardhat";

const EXPLORERS = {
  bscTestnet:      "https://testnet.bscscan.com",
  ethereumSepolia: "https://sepolia.etherscan.io",
  mantleSepolia:   "https://explorer.sepolia.mantle.xyz",
};

// Same calibrated values V5 currently runs with on each chain (26 Sep 2026).
// Re-run contracts/scripts/calibrate-fees.js against the new address any time
// gas prices drift enough to matter.
const FEES_PER_CHAIN = {
  bscTestnet:      { spawn: "0.01", provision: "0.005" },
  ethereumSepolia: { spawn: "0.01", provision: "0.005" },
  mantleSepolia:   { spawn: "1",    provision: "0.5"   },
};

async function main() {
  const net = await hre.network.create();
  const { ethers } = net;
  const networkName = net.networkName;
  const [deployer] = await ethers.getSigners();

  const explorer = EXPLORERS[networkName];
  const fees = FEES_PER_CHAIN[networkName];
  if (!explorer) throw new Error(`Unknown network: ${networkName}. Add it to EXPLORERS.`);
  if (!fees) throw new Error(`No fee config for ${networkName}. Add it to FEES_PER_CHAIN.`);

  console.log("Network  :", networkName);
  console.log("Deployer :", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance  :", ethers.formatEther(balance));
  if (balance === 0n) {
    throw new Error(`Deployer has no funds on ${networkName}. Use a faucet first.`);
  }

  console.log("\nDeploying AsajuAgentV6...");
  const F = await ethers.getContractFactory("AsajuAgentV6");
  const c = await F.deploy();
  await c.waitForDeployment();

  const address = await c.getAddress();
  console.log("\nSUCCESS: AsajuAgentV6 deployed to:", address);
  console.log("Explorer:", `${explorer}/address/${address}`);

  console.log(`\nsetFees(${fees.spawn}, ${fees.provision})...`);
  await (await c.setFees(ethers.parseEther(fees.spawn), ethers.parseEther(fees.provision))).wait();
  console.log("  done");

  // breedCost defaults to 2 ether from the constructor (unchanged from V5) —
  // recalibrate explicitly per chain, same 2:1 ratio V5 used.
  const breedCost = (ethers.parseEther(fees.spawn) * 2n).toString();
  console.log(`\nsetBreedCost(${ethers.formatEther(breedCost)})...`);
  await (await c.setBreedCost(breedCost)).wait();
  console.log("  done");

  // No grantMinterRole — V6 has no MINTER_ROLE, by design. Confirm the
  // symbol really is gone rather than silently no-op-ing:
  if (typeof c.grantMinterRole === "function") {
    throw new Error("grantMinterRole exists on this build — this is not the V6 contract expected.");
  }

  // minAgentBalanceForExecution starts at 0 (no floor) — raise it later via
  // setMinAgentBalanceForExecution() once real usage shows a safe value.
  const [spawnFee, provision, breedCostOnChain, floor] = await Promise.all([
    c.spawnFee(),
    c.agentProvision(),
    c.breedCost(),
    c.minAgentBalanceForExecution(),
  ]);
  console.log("\nVerified on-chain:");
  console.log("  spawnFee                  :", ethers.formatEther(spawnFee));
  console.log("  agentProvision             :", ethers.formatEther(provision));
  console.log("  breedCost                  :", ethers.formatEther(breedCostOnChain));
  console.log("  breed total                :", ethers.formatEther(breedCostOnChain + spawnFee), "(what a user pays)");
  console.log("  minAgentBalanceForExecution:", ethers.formatEther(floor), "(0 = no floor yet)");
  console.log("  has grantMinterRole()      : false (confirmed absent)");

  console.log("\n=== Next steps ===");
  console.log(`1. Vercel env: VITE_CONTRACT_ADDRESS_<chainId>=${address}`);
  console.log(`2. backend/core/config.py CHAIN_CONFIGS -> contract_address`);
  console.log(`3. Run smoke-v6.js against this address before pointing the app at it`);
  console.log(`4. Spawn one agent + breed one pair end-to-end via the real frontend`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

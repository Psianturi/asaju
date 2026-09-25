/**
 * Deploy AsajuAgentV5 (on-chain agent ownership + no platform subsidy).
 *
 *   npx hardhat run scripts/deploy-v5.js --network bscTestnet
 *   npx hardhat run scripts/deploy-v5.js --network ethereumSepolia
 *   npx hardhat run scripts/deploy-v5.js --network mantleSepolia
 *
 * Requires DEPLOYER_PRIVATE_KEY in contracts/.env.
 * V4's deploy-new-chain.js is left untouched — the live V4 deployments still use it.
 */

import hre from "hardhat";

const EXPLORERS = {
  bscTestnet:      "https://testnet.bscscan.com",
  ethereumSepolia: "https://sepolia.etherscan.io",
  mantleSepolia:   "https://explorer.sepolia.mantle.xyz",
};

// Per-chain economics, in native token units. provision <= spawn (enforced on-chain).
// breed:spawn stays 2:1, matching Mantle's original economics.
// NOTE: breeding now charges breedCost + spawnFee in one go — the offspring's
// activation is prepaid by the user instead of the platform's minter wallet.
const FEES_PER_CHAIN = {
  bscTestnet:      { spawn: "0.005", provision: "0.0025", breed: "0.01" },  // tBNB — faucet drips ~0.1-0.5
  ethereumSepolia: { spawn: "0.02",  provision: "0.01",   breed: "0.04" },  // sized for Sepolia faucet drips
  mantleSepolia:   { spawn: "1",     provision: "0.5",    breed: "2"    },  // matches live Mantle economics
};

// Backend minter service — still granted MINTER_ROLE as a fallback path, but V5
// no longer requires it to fund anything: spawnBredAgent() draws from the
// breeder's escrow, and recordExecutedProposal() is owner/agent authorised.
const MINTER_SERVICE_WALLET = "0xCBA7951a8b5AE81303AC5E1017e34bF50A342D22";

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

  console.log("\nDeploying AsajuAgentV5...");
  const MAEF = await ethers.getContractFactory("AsajuAgentV5");
  const maef = await MAEF.deploy();
  await maef.waitForDeployment();

  const address = await maef.getAddress();
  console.log("\nSUCCESS: AsajuAgentV5 deployed to:", address);
  console.log("Explorer:", `${explorer}/address/${address}`);

  console.log(`\nsetFees(${fees.spawn}, ${fees.provision})...`);
  await (
    await maef.setFees(ethers.parseEther(fees.spawn), ethers.parseEther(fees.provision))
  ).wait();
  console.log("  done");

  console.log(`setBreedCost(${fees.breed})...`);
  await (await maef.setBreedCost(ethers.parseEther(fees.breed))).wait();
  console.log("  done");

  console.log(`grantMinterRole(${MINTER_SERVICE_WALLET})...`);
  await (await maef.grantMinterRole(MINTER_SERVICE_WALLET)).wait();
  console.log("  done");

  // Read the state back from the chain rather than trusting the tx receipts.
  const [spawnFee, provision, breedCost] = await Promise.all([
    maef.spawnFee(),
    maef.agentProvision(),
    maef.breedCost(),
  ]);
  console.log("\nVerified on-chain:");
  console.log("  spawnFee      :", ethers.formatEther(spawnFee));
  console.log("  agentProvision:", ethers.formatEther(provision));
  console.log("  breedCost     :", ethers.formatEther(breedCost));
  console.log("  breed total   :", ethers.formatEther(breedCost + spawnFee), "(what a user now pays)");
  console.log("  minter role   :", await maef.hasRole(await maef.MINTER_ROLE(), MINTER_SERVICE_WALLET));

  console.log("\n=== Next steps ===");
  console.log(`1. Vercel env: VITE_CONTRACT_ADDRESS_<chainId>=${address}`);
  console.log(`2. backend/core/config.py CHAIN_CONFIGS -> contract_address`);
  console.log(`3. Spawn one agent on ${networkName} end-to-end before announcing it`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

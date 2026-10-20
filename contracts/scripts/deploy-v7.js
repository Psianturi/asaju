/**
 * Deploy ASAJU V7: AsajuTimelock → AsajuAgentV7 → AsajuMarketV7.
 *
 *   npx hardhat run scripts/deploy-v7.js --network bscTestnet            # dry run (default)
 *   V7_CONFIRM=yes npx hardhat run scripts/deploy-v7.js --network bscTestnet
 *
 * The deployer never holds admin: both contracts are owned by the timelock
 * from the constructor, and the timelock's proposer/executor is V7_SAFE.
 * Fees are copied live from the chain's current contract (V6, or V4 on Mantle).
 *
 * Env (contracts/.env):
 *   DEPLOYER_PRIVATE_KEY        pays gas only
 *   V7_SAFE                     multisig (required); testnet may use an EOA
 *   V7_GUARDIAN                 may pause instantly (default V7_SAFE)
 *   V7_TREASURY                 receives market fees (default V7_SAFE)
 *   V7_TIMELOCK_DELAY           seconds (default 172800 = 48h)
 *   V7_MARKET_FEE_BPS           default 250 (max 1000)
 *   V7_ROYALTY_BPS              default 250 (max 1000)
 *   V7_PAYMENT_TOKEN            ERC-20 for the market; empty = native coin
 *   V7_IMAGE_BASE_URI           e.g. https://.../passport/ (tier + ".png" appended)
 *   V7_MIGRATION_SIGNER         Mantle only: attestation key (not an admin key)
 *   V7_MIGRATION_WINDOW_DAYS    Mantle only (default 30)
 *   V7_LEGACY_OVERRIDE          use this legacy address instead of the table below
 */

import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";

const ZERO = "0x0000000000000000000000000000000000000000";
const LEGACY_KIND = { None: 0, V6: 1, V4: 2 };

// Live contracts per chain (src/lib/blockchain/chains.ts, checked 20 Oct 2026).
const CHAINS = {
  97:       { label: "BNB Smart Chain Testnet", legacy: "0x1d6422DfF98f839c92cc2E23E0E0600d2C31965C", kind: "V6", explorer: "https://testnet.bscscan.com" },
  11155111: { label: "Ethereum Sepolia",        legacy: "0xD8F5691436B6647bE7a05BeF7dD637FbbCf819ab", kind: "V6", explorer: "https://sepolia.etherscan.io" },
  46630:    { label: "Robinhood Chain Testnet", legacy: "0x480E7BA834348ef45a140Aa8F5b09c4997c5F0a3", kind: "V6", explorer: "https://explorer.testnet.chain.robinhood.com" },
  5003:     { label: "Mantle Sepolia",          legacy: "0x66fD8b5411856D42c08D9356e879a6e7dF0c9419", kind: "V4", explorer: "https://explorer.sepolia.mantle.xyz" },
};

const MAX_RUNTIME = 24576;

async function readFees(ethers, legacy) {
  const c = new ethers.Contract(legacy, [
    "function spawnFee() view returns (uint256)",
    "function agentProvision() view returns (uint256)",
    "function breedCost() view returns (uint256)",
    "function SPAWN_FEE() view returns (uint256)",
    "function AGENT_PROVISION() view returns (uint256)",
  ], ethers.provider);
  // Mantle's live V4 predates the mutable-fee getters.
  const spawnFee = await c.spawnFee().catch(() => c.SPAWN_FEE());
  const agentProvision = await c.agentProvision().catch(() => c.AGENT_PROVISION());
  const breedCost = await c.breedCost().catch(() => spawnFee * 2n);
  return { spawnFee, agentProvision, breedCost };
}

function env(name, fallback) {
  const v = (process.env[name] ?? "").trim();
  return v === "" ? fallback : v;
}

async function main() {
  const net = await hre.network.create();
  const { ethers } = net;
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  let chain = CHAINS[chainId];
  if (chainId === 31337) {
    // Local rehearsal: a throwaway V6 stands in for the legacy contract.
    const v6 = await ethers.deployContract("AsajuAgentV6");
    chain = { label: "Hardhat (rehearsal)", legacy: await v6.getAddress(), kind: "V6", explorer: "local" };
  }
  if (!chain) throw new Error(`No V7 config for chain ${chainId}.`);

  const safe = env("V7_SAFE");
  if (!safe || !ethers.isAddress(safe)) throw new Error("V7_SAFE (multisig address) is required.");
  const guardian = env("V7_GUARDIAN", safe);
  const treasury = env("V7_TREASURY", safe);
  const delay = BigInt(env("V7_TIMELOCK_DELAY", "172800"));
  const marketFee = Number(env("V7_MARKET_FEE_BPS", "250"));
  const royalty = Number(env("V7_ROYALTY_BPS", "250"));
  const paymentToken = env("V7_PAYMENT_TOKEN", ZERO);
  const legacy = env("V7_LEGACY_OVERRIDE", chain.legacy);
  const kind = LEGACY_KIND[chain.kind];
  const migrationSigner = chain.kind === "V4" ? env("V7_MIGRATION_SIGNER", ZERO) : ZERO;
  const windowDays = BigInt(env("V7_MIGRATION_WINDOW_DAYS", "30"));

  if (marketFee > 1000 || royalty > 1000) throw new Error("Fee and royalty are capped at 1000 bps.");
  for (const [k, v] of Object.entries({ guardian, treasury, paymentToken, legacy, migrationSigner })) {
    if (!ethers.isAddress(v)) throw new Error(`${k} is not an address: ${v}`);
  }
  if ((await ethers.provider.getCode(legacy)) === "0x") throw new Error(`No contract at legacy address ${legacy}.`);
  if (paymentToken !== ZERO && (await ethers.provider.getCode(paymentToken)) === "0x") throw new Error(`No contract at payment token ${paymentToken}.`);
  if (chain.kind === "V4" && migrationSigner === ZERO) console.warn("WARNING: no V7_MIGRATION_SIGNER — Mantle agents cannot migrate until the timelock sets one.");

  const fees = await readFees(ethers, legacy);
  const agentParams = {
    admin: ZERO, // filled with the timelock address below
    guardian,
    spawnFee: fees.spawnFee,
    agentProvision: fees.agentProvision,
    breedCost: fees.breedCost,
    royaltyBps: royalty,
    legacy,
    legacyKind: kind,
    migrationSigner,
    migrationWindow: chain.kind === "V4" ? windowDays * 86400n : 0n,
    imageBaseURI: env("V7_IMAGE_BASE_URI", ""),
    chainLabel: chain.label,
  };

  for (const name of ["AsajuTimelock", "AsajuAgentV7", "AsajuMarketV7"]) {
    const art = await hre.artifacts.readArtifact(name);
    const size = (art.deployedBytecode.length - 2) / 2;
    if (size > MAX_RUNTIME) throw new Error(`${name} runtime is ${size} bytes (> ${MAX_RUNTIME}).`);
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Chain            :", chainId, chain.label);
  console.log("Deployer (gas)   :", deployer.address, ethers.formatEther(balance));
  console.log("Safe (admin)     :", safe);
  console.log("Guardian         :", guardian);
  console.log("Treasury         :", treasury);
  console.log("Timelock delay   :", `${delay}s (${Number(delay) / 3600}h)`);
  console.log("Legacy           :", chain.kind, legacy);
  console.log("Fees (from legacy):", ethers.formatEther(fees.spawnFee), "spawn /", ethers.formatEther(fees.agentProvision), "provision /", ethers.formatEther(fees.breedCost), "breed");
  console.log("Market fee       :", marketFee, "bps | royalty", royalty, "bps | payment", paymentToken === ZERO ? "native" : paymentToken);
  if (chain.kind === "V4") console.log("Migration        :", migrationSigner, `window ${windowDays} days`);

  if (process.env.V7_CONFIRM !== "yes") {
    console.log("\nDry run only. Re-run with V7_CONFIRM=yes to deploy.");
    return;
  }
  if (balance === 0n) throw new Error("Deployer has no gas funds.");

  const timelock = await ethers.deployContract("AsajuTimelock", [delay, [safe], [safe]]);
  await timelock.waitForDeployment();
  const tl = await timelock.getAddress();
  console.log("\nAsajuTimelock    :", tl);

  const agent = await ethers.deployContract("AsajuAgentV7", [{ ...agentParams, admin: tl }]);
  await agent.waitForDeployment();
  const agentAddr = await agent.getAddress();
  console.log("AsajuAgentV7     :", agentAddr);

  const market = await ethers.deployContract("AsajuMarketV7", [agentAddr, paymentToken, tl, guardian, treasury, marketFee]);
  await market.waitForDeployment();
  const marketAddr = await market.getAddress();
  console.log("AsajuMarketV7    :", marketAddr);

  // Read back what the chain actually holds.
  const checks = {
    agentOwnerIsTimelock: (await agent.owner()) === tl,
    marketOwnerIsTimelock: (await market.owner()) === tl,
    marketPassport: (await market.passport()) === agentAddr,
    spawnFee: (await agent.spawnFee()) === fees.spawnFee,
    legacy: (await agent.legacy()) === legacy,
    timelockDelay: (await timelock.getMinDelay()) === delay,
    safeIsProposer: await timelock.hasRole(await timelock.PROPOSER_ROLE(), safe),
    deployerHasNoRole: !(await timelock.hasRole(await timelock.PROPOSER_ROLE(), deployer.address)) || deployer.address === safe,
  };
  console.log("\nChecks:", checks);
  if (Object.values(checks).some((v) => !v)) throw new Error("Post-deploy check failed — do not wire this deployment.");

  const out = path.join("deployments", `v7-${chainId}.json`);
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    chainId, network: net.networkName, deployedAt: new Date().toISOString(), deployer: deployer.address,
    timelock: tl, agent: agentAddr, market: marketAddr, safe, guardian, treasury,
    timelockDelay: delay.toString(), marketFeeBps: marketFee, royaltyBps: royalty, paymentToken,
    legacy, legacyKind: chain.kind,
    fees: { spawnFee: fees.spawnFee.toString(), agentProvision: fees.agentProvision.toString(), breedCost: fees.breedCost.toString() },
  }, null, 2));
  console.log("\nSaved", out);
  console.log("Explorer:", `${chain.explorer}/address/${agentAddr}`);
  if (chain.kind === "V6") console.log("\nNext (optional): enable V6 → V7 claims with scripts/v7-enable-v6-claims.js");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

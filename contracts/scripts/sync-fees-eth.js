/**
 * Sync Ethereum Sepolia (11155111) AsajuAgentV5 to per-chain fees in
 * src/lib/blockchain/chains.ts.
 *
 * Sibling of sync-fees-bnb.js. The V5 contract was deployed to ETH Sepolia
 * with the constructor defaults of `spawnFee = 1 ether`, which is correct for
 * Mantle but wrong for ETH Sepolia. The frontend sends `0.005 ETH` and the
 * `require(msg.value >= spawnFee)` reverts.
 *
 *   npx hardhat run scripts/sync-fees-eth.js          (dry run)
 *   APPLY=1 npx hardhat run scripts/sync-fees-eth.js  (writes on-chain)
 *
 * After this script: verify with `npx hardhat run scripts/verify-fee-sync.js`.
 *
 * Why a separate script and not a multi-chain one: per-chain hardhat config
 * is keyed off `--network`, and a single script that handles both BNB and
 * ETH would just be a config switch. Two short scripts stay easier to audit
 * and easier to wire into CI later.
 */

import hre from "hardhat";
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { join } from "path";

const ETH_CONTRACT = "0x0fE75B47bFE360A305F5D56607d976448fF7c9e7";
const ETH_CHAIN_ID = 11155111;
const CHAINS_TS = join(__dirname, "..", "..", "src", "lib", "blockchain", "chains.ts");

function readEthFeesFromChainsTs() {
  // Read the ETH Sepolia block (chainId 11155111) from chains.ts. The file is
  // short and well-formed, so a regex parser is plenty.
  const src = readFileSync(CHAINS_TS, "utf-8");

  // Find the ETH Sepolia block: from "11155111: {" to the matching "}".
  const start = src.indexOf(`11155111: {`);
  if (start === -1) throw new Error("ETH Sepolia block not found in chains.ts — does chainId 11155111 still exist?");
  let depth = 0;
  let end = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("Could not find end of ETH Sepolia block in chains.ts");
  const block = src.slice(start, end + 1);

  const spawnFeeMatch = block.match(/spawnFee:\s*['"]([^'"]+)['"]/);
  const provisionMatch = block.match(/agentProvision:\s*['"]([^'"]+)['"]/);
  if (!spawnFeeMatch || !provisionMatch) {
    throw new Error("Could not parse spawnFee / agentProvision from ETH Sepolia block");
  }
  return {
    spawnFee: spawnFeeMatch[1],
    agentProvision: provisionMatch[1],
  };
}

async function main() {
  const { spawnFee, agentProvision } = readEthFeesFromChainsTs();
  console.log("Read from src/lib/blockchain/chains.ts (chain 11155111 ETH Sepolia):");
  console.log("  spawnFee      :", spawnFee, "ETH");
  console.log("  agentProvision:", agentProvision, "ETH");

  if (hre.network.config.chainId !== ETH_CHAIN_ID) {
    throw new Error(
      `Wrong network. Run with --network sepolia (got chainId ${hre.network.config.chainId}).`,
    );
  }

  const c = await ethers.getContractAt("AsajuAgentV5", ETH_CONTRACT);

  const curSpawn = await c.spawnFee();
  const curProv = await c.agentProvision();
  console.log("\nLive on-chain right now:");
  console.log("  spawnFee      :", ethers.formatEther(curSpawn), "ETH");
  console.log("  agentProvision:", ethers.formatEther(curProv), "ETH");

  if (curSpawn.toString() === ethers.parseEther(spawnFee).toString() &&
      curProv.toString() === ethers.parseEther(agentProvision).toString()) {
    console.log("\nAlready in sync — no on-chain write needed.");
    return;
  }

  if (process.env.APPLY !== "1") {
    console.log("\nDry run. Re-run with APPLY=1 to write these on-chain.");
    return;
  }

  if (!hre.network.config.accounts || hre.network.config.accounts.length === 0) {
    throw new Error(
      "No deployer account available. Set DEPLOYER_PRIVATE_KEY in env " +
      "(must be the address that holds DEFAULT_ADMIN_ROLE on the contract).",
    );
  }

  // Sanity-check: signer is admin on the contract. If not, the call reverts
  // and we fail fast before wasting gas.
  const signer = (await ethers.getSigners())[0];
  const DEFAULT_ADMIN_ROLE = await c.DEFAULT_ADMIN_ROLE();
  const hasAdmin = await c.hasRole(DEFAULT_ADMIN_ROLE, signer.address);
  if (!hasAdmin) {
    throw new Error(
      `Signer ${signer.address} does not hold DEFAULT_ADMIN_ROLE on ${ETH_CONTRACT}. ` +
      `Use the deployer key instead.`,
    );
  }
  console.log(`\nSigner ${signer.address} has DEFAULT_ADMIN_ROLE. Applying...`);

  const tx = await c.setFees(
    ethers.parseEther(spawnFee),
    ethers.parseEther(agentProvision),
  );
  console.log("TX sent:", tx.hash);
  await tx.wait();
  console.log("Confirmed.");

  const [s2, p2] = await Promise.all([c.spawnFee(), c.agentProvision()]);
  console.log("\nVerified on-chain:");
  console.log("  spawnFee      :", ethers.formatEther(s2), "ETH");
  console.log("  agentProvision:", ethers.formatEther(p2), "ETH");
  console.log("\nETH Sepolia V5 contract is now in sync with chains.ts.");
  console.log("Re-run verify-fee-sync.js to confirm.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

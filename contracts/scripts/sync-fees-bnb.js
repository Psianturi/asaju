/**
 * Sync BNB Testnet AsajuAgentV5 to per-chain fees in src/lib/blockchain/chains.ts.
 *
 * Why this exists: when the V5 contract was deployed to BNB Testnet (97) and
 * ETH Sepolia (11155111) on 25 Sep 2026, the constructor's hardcoded
 * `spawnFee = 1 ether` and `agentProvision = 0.5 ether` (Mantle defaults)
 * went with it. The frontend already calls `spawnAgent` with
 * `value = parseEther(chain.spawnFee)` — `0.01` for BNB, `0.005` for ETH.
 * But the contract still requires `msg.value >= 1 ether` on BNB → revert.
 *
 * V5's `setFees(uint256 spawnFee, uint256 agentProvision)` is mutable, so
 * the fix is a single transaction per chain. This script targets BNB;
 * the ETH variant is identical with different params.
 *
 *   npx hardhat run scripts/sync-fees-bnb.js          (dry run)
 *   APPLY=1 npx hardhat run scripts/sync-fees-bnb.js  (writes on-chain)
 *
 * Values are read from src/lib/blockchain/chains.ts to keep the contract and
 * the frontend in agreement.
 *
 * After this script: verify with `npx hardhat run scripts/verify-fee-sync.js`.
 */

import hre from "hardhat";
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { join } from "path";

const BNB_CONTRACT = "0x4cCB2f96f66B4E06E5A78da25797b7386814C313";
const BNB_CHAIN_ID = 97;
const CHAINS_TS = join(__dirname, "..", "..", "src", "lib", "blockchain", "chains.ts");

function readBnBFeesFromChainsTs() {
  // Lazy import so the script doesn't need TypeScript at runtime.
  // We regex-extract the BNB block (chainId 97) from chains.ts. The file
  // is short and well-formed, so a robust parser is overkill.
  const src = readFileSync(CHAINS_TS, "utf-8");

  // Find the BNB block: from "97: {" to the next "}," at column 0.
  const start = src.indexOf(`97: {`);
  if (start === -1) throw new Error("BNB block not found in chains.ts — does chain 97 still exist?");
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
  if (end === -1) throw new Error("Could not find end of BNB block in chains.ts");
  const block = src.slice(start, end + 1);

  const spawnFeeMatch = block.match(/spawnFee:\s*['"]([^'"]+)['"]/);
  const provisionMatch = block.match(/agentProvision:\s*['"]([^'"]+)['"]/);
  if (!spawnFeeMatch || !provisionMatch) {
    throw new Error("Could not parse spawnFee / agentProvision from BNB block");
  }
  return {
    spawnFee: spawnFeeMatch[1],
    agentProvision: provisionMatch[1],
  };
}

async function main() {
  const { spawnFee, agentProvision } = readBnBFeesFromChainsTs();
  console.log("Read from src/lib/blockchain/chains.ts (chain 97 BNB Testnet):");
  console.log("  spawnFee      :", spawnFee, "tBNB");
  console.log("  agentProvision:", agentProvision, "tBNB");

  if (hre.network.config.chainId !== BNB_CHAIN_ID) {
    throw new Error(
      `Wrong network. Run with --network bscTestnet (got chainId ${hre.network.config.chainId}).`,
    );
  }

  const c = await ethers.getContractAt("AsajuAgentV5", BNB_CONTRACT);

  const curSpawn = await c.spawnFee();
  const curProv = await c.agentProvision();
  console.log("\nLive on-chain right now:");
  console.log("  spawnFee      :", ethers.formatEther(curSpawn), "tBNB");
  console.log("  agentProvision:", ethers.formatEther(curProv), "tBNB");

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
      `Signer ${signer.address} does not hold DEFAULT_ADMIN_ROLE on ${BNB_CONTRACT}. ` +
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
  console.log("  spawnFee      :", ethers.formatEther(s2), "tBNB");
  console.log("  agentProvision:", ethers.formatEther(p2), "tBNB");
  console.log("\nBNB Testnet V5 contract is now in sync with chains.ts.");
  console.log("Re-run verify-fee-sync.js to confirm.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

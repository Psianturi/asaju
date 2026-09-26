/**
 * Check the frontend's fee table against what each contract actually enforces.
 *
 *   npx hardhat run scripts/verify-fee-sync.js --network bscTestnet
 *
 * A unit test cannot do this — it has no network, so it can only compare
 * chains.ts with a copy of its own numbers. That is exactly how ETH Sepolia
 * shipped broken: chains.ts was lowered to 0.005 while the contract still
 * enforced 0.02, the expected-value table was edited to agree, the suite
 * stayed green, and every spawn reverted with "Insufficient spawn fee".
 *
 * Exits non-zero on a mismatch so it can gate a deploy.
 */

import { readFileSync } from "node:fs";
import hre from "hardhat";

/** Pull one chain's declared fees straight out of chains.ts. */
function readFrontendFees(chainId) {
  const src = readFileSync("../src/lib/blockchain/chains.ts", "utf8");
  const block = src.split(`  ${chainId}: {`)[1];
  if (!block) throw new Error(`chain ${chainId} not found in chains.ts`);
  const body = block.split("},")[0];
  const grab = (key) => body.match(new RegExp(`${key}:\\s*'([^']+)'`))?.[1];
  return { spawnFee: grab("spawnFee"), agentProvision: grab("agentProvision") };
}

async function main() {
  const net = await hre.network.create();
  const { ethers } = net;

  const addr = process.env.CONTRACT;
  if (!addr) throw new Error("Set CONTRACT=0x...");

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const c = await ethers.getContractAt("AsajuAgentV5", addr);

  const [spawnWei, provWei] = await Promise.all([c.spawnFee(), c.agentProvision()]);
  const onChain = {
    spawnFee: ethers.formatEther(spawnWei),
    agentProvision: ethers.formatEther(provWei),
  };
  const frontend = readFrontendFees(chainId);

  console.log(`Chain ${chainId} — ${addr}`);
  console.log("  on-chain :", JSON.stringify(onChain));
  console.log("  chains.ts:", JSON.stringify(frontend));

  const same = (a, b) => a != null && b != null && ethers.parseEther(a) === ethers.parseEther(b);
  const ok =
    same(onChain.spawnFee, frontend.spawnFee) &&
    same(onChain.agentProvision, frontend.agentProvision);

  if (!ok) {
    console.error(
      "\nMISMATCH. The frontend will send the wrong value and every spawn on " +
      "this chain reverts. Either push the new fees with calibrate-fees.js or " +
      "correct chains.ts — do not change the expected values in chains.test.ts.",
    );
    process.exit(1);
  }
  console.log("\nIn sync.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

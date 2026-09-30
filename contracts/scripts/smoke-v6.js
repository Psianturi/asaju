/**
 * Live smoke test against a deployed V6, on a real chain.
 *
 *   CONTRACT=0x... npx hardhat run scripts/smoke-v6.js --network bscTestnet
 *
 * Proves the two things V6 exists for, against real state: no MINTER_SERVICE
 * key is used anywhere, and the gas floor reads a real live balance.
 */

import assert from "node:assert/strict";
import hre from "hardhat";

async function main() {
  const net = await hre.network.create();
  const { ethers } = net;
  const [deployer] = await ethers.getSigners();

  const addr = process.env.CONTRACT;
  if (!addr) throw new Error("Set CONTRACT=0x...");

  const c = await ethers.getContractAt("AsajuAgentV6", addr);
  console.log("Contract :", addr);
  console.log("Caller   :", deployer.address, "(this run's only signer — playing owner AND agent)");

  const spawnFee = await c.spawnFee();
  const breedCost = await c.breedCost();
  console.log("spawnFee :", ethers.formatEther(spawnFee));
  console.log("breedCost:", ethers.formatEther(breedCost));

  // Throwaway agent wallets — funded only by the contract's own provision.
  const agentA = ethers.Wallet.createRandom().connect(ethers.provider);
  const agentB = ethers.Wallet.createRandom().connect(ethers.provider);
  const offspring = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log("Agent A  :", agentA.address);
  console.log("Agent B  :", agentB.address);
  console.log("Offspring:", offspring.address);

  console.log("\n1. spawnAgent x2 — deployer becomes owner of both");
  await (await c.spawnAgent(agentA.address, { value: spawnFee })).wait();
  await (await c.spawnAgent(agentB.address, { value: spawnFee })).wait();
  assert.equal(await c.agentOwner(agentA.address), deployer.address);
  console.log("   both spawned, owner recorded OK");

  console.log("\n2. recordExecutedProposal — owner-signed, no MINTER_SERVICE involved");
  const hash1 = ethers.keccak256(ethers.toUtf8Bytes(`smoke-v6-${Date.now()}`));
  await (await c.recordExecutedProposal(agentA.address, hash1)).wait();
  const stats1 = await c.getAgentStats(agentA.address);
  assert.equal(stats1.proposalsApproved, 1n);
  console.log("   heritage =", stats1.heritageScore.toString(), "OK");

  console.log("\n3. breedAgents — pays breedCost + spawnFee together (escrow, no subsidy)");
  const offspringId = ethers.keccak256(ethers.toUtf8Bytes(`smoke-v6-offspring-${Date.now()}`));
  const totalDue = breedCost + spawnFee;
  await (
    await c.breedAgents(agentA.address, agentB.address, offspringId, 2, 50, { value: totalDue })
  ).wait();
  const escrowAfterBreed = await c.pendingProvisionEscrow();
  assert.ok(escrowAfterBreed >= spawnFee, "escrow should hold at least the offspring's spawn fee");
  console.log("   escrow now holds", ethers.formatEther(escrowAfterBreed), "OK");

  console.log("\n4. spawnBredAgent — called by the SAME wallet that bred (the breeder), not a minter key");
  const before = await ethers.provider.getBalance(offspring.address);
  await (await c.spawnBredAgent(offspring.address, offspringId)).wait();
  const after = await ethers.provider.getBalance(offspring.address);
  const provision = await c.agentProvision();
  assert.equal(after - before, provision, "offspring should receive exactly agentProvision from escrow");
  assert.equal(await c.agentOwner(offspring.address), deployer.address);
  console.log("   offspring funded", ethers.formatEther(after - before), "from escrow OK");

  console.log("\n5. confirm there is truly no minter role to fall back to");
  assert.equal(typeof c.grantMinterRole, "undefined");
  assert.equal(typeof c.hasRole, "undefined");
  console.log("   grantMinterRole/hasRole absent from the ABI OK");

  console.log("\n6. gas floor reads live balance, set + enforced on-chain");
  await (await c.setMinAgentBalanceForExecution(provision + 1n)).wait();
  let flooredOut = false;
  try {
    await c.recordExecutedProposal(agentA.address, ethers.keccak256(ethers.toUtf8Bytes("floor-test")));
  } catch {
    flooredOut = true;
  }
  assert.equal(flooredOut, true, "proposal should be rejected below the floor");
  await (await c.setMinAgentBalanceForExecution(0)).wait(); // reset — don't leave the floor armed
  console.log("   floor enforced, then reset to 0 OK");

  console.log("\nAll live checks passed. No MINTER_SERVICE transaction occurred at any point.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

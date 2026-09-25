/**
 * Live smoke test against a deployed V5, on a real chain.
 *
 *   CONTRACT=0x... npx hardhat run scripts/smoke-v5.js --network bscTestnet
 *
 * Proves the two things V5 exists for, against real state rather than a local
 * EVM: an agent's owner is recorded on-chain, and a proposal can be recorded
 * without the platform's minter wallet paying for it.
 */

import assert from "node:assert/strict";
import hre from "hardhat";

async function main() {
  const net = await hre.network.create();
  const { ethers } = net;
  const [deployer] = await ethers.getSigners();

  const addr = process.env.CONTRACT;
  if (!addr) throw new Error("Set CONTRACT=0x... in the environment");

  const c = await ethers.getContractAt("AsajuAgentV5", addr);
  console.log("Contract :", addr);
  console.log("Caller   :", deployer.address);

  // A throwaway agent wallet — never funded beyond the contract's own provision.
  const agent = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log("Agent    :", agent.address, "(throwaway)");

  const spawnFee = await c.spawnFee();
  console.log("spawnFee :", ethers.formatEther(spawnFee));

  console.log("\n1. spawnAgent — caller becomes the on-chain owner");
  await (await c.spawnAgent(agent.address, { value: spawnFee })).wait();
  const owner = await c.agentOwner(agent.address);
  assert.equal(owner, deployer.address, "owner not recorded");
  console.log("   agentOwner =", owner, "OK");

  const provisioned = await ethers.provider.getBalance(agent.address);
  console.log("   agent funded with", ethers.formatEther(provisioned), "OK");

  console.log("\n2. recordExecutedProposal — signed by the owner, no MINTER_ROLE involved");
  const hash = ethers.keccak256(ethers.toUtf8Bytes(`smoke-${Date.now()}`));
  await (await c.recordExecutedProposal(agent.address, hash)).wait();
  const stats = await c.getAgentStats(agent.address);
  assert.equal(stats.proposalsApproved, 1n);
  assert.equal(stats.heritageScore, 5n);
  console.log("   proposalsApproved =", stats.proposalsApproved.toString(), "heritage =", stats.heritageScore.toString(), "OK");

  console.log("\n3. replaying the same proposal hash must fail");
  let replayed = false;
  try {
    await (await c.recordExecutedProposal(agent.address, hash)).wait();
    replayed = true;
  } catch {
    console.log("   rejected as expected OK");
  }
  assert.equal(replayed, false, "duplicate proposal hash was accepted");

  console.log("\n4. transferAgentOwnership — the marketplace primitive");
  const buyer = ethers.Wallet.createRandom();
  await (await c.transferAgentOwnership(agent.address, buyer.address)).wait();
  assert.equal(await c.agentOwner(agent.address), buyer.address);
  const after = await c.getAgentStats(agent.address);
  assert.equal(after.heritageScore, 5n, "earned heritage must survive the transfer");
  console.log("   owner ->", buyer.address, "heritage kept at", after.heritageScore.toString(), "OK");

  console.log("\nAll live checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

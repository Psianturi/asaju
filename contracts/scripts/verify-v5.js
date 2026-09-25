/**
 * Pre-deploy verification for AsajuAgentV5.
 *
 * Runs the whole money path against a real EVM (in-process Hardhat network)
 * and asserts on it. Every V5 change touches either funds or authorisation,
 * so none of it should reach a live chain unverified.
 *
 *   npx hardhat run scripts/verify-v5.js
 */

import assert from "node:assert/strict";
import hre from "hardhat";

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    process.exitCode = 1;
  }
}

/** Assert a call reverts, optionally matching a substring. */
async function expectRevert(promise, contains) {
  try {
    await promise;
  } catch (err) {
    if (contains && !JSON.stringify(err).includes(contains)) {
      throw new Error(`reverted, but not with "${contains}": ${err.message}`);
    }
    return;
  }
  throw new Error("expected revert, but the call succeeded");
}

async function main() {
  const net = await hre.network.create();
  const { ethers } = net;
  const [deployer, alice, bob, marketplace, agentA, agentB, offspring] =
    await ethers.getSigners();

  const SPAWN = ethers.parseEther("1");
  const PROVISION = ethers.parseEther("0.5");
  const BREED = ethers.parseEther("2");

  const fresh = async () => {
    const F = await ethers.getContractFactory("AsajuAgentV5");
    const c = await F.deploy();
    await c.waitForDeployment();
    return c;
  };

  // Spawn two parents owned by alice, then breed them. Returns the contract.
  const withBredOffspring = async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (await c.connect(alice).spawnAgent(agentB.address, { value: SPAWN })).wait();
    const id = ethers.keccak256(ethers.toUtf8Bytes("offspring-1"));
    await (
      await c
        .connect(alice)
        .breedAgents(agentA.address, agentB.address, id, 2, 50, { value: BREED + SPAWN })
    ).wait();
    return { c, id };
  };

  console.log("\nAsajuAgentV5 — pre-deploy verification\n");

  // ── Ownership registry ──────────────────────────────────────────────────
  console.log("Agent ownership");

  await check("spawnAgent records the spawner as owner", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    assert.equal(await c.agentOwner(agentA.address), alice.address);
    assert.equal(await c.getAgentOwner(agentA.address), alice.address);
  });

  await check("spawnAgent still provisions the agent wallet", async () => {
    const c = await fresh();
    const before = await ethers.provider.getBalance(agentA.address);
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    const after = await ethers.provider.getBalance(agentA.address);
    assert.equal(after - before, PROVISION);
  });

  // ── Breeding escrow: the platform must not subsidise activation ─────────
  console.log("\nBreeding escrow (no platform subsidy)");

  await check("breedAgents rejects the old breedCost-only amount", async () => {
    const c = await fresh();
    const id = ethers.keccak256(ethers.toUtf8Bytes("x"));
    await expectRevert(
      c.connect(alice).breedAgents(agentA.address, agentB.address, id, 2, 50, { value: BREED }),
      "Insufficient value",
    );
  });

  await check("breedAgents escrows the offspring's spawn fee", async () => {
    const { c } = await withBredOffspring();
    assert.equal(await c.pendingProvisionEscrow(), SPAWN);
  });

  await check("breedAgents refunds anything above breedCost + spawnFee", async () => {
    const c = await fresh();
    const id = ethers.keccak256(ethers.toUtf8Bytes("refund"));
    const extra = ethers.parseEther("0.7");
    const before = await ethers.provider.getBalance(alice.address);
    const tx = await c
      .connect(alice)
      .breedAgents(agentA.address, agentB.address, id, 2, 50, { value: BREED + SPAWN + extra });
    const rc = await tx.wait();
    const after = await ethers.provider.getBalance(alice.address);
    const spent = before - after - rc.gasUsed * rc.gasPrice;
    assert.equal(spent, BREED + SPAWN, "should have been charged exactly breedCost + spawnFee");
  });

  await check("spawnBredAgent needs no value — escrow funds the provision", async () => {
    const { c, id } = await withBredOffspring();
    const before = await ethers.provider.getBalance(offspring.address);
    await (await c.connect(alice).spawnBredAgent(offspring.address, id)).wait();
    const after = await ethers.provider.getBalance(offspring.address);
    assert.equal(after - before, PROVISION, "offspring should be provisioned from escrow");
    assert.equal(await c.pendingProvisionEscrow(), 0n, "escrow should be released");
  });

  await check("offspring is owned by whoever paid to breed it", async () => {
    const { c, id } = await withBredOffspring();
    await (await c.connect(alice).spawnBredAgent(offspring.address, id)).wait();
    assert.equal(await c.agentOwner(offspring.address), alice.address);
  });

  await check("spawnBredAgent cannot activate the same offspring twice", async () => {
    const { c, id } = await withBredOffspring();
    await (await c.connect(alice).spawnBredAgent(offspring.address, id)).wait();
    await expectRevert(
      c.connect(alice).spawnBredAgent(bob.address, id),
      "already activated",
    );
  });

  await check("spawnBredAgent rejects a stranger", async () => {
    const { c, id } = await withBredOffspring();
    await expectRevert(c.connect(bob).spawnBredAgent(offspring.address, id), "breeder");
  });

  await check("backend (MINTER_ROLE) may still activate on the breeder's behalf", async () => {
    const { c, id } = await withBredOffspring();
    await (await c.connect(deployer).spawnBredAgent(offspring.address, id)).wait();
    assert.equal(await c.agentOwner(offspring.address), alice.address, "owner is the breeder, not the caller");
  });

  // ── Proposal recording: no MINTER_ROLE required ─────────────────────────
  console.log("\nProposal recording (no platform minter)");

  const HASH = ethers.keccak256(ethers.toUtf8Bytes("proposal-1"));

  await check("the agent's owner can record a proposal", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (await c.connect(alice).recordExecutedProposal(agentA.address, HASH)).wait();
    const stats = await c.getAgentStats(agentA.address);
    assert.equal(stats.proposalsApproved, 1n);
    assert.equal(stats.heritageScore, 5n);
  });

  await check("the agent itself can record a proposal (Mode B)", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (await c.connect(agentA).recordExecutedProposal(agentA.address, HASH)).wait();
    assert.equal((await c.getAgentStats(agentA.address)).proposalsApproved, 1n);
  });

  await check("a stranger cannot record a proposal", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await expectRevert(c.connect(bob).recordExecutedProposal(agentA.address, HASH));
  });

  await check("the same proposal hash cannot be replayed for more heritage", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (await c.connect(alice).recordExecutedProposal(agentA.address, HASH)).wait();
    await expectRevert(c.connect(alice).recordExecutedProposal(agentA.address, HASH));
  });

  // ── Marketplace primitive ───────────────────────────────────────────────
  console.log("\nAgent transfer (marketplace)");

  await check("owner can transfer the agent, stats stay with the agent", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (await c.connect(alice).recordExecutedProposal(agentA.address, HASH)).wait();
    await (await c.connect(alice).transferAgentOwnership(agentA.address, bob.address)).wait();

    assert.equal(await c.agentOwner(agentA.address), bob.address);
    const stats = await c.getAgentStats(agentA.address);
    assert.equal(stats.heritageScore, 5n, "earned heritage must survive the sale");
    assert.equal(await c.isAgentSpawned(agentA.address), true, "agent stays spawned");
  });

  await check("the previous owner loses control after the sale", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (await c.connect(alice).transferAgentOwnership(agentA.address, bob.address)).wait();
    await expectRevert(c.connect(alice).transferAgentOwnership(agentA.address, alice.address));
  });

  await check("the new owner can record proposals", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (await c.connect(alice).transferAgentOwnership(agentA.address, bob.address)).wait();
    await (await c.connect(bob).recordExecutedProposal(agentA.address, HASH)).wait();
    assert.equal((await c.getAgentStats(agentA.address)).proposalsApproved, 1n);
  });

  await check("an approved marketplace can settle a transfer", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (await c.setMarketplaceApproval(marketplace.address, true)).wait();
    await (await c.connect(marketplace).transferAgentOwnership(agentA.address, bob.address)).wait();
    assert.equal(await c.agentOwner(agentA.address), bob.address);
  });

  await check("an unapproved marketplace cannot", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await expectRevert(c.connect(marketplace).transferAgentOwnership(agentA.address, bob.address));
  });

  await check("transfer emits AgentOwnershipTransferred for the backend to react to", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    const rc = await (
      await c.connect(alice).transferAgentOwnership(agentA.address, bob.address)
    ).wait();
    const ev = rc.logs
      .map((l) => { try { return c.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "AgentOwnershipTransferred");
    assert.ok(ev, "event not emitted");
    assert.equal(ev.args.previousOwner, alice.address);
    assert.equal(ev.args.newOwner, bob.address);
  });

  // ── Treasury safety ─────────────────────────────────────────────────────
  console.log("\nTreasury");

  await check("withdraw cannot drain escrow owed to an unactivated offspring", async () => {
    const { c, id } = await withBredOffspring();
    await (await c.withdrawPlatformFees()).wait();
    assert.equal(
      await ethers.provider.getBalance(await c.getAddress()),
      SPAWN,
      "the offspring's escrowed spawn fee must remain",
    );
    // and the offspring can still be activated afterwards
    await (await c.connect(alice).spawnBredAgent(offspring.address, id)).wait();
    assert.equal(await c.isAgentSpawned(offspring.address), true);
  });

  // ── Regression: V4 behaviour that must not break ────────────────────────
  console.log("\nRegression (V4 behaviour preserved)");

  await check("Mode B self-mint still works", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (
      await c.connect(agentA).mintAttendanceNFT(agentA.address, "T", "u", "yt", "A", "s", "n")
    ).wait();
    assert.equal(await c.balanceOf(agentA.address), 1n);
  });

  await check("Mode A backend mint still works", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (
      await c.connect(deployer).mintAttendanceNFT(agentA.address, "T", "u", "yt", "A", "s", "n")
    ).wait();
    assert.equal(await c.balanceOf(agentA.address), 1n);
  });

  await check("an unspawned stranger still cannot mint", async () => {
    const c = await fresh();
    await expectRevert(
      c.connect(bob).mintAttendanceNFT(bob.address, "T", "u", "yt", "A", "s", "n"),
    );
  });

  await check("levelling and wisdom unlock still fire", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    for (let i = 0; i < 5; i++) {
      await (
        await c.connect(agentA).mintAttendanceNFT(agentA.address, `T${i}`, "u", "yt", "A", "s", "n")
      ).wait();
    }
    const stats = await c.getAgentStats(agentA.address);
    assert.equal(stats.totalEvents, 5n);
    assert.equal(stats.currentLevel, 3n, "(5 / 2) + 1");
    assert.equal(stats.wisdomUnlocked, true);
  });

  await check("setFees / setBreedCost still owner-only and mutable", async () => {
    const c = await fresh();
    await (await c.setFees(ethers.parseEther("0.02"), ethers.parseEther("0.01"))).wait();
    assert.equal(await c.spawnFee(), ethers.parseEther("0.02"));
    await expectRevert(c.connect(bob).setFees(1n, 1n));
  });

  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

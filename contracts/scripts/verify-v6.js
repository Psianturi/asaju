/**
 * Pre-deploy verification for AsajuAgentV6.
 *
 * V6's entire reason to exist is: no platform-held key can act on a user's
 * behalf anymore. Every check here either proves that removal held, or
 * re-proves V5 behaviour that must survive unchanged.
 *
 *   npx hardhat run scripts/verify-v6.js
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
    const F = await ethers.getContractFactory("AsajuAgentV6");
    const c = await F.deploy();
    await c.waitForDeployment();
    return c;
  };

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

  console.log("\nAsajuAgentV6 — pre-deploy verification\n");

  // ── No role left ─────────────────────────────────────────────────────────
  console.log("MINTER_ROLE is gone, not just unused");

  await check("deployer has no special mint power over another agent", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    // deployer is the contract owner, but owner() must not be able to mint
    // for an agent it doesn't control — only the agent's own wallet can.
    await expectRevert(
      c.connect(deployer).mintAttendanceNFT(agentA.address, "T", "u", "yt", "A", "s", "n"),
    );
  });

  await check("deployer cannot activate a bred offspring on the breeder's behalf", async () => {
    const { c, id } = await withBredOffspring();
    await expectRevert(c.connect(deployer).spawnBredAgent(offspring.address, id), "breeder");
  });

  await check("deployer cannot record a proposal on an agent's behalf", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    const hash = ethers.keccak256(ethers.toUtf8Bytes("p1"));
    await expectRevert(c.connect(deployer).recordExecutedProposal(agentA.address, hash));
  });

  await check("no grantMinterRole / revokeMinterRole / hasRole surface exists", async () => {
    const c = await fresh();
    assert.equal(typeof c.grantMinterRole, "undefined");
    assert.equal(typeof c.revokeMinterRole, "undefined");
    assert.equal(typeof c.hasRole, "undefined");
    assert.equal(typeof c.MINTER_ROLE, "undefined");
  });

  // ── Ownership registry (unchanged from V5) ──────────────────────────────
  console.log("\nAgent ownership (carried over from V5)");

  await check("spawnAgent records the spawner as owner", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    assert.equal(await c.agentOwner(agentA.address), alice.address);
  });

  await check("spawnAgent still provisions the agent wallet", async () => {
    const c = await fresh();
    const before = await ethers.provider.getBalance(agentA.address);
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    const after = await ethers.provider.getBalance(agentA.address);
    assert.equal(after - before, PROVISION);
  });

  // ── Breeding escrow (unchanged from V5) ─────────────────────────────────
  console.log("\nBreeding escrow (no platform subsidy)");

  await check("breedAgents escrows the offspring's spawn fee", async () => {
    const { c } = await withBredOffspring();
    assert.equal(await c.pendingProvisionEscrow(), SPAWN);
  });

  await check("only the breeder may activate the offspring — no fallback signer at all", async () => {
    const { c, id } = await withBredOffspring();
    await expectRevert(c.connect(bob).spawnBredAgent(offspring.address, id), "breeder");
    // the breeder themself still works:
    await (await c.connect(alice).spawnBredAgent(offspring.address, id)).wait();
    assert.equal(await c.agentOwner(offspring.address), alice.address);
  });

  await check("spawnBredAgent needs no value — escrow funds the provision", async () => {
    const { c, id } = await withBredOffspring();
    const before = await ethers.provider.getBalance(offspring.address);
    await (await c.connect(alice).spawnBredAgent(offspring.address, id)).wait();
    const after = await ethers.provider.getBalance(offspring.address);
    assert.equal(after - before, PROVISION);
    assert.equal(await c.pendingProvisionEscrow(), 0n);
  });

  // ── Proposal recording: owner or agent, executor now on-chain ──────────
  console.log("\nProposal recording (owner or agent only)");

  const HASH = ethers.keccak256(ethers.toUtf8Bytes("proposal-1"));

  await check("the agent's owner can record a proposal", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (await c.connect(alice).recordExecutedProposal(agentA.address, HASH)).wait();
    assert.equal((await c.getAgentStats(agentA.address)).proposalsApproved, 1n);
  });

  await check("the agent itself can record a proposal", async () => {
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

  await check("the same proposal hash cannot be replayed", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (await c.connect(alice).recordExecutedProposal(agentA.address, HASH)).wait();
    await expectRevert(c.connect(alice).recordExecutedProposal(agentA.address, HASH));
  });

  await check("ProposalExecuted keeps the exact V5 event shape (no topic0 drift)", async () => {
    // Deliberately unchanged from V5 — see the contract's comment on this
    // event. A changed signature would silently break the backend's existing
    // heritage-score parser, the same bug class test_abi_event_parity.py
    // exists to catch. Confirm both the args AND the computed topic0 match.
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    const rc = await (await c.connect(agentA).recordExecutedProposal(agentA.address, HASH)).wait();
    const ev = rc.logs
      .map((l) => { try { return c.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "ProposalExecuted");
    assert.ok(ev, "ProposalExecuted not emitted");
    assert.equal(ev.args.agentWallet, agentA.address);
    assert.equal(ev.args.proposalHash, HASH);
    const expectedTopic0 = ethers.keccak256(
      ethers.toUtf8Bytes("ProposalExecuted(address,bytes32,uint256,uint256,uint256)"),
    );
    assert.equal(rc.logs.find((l) => l.address === (c.target ?? c.address)).topics[0], expectedTopic0);
  });

  // ── New: gas floor ───────────────────────────────────────────────────────
  console.log("\nGas floor (minAgentBalanceForExecution)");

  await check("defaults to 0 — no floor unless an operator opts in", async () => {
    const c = await fresh();
    assert.equal(await c.minAgentBalanceForExecution(), 0n);
  });

  await check("only owner can set the floor", async () => {
    const c = await fresh();
    await expectRevert(c.connect(bob).setMinAgentBalanceForExecution(1n));
  });

  // Hardhat's default signers (agentA included) start pre-funded with a huge
  // genesis balance, so comparing them against a small floor proves nothing.
  // These three tests use a throwaway wallet with a real, honest zero start.
  const freshAgentWallet = () => ethers.Wallet.createRandom().connect(ethers.provider);

  await check("proposal execution reverts below the floor", async () => {
    const c = await fresh();
    const wallet = freshAgentWallet();
    await (await c.connect(alice).spawnAgent(wallet.address, { value: SPAWN })).wait();
    // wallet holds exactly PROVISION (0.5 ETH) from spawn — set the floor above that.
    await (await c.setMinAgentBalanceForExecution(PROVISION + 1n)).wait();
    await expectRevert(
      c.connect(alice).recordExecutedProposal(wallet.address, HASH),
      "below minimum",
    );
  });

  await check("proposal execution succeeds once the agent clears the floor", async () => {
    const c = await fresh();
    const wallet = freshAgentWallet();
    await (await c.connect(alice).spawnAgent(wallet.address, { value: SPAWN })).wait();
    await (await c.setMinAgentBalanceForExecution(PROVISION)).wait(); // exactly at floor
    await (await c.connect(alice).recordExecutedProposal(wallet.address, HASH)).wait();
    assert.equal((await c.getAgentStats(wallet.address)).proposalsApproved, 1n);
  });

  await check("the floor reads the agent's REAL balance, not a stale mapping", async () => {
    // Top up the agent directly (a plain transfer the contract never sees,
    // exactly how the frontend's "Top up gas" flow works) and confirm the
    // floor now clears — proving the check reads live balance, not tracked state.
    const c = await fresh();
    const wallet = freshAgentWallet();
    await (await c.connect(alice).spawnAgent(wallet.address, { value: SPAWN })).wait();
    await (await c.setMinAgentBalanceForExecution(SPAWN)).wait(); // above the 0.5 provision
    await expectRevert(c.connect(alice).recordExecutedProposal(wallet.address, HASH));
    await (await deployer.sendTransaction({ to: wallet.address, value: SPAWN })).wait();
    await (await c.connect(alice).recordExecutedProposal(wallet.address, HASH)).wait();
    assert.equal((await c.getAgentStats(wallet.address)).proposalsApproved, 1n);
  });

  // ── Marketplace primitive (unchanged from V5) ───────────────────────────
  console.log("\nAgent transfer (marketplace)");

  await check("owner can transfer the agent, stats stay with the agent", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (await c.connect(alice).recordExecutedProposal(agentA.address, HASH)).wait();
    await (await c.connect(alice).transferAgentOwnership(agentA.address, bob.address)).wait();
    assert.equal(await c.agentOwner(agentA.address), bob.address);
    assert.equal((await c.getAgentStats(agentA.address)).heritageScore, 5n);
  });

  await check("an approved marketplace can settle a transfer", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (await c.setMarketplaceApproval(marketplace.address, true)).wait();
    await (await c.connect(marketplace).transferAgentOwnership(agentA.address, bob.address)).wait();
    assert.equal(await c.agentOwner(agentA.address), bob.address);
  });

  // ── Treasury safety (unchanged from V5) ─────────────────────────────────
  console.log("\nTreasury");

  await check("withdraw cannot drain escrow owed to an unactivated offspring", async () => {
    const { c, id } = await withBredOffspring();
    await (await c.withdrawPlatformFees()).wait();
    assert.equal(await ethers.provider.getBalance(await c.getAddress()), SPAWN);
    await (await c.connect(alice).spawnBredAgent(offspring.address, id)).wait();
    assert.equal(await c.isAgentSpawned(offspring.address), true);
  });

  // ── Regression: V5/V4 behaviour that must not break ─────────────────────
  console.log("\nRegression (mint + fees)");

  await check("Mode B self-mint still works", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (
      await c.connect(agentA).mintAttendanceNFT(agentA.address, "T", "u", "yt", "A", "s", "n")
    ).wait();
    assert.equal(await c.balanceOf(agentA.address), 1n);
  });

  await check("an unspawned stranger cannot mint", async () => {
    const c = await fresh();
    await expectRevert(
      c.connect(bob).mintAttendanceNFT(bob.address, "T", "u", "yt", "A", "s", "n"),
    );
  });

  await check("an agent cannot mint to a different address", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await expectRevert(
      c.connect(agentA).mintAttendanceNFT(bob.address, "T", "u", "yt", "A", "s", "n"),
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
    assert.equal(stats.currentLevel, 3n);
    assert.equal(stats.wisdomUnlocked, true);
  });

  await check("setFees / setBreedCost still owner-only and mutable", async () => {
    const c = await fresh();
    await (await c.setFees(ethers.parseEther("0.02"), ethers.parseEther("0.01"))).wait();
    assert.equal(await c.spawnFee(), ethers.parseEther("0.02"));
    await expectRevert(c.connect(bob).setFees(1n, 1n));
  });

  await check("recordGasSpent: owner or agent only, no role needed", async () => {
    const c = await fresh();
    await (await c.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (await c.connect(agentA).recordGasSpent(agentA.address, 1000n)).wait();
    assert.equal((await c.getAgentStats(agentA.address)).totalGasSpent, 1000n);
    await expectRevert(c.connect(bob).recordGasSpent(agentA.address, 1n));
  });

  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup, spawn, mint, reverts, ONE } from "./helpers.js";

describe("AsajuAgentV6 — spawning", () => {
  it("records the owner and forwards the gas provision to the agent wallet", async () => {
    const { ethers, agent, alice } = await setup();
    const wallet = await spawn(ethers, agent, alice);
    assert.equal(await agent.agentOwner(wallet.address), alice.address);
    assert.equal(await agent.isAgentSpawned(wallet.address), true);
    assert.equal(await ethers.provider.getBalance(wallet.address), await agent.agentProvision());
  });

  it("refuses an underpaid spawn and a second spawn of the same wallet", async () => {
    const { ethers, agent, alice } = await setup();
    const w = ethers.Wallet.createRandom();
    await reverts(agent.connect(alice).spawnAgent(w.address, { value: 1n }), agent, "Insufficient spawn fee");
    await agent.connect(alice).spawnAgent(w.address, { value: await agent.spawnFee() });
    await reverts(agent.connect(alice).spawnAgent(w.address, { value: await agent.spawnFee() }), agent, "Agent already spawned");
  });
});

describe("AsajuAgentV6 — minting (agent self-mint only)", () => {
  it("lets a spawned agent mint to itself and levels it up every two lessons", async () => {
    const { ethers, agent, alice } = await setup();
    const wallet = await spawn(ethers, agent, alice);
    for (let i = 0; i < 5; i++) await mint(agent, wallet, `L${i}`);
    const stats = await agent.getAgentStats(wallet.address);
    assert.equal(stats.totalEvents, 5n);
    assert.equal(stats.currentLevel, 3n);
    assert.equal(stats.wisdomUnlocked, true);
    assert.equal(await agent.balanceOf(wallet.address), 5n);
  });

  it("refuses mints from the owner, from strangers, and to another address", async () => {
    const { ethers, agent, alice, bob } = await setup();
    const wallet = await spawn(ethers, agent, alice);
    await reverts(agent.connect(alice).mintAttendanceNFT(wallet.address, "t", "u", "p", "a", "s", "n"), agent, "UnauthorizedMinter");
    await reverts(agent.connect(bob).mintAttendanceNFT(bob.address, "t", "u", "p", "a", "s", "n"), agent, "UnauthorizedMinter");
    await reverts(agent.connect(wallet).mintAttendanceNFT(bob.address, "t", "u", "p", "a", "s", "n"), agent, "AgentCanOnlyMintForSelf");
  });
});

describe("AsajuAgentV6 — ownership", () => {
  it("lets the owner transfer, and refuses strangers and unapproved contracts", async () => {
    const { ethers, agent, alice, bob, carol } = await setup();
    const wallet = await spawn(ethers, agent, alice);
    await reverts(agent.connect(bob).transferAgentOwnership(wallet.address, bob.address), agent, "NotAgentOwner");
    await agent.connect(alice).transferAgentOwnership(wallet.address, carol.address);
    assert.equal(await agent.agentOwner(wallet.address), carol.address);
  });

  it("restricts marketplace approval and fee settings to the admin", async () => {
    const { agent, bob } = await setup();
    await reverts(agent.connect(bob).setMarketplaceApproval(bob.address, true), agent, "OwnableUnauthorizedAccount");
    await reverts(agent.connect(bob).setFees(1n, 1n), agent, "OwnableUnauthorizedAccount");
    await reverts(agent.connect(bob).withdrawPlatformFees(), agent, "OwnableUnauthorizedAccount");
  });

  it("KNOWN ISSUE (V7): an approved marketplace can move ANY agent, listed or not", async () => {
    // The admin key that approves marketplaces can, through any approved
    // contract (or by approving an EOA it controls), take every agent.
    const { ethers, agent, admin, alice, bob } = await setup();
    const wallet = await spawn(ethers, agent, alice);
    await agent.connect(admin).setMarketplaceApproval(bob.address, true);
    await agent.connect(bob).transferAgentOwnership(wallet.address, bob.address);
    assert.equal(await agent.agentOwner(wallet.address), bob.address);
  });
});

describe("AsajuAgentV6 — proposals and gas records", () => {
  it("counts each proposal hash once and only for the owner or the agent", async () => {
    const { ethers, agent, alice, bob } = await setup();
    const wallet = await spawn(ethers, agent, alice);
    const h = ethers.id("proposal-1");
    await reverts(agent.connect(bob).recordExecutedProposal(wallet.address, h), agent, "NotAgentOwner");
    await agent.connect(alice).recordExecutedProposal(wallet.address, h);
    await reverts(agent.connect(alice).recordExecutedProposal(wallet.address, h), agent, "ProposalAlreadyRecorded");
    assert.equal((await agent.getAgentStats(wallet.address)).proposalsApproved, 1n);
  });

  it("KNOWN ISSUE (V7): recordGasSpent is self-reported and unbounded", async () => {
    // The agent wallet (whose key the backend holds) can write any number, so
    // on-chain "gas spent" is not evidence of anything.
    const { ethers, agent, alice } = await setup();
    const wallet = await spawn(ethers, agent, alice);
    await agent.connect(wallet).recordGasSpent(wallet.address, 10n ** 30n);
    assert.equal((await agent.getAgentStats(wallet.address)).totalGasSpent, 10n ** 30n);
  });

  it("keeps spawn fees (minus provision) withdrawable by the admin", async () => {
    const { ethers, agent, admin, alice } = await setup();
    await spawn(ethers, agent, alice);
    const expected = (await agent.spawnFee()) - (await agent.agentProvision());
    assert.equal(await ethers.provider.getBalance(await agent.getAddress()), expected);
    const before = await ethers.provider.getBalance(admin.address);
    const r = await (await agent.connect(admin).withdrawPlatformFees()).wait();
    const after = await ethers.provider.getBalance(admin.address);
    assert.equal(after - before + r.gasUsed * r.gasPrice, expected);
    assert.ok(expected > 0n && expected < ONE);
  });
});

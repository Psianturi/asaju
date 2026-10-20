import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup, spawn, reverts, ONE } from "./helpers.js";

async function market(feeBps = 1200n) {
  const env = await setup();
  const m = await env.ethers.deployContract("AsajuMarketplace", [await env.agent.getAddress(), feeBps]);
  await env.agent.connect(env.admin).setMarketplaceApproval(await m.getAddress(), true);
  return { ...env, m };
}

describe("AsajuMarketplace (native coin)", () => {
  it("only the owner can list, at a non-zero price, once", async () => {
    const { ethers, agent, m, alice, bob } = await market();
    const w = await spawn(ethers, agent, alice);
    await reverts(m.connect(bob).list(w.address, ONE), m, "NotAgentOwner");
    await reverts(m.connect(alice).list(w.address, 0n), m, "PriceZero");
    await m.connect(alice).list(w.address, ONE);
    await reverts(m.connect(alice).list(w.address, ONE), m, "AlreadyListed");
  });

  it("buy settles atomically: ownership to buyer, price minus fee to seller, overpay refunded", async () => {
    const { ethers, agent, m, alice, bob } = await market();
    const w = await spawn(ethers, agent, alice);
    await m.connect(alice).list(w.address, ONE);
    const sellerBefore = await ethers.provider.getBalance(alice.address);
    const buyerBefore = await ethers.provider.getBalance(bob.address);
    const r = await (await m.connect(bob).buy(w.address, { value: 2n * ONE })).wait();
    assert.equal(await agent.agentOwner(w.address), bob.address);
    assert.equal(await ethers.provider.getBalance(alice.address) - sellerBefore, ONE - ONE * 1200n / 10000n);
    assert.equal(buyerBefore - (await ethers.provider.getBalance(bob.address)), ONE + r.gasUsed * r.gasPrice);
    assert.equal(await m.accumulatedFees(), ONE * 1200n / 10000n);
    assert.equal((await m.listings(w.address)).active, false);
  });

  it("refuses underpayment, cancel by non-seller, and fees above the 20% cap", async () => {
    const { ethers, agent, m, alice, bob } = await market();
    const w = await spawn(ethers, agent, alice);
    await m.connect(alice).list(w.address, ONE);
    await reverts(m.connect(bob).buy(w.address, { value: ONE - 1n }), m, "InsufficientPayment");
    await reverts(m.connect(bob).cancel(w.address), m, "NotSeller");
    await reverts(m.setFeeBps(2001n), m, "FeeTooHigh");
  });

  it("a buy reverts entirely if the escrow is not an approved marketplace", async () => {
    const { ethers, agent, m, admin, alice, bob } = await market();
    const w = await spawn(ethers, agent, alice);
    await m.connect(alice).list(w.address, ONE);
    await agent.connect(admin).setMarketplaceApproval(await m.getAddress(), false);
    await reverts(m.connect(bob).buy(w.address, { value: ONE }), agent, "NotAgentOwner");
    assert.equal(await agent.agentOwner(w.address), alice.address);
  });

  it("KNOWN ISSUE (V7): a listing left behind blocks the new owner from listing", async () => {
    const { ethers, agent, m, alice, bob } = await market();
    const w = await spawn(ethers, agent, alice);
    await m.connect(alice).list(w.address, ONE);
    await agent.connect(alice).transferAgentOwnership(w.address, bob.address); // off-market
    await reverts(m.connect(bob).list(w.address, ONE), m, "AlreadyListed");   // new owner stuck
    await reverts(m.connect(bob).buy(w.address, { value: ONE }), m, "NotSeller"); // and it can't be bought
  });

  it("KNOWN ISSUE (V7): the fee is read at sale time, not fixed when listing", async () => {
    const { ethers, agent, m, alice, bob } = await market(250n);
    const w = await spawn(ethers, agent, alice);
    await m.connect(alice).list(w.address, ONE);            // seller agreed to 2.5%
    await m.setFeeBps(2000n);                               // admin raises to 20%
    const before = await ethers.provider.getBalance(alice.address);
    await m.connect(bob).buy(w.address, { value: ONE });
    assert.equal(await ethers.provider.getBalance(alice.address) - before, ONE - ONE * 2000n / 10000n);
  });
});

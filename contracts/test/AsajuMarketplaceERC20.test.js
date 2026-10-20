import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setup, spawn, reverts, ONE } from "./helpers.js";

async function market() {
  const env = await setup();
  const token = await env.ethers.deployContract("MockERC20");
  const m = await env.ethers.deployContract("AsajuMarketplaceERC20", [await env.agent.getAddress(), await token.getAddress(), 1200n]);
  await env.agent.connect(env.admin).setMarketplaceApproval(await m.getAddress(), true);
  await token.mint(env.bob.address, 1000n * ONE);
  return { ...env, token, m };
}

describe("AsajuMarketplaceERC20 (ASA)", () => {
  it("buy pulls the price in tokens and pays the seller minus the fee", async () => {
    const { ethers, agent, token, m, alice, bob } = await market();
    const w = await spawn(ethers, agent, alice);
    await m.connect(alice).list(w.address, 10n * ONE);
    await token.connect(bob).approve(await m.getAddress(), 10n * ONE);
    await m.connect(bob).buy(w.address);
    assert.equal(await agent.agentOwner(w.address), bob.address);
    assert.equal(await token.balanceOf(alice.address), 10n * ONE - 10n * ONE * 1200n / 10000n);
    assert.equal(await m.accumulatedFees(), 10n * ONE * 1200n / 10000n);
  });

  it("a buy without enough allowance changes nothing", async () => {
    const { ethers, agent, token, m, alice, bob } = await market();
    const w = await spawn(ethers, agent, alice);
    await m.connect(alice).list(w.address, 10n * ONE);
    await token.connect(bob).approve(await m.getAddress(), ONE);
    await reverts(m.connect(bob).buy(w.address), token, "ERC20InsufficientAllowance");
    assert.equal(await agent.agentOwner(w.address), alice.address);
  });

  it("KNOWN ISSUE (V7): no max price — a seller can reprice under a buyer's pending purchase", async () => {
    const { ethers, agent, token, m, alice, bob } = await market();
    const w = await spawn(ethers, agent, alice);
    await m.connect(alice).list(w.address, 10n * ONE);
    await token.connect(bob).approve(await m.getAddress(), 1000n * ONE); // common "approve max"
    // Seeing bob's buy in the mempool, alice cancels and relists higher first.
    await m.connect(alice).cancel(w.address);
    await m.connect(alice).list(w.address, 500n * ONE);
    await m.connect(bob).buy(w.address);
    assert.equal(await token.balanceOf(bob.address), 500n * ONE); // paid 500, expected 10
  });
});

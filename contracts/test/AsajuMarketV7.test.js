import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reverts } from "./helpers.js";
import { setupV7, deployMarket, spawnV7, tokenIdOf, now, warp, ONE, DAY } from "./v7helpers.js";

const MAX = (1n << 128n) - 1n;

async function listed(env, price = ONE, opts = {}) {
  const m = opts.market ?? await deployMarket(env, opts);
  const w = await spawnV7(env.ethers, env.agent, env.alice);
  const tid = tokenIdOf(w.address);
  await env.agent.connect(env.alice).approve(await m.getAddress(), tid);
  await m.connect(env.alice).list(tid, price, (await now(env.ethers)) + 30n * DAY);
  return { m, w, tid };
}

describe("AsajuMarketV7 (native) — listing", () => {
  it("only the owner lists, with approval, a price and a bounded expiry", async () => {
    const env = await setupV7();
    const { ethers, agent, alice, bob } = env;
    const m = await deployMarket(env);
    const w = await spawnV7(ethers, agent, alice);
    const tid = tokenIdOf(w.address);
    const t = await now(ethers);
    await reverts(m.connect(alice).list(tid, ONE, t + DAY), m, "NotApproved");
    await agent.connect(alice).setApprovalForAll(await m.getAddress(), true);
    await reverts(m.connect(bob).list(tid, ONE, t + DAY), m, "NotOwner");
    await reverts(m.connect(alice).list(tid, 0n, t + DAY), m, "PriceZero");
    await reverts(m.connect(alice).list(tid, ONE, t), m, "BadExpiry");
    await reverts(m.connect(alice).list(tid, ONE, t + 181n * DAY), m, "BadExpiry");
    await m.connect(alice).list(tid, ONE, t + DAY);
    assert.equal(await m.isListingValid(tid), true);
  });

  it("V7 FIX: a listing left by a previous owner never blocks the new owner", async () => {
    const env = await setupV7();
    const { agent, alice, bob, ethers } = env;
    const { m, tid } = await listed(env);
    await agent.connect(alice).transferFrom(alice.address, bob.address, tid); // sold elsewhere
    assert.equal(await m.isListingValid(tid), false);
    await agent.connect(bob).approve(await m.getAddress(), tid);
    await m.connect(bob).list(tid, 2n * ONE, (await now(ethers)) + DAY);
    assert.equal((await m.listings(tid)).seller, bob.address);
  });

  it("a listing does not come back to life when the token returns to the seller", async () => {
    const env = await setupV7();
    const { agent, alice, bob, dave } = env;
    const { m, tid } = await listed(env);
    await agent.connect(alice).setApprovalForAll(await m.getAddress(), true);
    await agent.connect(alice).transferFrom(alice.address, bob.address, tid);
    await agent.connect(bob).transferFrom(bob.address, alice.address, tid);
    await reverts(m.connect(dave).buy(tid, ONE, { value: ONE }), m, "ListingStale");
  });

  it("the seller or the current owner can cancel; strangers cannot", async () => {
    const env = await setupV7();
    const { m, tid } = await listed(env);
    await reverts(m.connect(env.bob).cancel(tid), m, "NotAuthorized");
    await m.connect(env.alice).cancel(tid);
    await reverts(m.connect(env.alice).cancel(tid), m, "NotListed");
  });
});

describe("AsajuMarketV7 (native) — buying", () => {
  it("settles: Passport to buyer, credits split seller / creator / treasury, pulled later", async () => {
    const env = await setupV7();
    const { ethers, agent, alice, bob, carol, dave } = env;
    // Creator alice sells to bob; bob re-sells to dave so royalty and seller differ.
    const { m, tid } = await listed(env, ONE);
    await m.connect(bob).buy(tid, ONE, { value: ONE });
    assert.equal(await agent.ownerOf(tid), bob.address);
    await agent.connect(bob).approve(await m.getAddress(), tid);
    await m.connect(bob).list(tid, 4n * ONE, (await now(ethers)) + DAY);
    await m.connect(dave).buy(tid, 4n * ONE, { value: 4n * ONE });

    const fee = 4n * ONE * 250n / 10000n, royalty = 4n * ONE * 250n / 10000n;
    assert.equal(await m.credits(bob.address), 4n * ONE - fee - royalty);
    assert.equal(await m.credits(alice.address), (ONE - 2n * (ONE * 250n / 10000n)) + ONE * 250n / 10000n + royalty);
    assert.equal(await m.credits(carol.address), ONE * 250n / 10000n + fee);
    assert.equal(await ethers.provider.getBalance(await m.getAddress()), await m.totalCredits());

    const before = await ethers.provider.getBalance(bob.address);
    const r = await (await m.connect(bob).withdraw()).wait();
    assert.equal(await ethers.provider.getBalance(bob.address) - before + r.gasUsed * r.gasPrice, 4n * ONE - fee - royalty);
    await reverts(m.connect(bob).withdraw(), m, "NothingToWithdraw");
  });

  it("V7 FIX: maxPrice stops a re-price under a pending purchase", async () => {
    const env = await setupV7();
    const { m, tid } = await listed(env, ONE);
    await env.agent.connect(env.alice).approve(await m.getAddress(), tid);
    await m.connect(env.alice).list(tid, 5n * ONE, (await now(env.ethers)) + DAY);
    await reverts(m.connect(env.bob).buy(tid, ONE, { value: 5n * ONE }), m, "PriceAboveMax");
  });

  it("V7 FIX: fee and royalty are fixed when listing", async () => {
    const env = await setupV7();
    const { m, tid } = await listed(env, ONE);
    await m.connect(env.admin).setFeeBps(1000);
    await env.agent.connect(env.admin).setRoyaltyBps(1000);
    await m.connect(env.bob).buy(tid, ONE, { value: ONE });
    assert.equal(await m.credits(env.carol.address), ONE * 250n / 10000n);
  });

  it("refuses wrong payment, expired listings and fees above 10%", async () => {
    const env = await setupV7();
    const { m, tid } = await listed(env, ONE);
    await reverts(m.connect(env.bob).buy(tid, MAX, { value: ONE - 1n }), m, "WrongPayment");
    await reverts(m.connect(env.bob).buy(tid, MAX, { value: ONE + 1n }), m, "WrongPayment");
    await reverts(m.connect(env.admin).setFeeBps(1001), m, "FeeTooHigh");
    await warp(env.ethers, 31n * DAY);
    await reverts(m.connect(env.bob).buy(tid, MAX, { value: ONE }), m, "ListingExpired");
  });

  it("a seller that rejects coin cannot block the sale (pull payments)", async () => {
    const env = await setupV7();
    const { ethers, agent, alice, bob } = env;
    const m = await deployMarket(env);
    const actor = await ethers.deployContract("MockActor");
    const w = await spawnV7(ethers, agent, alice);
    const tid = tokenIdOf(w.address);
    await agent.connect(alice).transferFrom(alice.address, await actor.getAddress(), tid);
    await actor.exec(await agent.getAddress(), agent.interface.encodeFunctionData("approve", [await m.getAddress(), tid]));
    await actor.exec(await m.getAddress(), m.interface.encodeFunctionData("list", [tid, ONE, (await now(ethers)) + DAY]));
    await m.connect(bob).buy(tid, ONE, { value: ONE });
    assert.equal(await agent.ownerOf(tid), bob.address);
    assert.ok((await m.credits(await actor.getAddress())) > 0n);
  });

  it("a buyer re-entering from onERC721Received gets nothing", async () => {
    const env = await setupV7();
    const { ethers, agent } = env;
    const { m, tid } = await listed(env, ONE);
    const second = await listed(env, ONE, { market: m });
    const actor = await ethers.deployContract("MockActor");
    await actor.setReentry(await m.getAddress(), m.interface.encodeFunctionData("buy", [second.tid, ONE]));
    await actor.exec(await m.getAddress(), m.interface.encodeFunctionData("buy", [tid, ONE]), { value: ONE });
    assert.equal(await actor.reenterSucceeded(), false);
    assert.equal(await agent.ownerOf(tid), await actor.getAddress());
    assert.equal(await agent.ownerOf(second.tid), env.alice.address);
  });

  it("pause stops trading but not withdrawals", async () => {
    const env = await setupV7();
    const { m, tid } = await listed(env, ONE);
    await m.connect(env.bob).buy(tid, ONE, { value: ONE });
    await m.connect(env.admin).pause();
    const second = await spawnV7(env.ethers, env.agent, env.alice);
    await env.agent.connect(env.alice).approve(await m.getAddress(), tokenIdOf(second.address));
    await reverts(m.connect(env.alice).list(tokenIdOf(second.address), ONE, (await now(env.ethers)) + DAY), m, "EnforcedPause");
    await m.connect(env.alice).withdraw();
  });
});

describe("AsajuMarketV7 (ERC-20)", () => {
  async function tokenEnv() {
    const env = await setupV7();
    const token = await env.ethers.deployContract("MockERC20");
    await token.mint(env.bob.address, 100n * ONE);
    return { env, token };
  }

  it("pulls exactly the price in tokens and refuses native coin", async () => {
    const { env, token } = await tokenEnv();
    const { m, tid } = await listed(env, 10n * ONE, { token });
    await token.connect(env.bob).approve(await m.getAddress(), 10n * ONE);
    await reverts(m.connect(env.bob).buy(tid, 10n * ONE, { value: 1n }), m, "WrongPayment");
    await m.connect(env.bob).buy(tid, 10n * ONE);
    assert.equal(await env.agent.ownerOf(tid), env.bob.address);
    assert.equal(await token.balanceOf(await m.getAddress()), await m.totalCredits());
    await m.connect(env.alice).withdraw();
    assert.equal(await token.balanceOf(env.alice.address), 10n * ONE - 2n * (10n * ONE * 250n / 10000n) + 10n * ONE * 250n / 10000n);
  });

  it("without allowance nothing changes", async () => {
    const { env, token } = await tokenEnv();
    const { m, tid } = await listed(env, 10n * ONE, { token });
    await token.connect(env.bob).approve(await m.getAddress(), ONE);
    await reverts(m.connect(env.bob).buy(tid, 10n * ONE), token, "ERC20InsufficientAllowance");
    assert.equal(await env.agent.ownerOf(tid), env.alice.address);
    assert.equal(await m.isListingValid(tid), true);
  });
});

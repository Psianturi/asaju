/**
 * verify-marketplace.js — local checks for AsajuMarketplace (Fase 2 escrow).
 *
 * Deploys AsajuAgentV6 + AsajuMarketplace on a fresh in-memory network, approves
 * the marketplace on the agent contract, and exercises the sale path end to end:
 * list, buy (atomic payment + ownership transfer + fee), refunds, cancel, the
 * stale-listing guard, the "not approved" guard, fee cap, and fee withdrawal.
 *
 * Run: npx hardhat run scripts/verify-marketplace.js
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
  const [deployer, alice, bob, charlie, agentA] = await ethers.getSigners();

  const SPAWN = ethers.parseEther("1");
  const PRICE = ethers.parseEther("10");
  const FEE_BPS = 1200n; // 12%

  // Deploy a V6 agent contract, approve a marketplace, and spawn one agent that
  // alice owns. Returns both contracts freshly wired.
  const setup = async ({ approve = true } = {}) => {
    const V6 = await ethers.getContractFactory("AsajuAgentV6");
    const agent = await V6.deploy();
    await agent.waitForDeployment();

    const M = await ethers.getContractFactory("AsajuMarketplace");
    const market = await M.deploy(await agent.getAddress(), FEE_BPS);
    await market.waitForDeployment();

    if (approve) {
      await (await agent.setMarketplaceApproval(await market.getAddress(), true)).wait();
    }
    await (await agent.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    return { agent, market };
  };

  console.log("\nAsajuMarketplace checks\n");

  await check("owner can list; non-owner cannot", async () => {
    const { market } = await setup();
    await (await market.connect(alice).list(agentA.address, PRICE)).wait();
    const l = await market.listings(agentA.address);
    assert.equal(l.seller, alice.address);
    assert.equal(l.price, PRICE);
    assert.equal(l.active, true);
    await expectRevert(market.connect(bob).list(agentA.address, PRICE)); // bob isn't the owner
  });

  await check("list rejects zero price", async () => {
    const { market } = await setup();
    await expectRevert(market.connect(alice).list(agentA.address, 0n));
  });

  await check("buy transfers ownership, pays seller minus fee, accrues fee", async () => {
    const { agent, market } = await setup();
    await (await market.connect(alice).list(agentA.address, PRICE)).wait();

    const sellerBefore = await ethers.provider.getBalance(alice.address);
    await (await market.connect(bob).buy(agentA.address, { value: PRICE })).wait();

    assert.equal(await agent.agentOwner(agentA.address), bob.address);
    const fee = (PRICE * FEE_BPS) / 10000n;
    const toSeller = PRICE - fee;
    // alice sent no tx, so her balance moves by exactly the payout.
    assert.equal((await ethers.provider.getBalance(alice.address)) - sellerBefore, toSeller);
    assert.equal(await market.accumulatedFees(), fee);
    // listing is cleared
    assert.equal((await market.listings(agentA.address)).active, false);
  });

  await check("buy refunds overpayment", async () => {
    const { market } = await setup();
    await (await market.connect(alice).list(agentA.address, PRICE)).wait();
    const over = ethers.parseEther("3");
    const bobBefore = await ethers.provider.getBalance(bob.address);
    const rc = await (await market.connect(bob).buy(agentA.address, { value: PRICE + over })).wait();
    const gas = rc.gasUsed * rc.gasPrice;
    // bob paid exactly PRICE + gas; the extra 3 ETH came back.
    assert.equal(bobBefore - (await ethers.provider.getBalance(bob.address)), PRICE + gas);
  });

  await check("buy rejects underpayment and unlisted agent", async () => {
    const { market } = await setup();
    await (await market.connect(alice).list(agentA.address, PRICE)).wait();
    await expectRevert(market.connect(bob).buy(agentA.address, { value: ethers.parseEther("9") }));
    await expectRevert(market.connect(bob).buy(charlie.address, { value: PRICE })); // never listed
  });

  await check("buy reverts (funds safe) when marketplace is not approved", async () => {
    const { agent, market } = await setup({ approve: false });
    await (await market.connect(alice).list(agentA.address, PRICE)).wait();
    const bobBefore = await ethers.provider.getBalance(bob.address);
    await expectRevert(market.connect(bob).buy(agentA.address, { value: PRICE }));
    // ownership unchanged, buyer not charged (beyond the reverted tx's gas)
    assert.equal(await agent.agentOwner(agentA.address), alice.address);
    assert.ok((await ethers.provider.getBalance(bob.address)) <= bobBefore);
    assert.equal(await market.accumulatedFees(), 0n);
  });

  await check("stale listing (seller transferred away) reverts, funds safe", async () => {
    const { agent, market } = await setup();
    await (await market.connect(alice).list(agentA.address, PRICE)).wait();
    // alice moves the agent off-market to charlie
    await (await agent.connect(alice).transferAgentOwnership(agentA.address, charlie.address)).wait();
    const bobBefore = await ethers.provider.getBalance(bob.address);
    await expectRevert(market.connect(bob).buy(agentA.address, { value: PRICE }));
    // Buyer not charged beyond gas; ownership stays with charlie. The dead
    // listing remains (revert rolls back any cleanup) until the seller cancels.
    assert.ok((await ethers.provider.getBalance(bob.address)) <= bobBefore);
    assert.equal(await agent.agentOwner(agentA.address), charlie.address);
    assert.equal(await market.accumulatedFees(), 0n);
  });

  await check("seller can cancel; non-seller cannot", async () => {
    const { market } = await setup();
    await (await market.connect(alice).list(agentA.address, PRICE)).wait();
    await expectRevert(market.connect(bob).cancel(agentA.address));
    await (await market.connect(alice).cancel(agentA.address)).wait();
    assert.equal((await market.listings(agentA.address)).active, false);
  });

  await check("fee is owner-only and capped at MAX_FEE_BPS", async () => {
    const { market } = await setup();
    await (await market.setFeeBps(1500n)).wait();
    assert.equal(await market.feeBps(), 1500n);
    await expectRevert(market.connect(bob).setFeeBps(100n));      // not owner
    await expectRevert(market.setFeeBps(2500n));                  // over 20% cap
  });

  await check("owner withdraws accumulated fees", async () => {
    const { market } = await setup();
    await (await market.connect(alice).list(agentA.address, PRICE)).wait();
    await (await market.connect(bob).buy(agentA.address, { value: PRICE })).wait();
    const fee = (PRICE * FEE_BPS) / 10000n;
    const toBefore = await ethers.provider.getBalance(charlie.address);
    await (await market.withdrawFees(charlie.address)).wait();
    assert.equal((await ethers.provider.getBalance(charlie.address)) - toBefore, fee);
    assert.equal(await market.accumulatedFees(), 0n);
    await expectRevert(market.connect(bob).withdrawFees(bob.address)); // not owner
  });

  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

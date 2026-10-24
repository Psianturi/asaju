/**
 * verify-marketplace-erc20.js — local checks for AsajuMarketplaceERC20.
 *
 * Mirrors verify-marketplace.js but settles in an ERC-20 (a MockERC20 standing
 * in for ASA): the buyer approves the marketplace for `price`, buy() pulls it
 * via safeTransferFrom, keeps the fee, pays the seller, and moves ownership
 * atomically. Covers list/cancel auth, the approval requirement, the fee cap,
 * the not-approved guard, the stale-listing guard, and fee withdrawal.
 *
 * Run: npx hardhat run scripts/verify-marketplace-erc20.js
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
  const PRICE = ethers.parseUnits("100", 18); // 100 ASA
  const FEE_BPS = 1200n; // 12%

  // Deploy V6 + token + ERC20 marketplace, approve the marketplace, spawn one
  // agent alice owns, and fund the buyer with tokens.
  const setup = async ({ approve = true } = {}) => {
    const V6 = await ethers.getContractFactory("AsajuAgentV6");
    const agent = await V6.deploy();
    await agent.waitForDeployment();

    const T = await ethers.getContractFactory("MockERC20");
    const token = await T.deploy();
    await token.waitForDeployment();

    const M = await ethers.getContractFactory("AsajuMarketplaceERC20");
    const market = await M.deploy(await agent.getAddress(), await token.getAddress(), FEE_BPS);
    await market.waitForDeployment();

    if (approve) {
      await (await agent.setMarketplaceApproval(await market.getAddress(), true)).wait();
    }
    await (await agent.connect(alice).spawnAgent(agentA.address, { value: SPAWN })).wait();
    await (await token.mint(bob.address, ethers.parseUnits("1000", 18))).wait();
    return { agent, token, market };
  };

  console.log("\nAsajuMarketplaceERC20 checks\n");

  await check("constructor rejects zero token/agent/fee>cap", async () => {
    const V6 = await ethers.getContractFactory("AsajuAgentV6");
    const agent = await V6.deploy(); await agent.waitForDeployment();
    const T = await ethers.getContractFactory("MockERC20");
    const token = await T.deploy(); await token.waitForDeployment();
    const M = await ethers.getContractFactory("AsajuMarketplaceERC20");
    await expectRevert(M.deploy(ethers.ZeroAddress, await token.getAddress(), FEE_BPS));
    await expectRevert(M.deploy(await agent.getAddress(), ethers.ZeroAddress, FEE_BPS));
    await expectRevert(M.deploy(await agent.getAddress(), await token.getAddress(), 2500n));
  });

  await check("owner can list; non-owner cannot; zero price rejected", async () => {
    const { market } = await setup();
    await (await market.connect(alice).list(agentA.address, PRICE)).wait();
    const l = await market.listings(agentA.address);
    assert.equal(l.seller, alice.address);
    assert.equal(l.price, PRICE);
    await expectRevert(market.connect(bob).list(agentA.address, PRICE)); // not the owner
    await expectRevert(market.connect(alice).list(charlie.address, 0n)); // zero price
  });

  await check("buy pulls token, pays seller minus fee, accrues fee, moves ownership", async () => {
    const { agent, token, market } = await setup();
    await (await market.connect(alice).list(agentA.address, PRICE)).wait();
    await (await token.connect(bob).approve(await market.getAddress(), PRICE)).wait();

    const sellerBefore = await token.balanceOf(alice.address);
    await (await market.connect(bob).buy(agentA.address)).wait();

    assert.equal(await agent.agentOwner(agentA.address), bob.address);
    const fee = (PRICE * FEE_BPS) / 10000n;
    assert.equal((await token.balanceOf(alice.address)) - sellerBefore, PRICE - fee);
    assert.equal(await market.accumulatedFees(), fee);
    assert.equal((await market.listings(agentA.address)).active, false);
  });

  await check("buy without allowance reverts (funds safe)", async () => {
    const { agent, token, market } = await setup();
    await (await market.connect(alice).list(agentA.address, PRICE)).wait();
    // no approve
    const bobBefore = await token.balanceOf(bob.address);
    await expectRevert(market.connect(bob).buy(agentA.address));
    assert.equal(await agent.agentOwner(agentA.address), alice.address);
    assert.equal(await token.balanceOf(bob.address), bobBefore);
  });

  await check("buy of unlisted agent reverts", async () => {
    const { market } = await setup();
    await expectRevert(market.connect(bob).buy(charlie.address));
  });

  await check("buy reverts (funds safe) when marketplace not approved on agent", async () => {
    const { agent, token, market } = await setup({ approve: false });
    await (await market.connect(alice).list(agentA.address, PRICE)).wait();
    await (await token.connect(bob).approve(await market.getAddress(), PRICE)).wait();
    const bobBefore = await token.balanceOf(bob.address);
    await expectRevert(market.connect(bob).buy(agentA.address));
    assert.equal(await agent.agentOwner(agentA.address), alice.address);
    assert.equal(await token.balanceOf(bob.address), bobBefore); // payment rolled back
    assert.equal(await market.accumulatedFees(), 0n);
  });

  await check("stale listing (seller transferred away) reverts, funds safe", async () => {
    const { agent, token, market } = await setup();
    await (await market.connect(alice).list(agentA.address, PRICE)).wait();
    await (await token.connect(bob).approve(await market.getAddress(), PRICE)).wait();
    await (await agent.connect(alice).transferAgentOwnership(agentA.address, charlie.address)).wait();
    const bobBefore = await token.balanceOf(bob.address);
    await expectRevert(market.connect(bob).buy(agentA.address));
    assert.equal(await token.balanceOf(bob.address), bobBefore);
    assert.equal(await agent.agentOwner(agentA.address), charlie.address);
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
    await expectRevert(market.connect(bob).setFeeBps(100n));
    await expectRevert(market.setFeeBps(2500n));
  });

  await check("owner withdraws accumulated fees in token", async () => {
    const { token, market } = await setup();
    await (await market.connect(alice).list(agentA.address, PRICE)).wait();
    await (await token.connect(bob).approve(await market.getAddress(), PRICE)).wait();
    await (await market.connect(bob).buy(agentA.address)).wait();
    const fee = (PRICE * FEE_BPS) / 10000n;
    const toBefore = await token.balanceOf(charlie.address);
    await (await market.withdrawFees(charlie.address)).wait();
    assert.equal((await token.balanceOf(charlie.address)) - toBefore, fee);
    assert.equal(await market.accumulatedFees(), 0n);
    await expectRevert(market.connect(bob).withdrawFees(bob.address));
  });

  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

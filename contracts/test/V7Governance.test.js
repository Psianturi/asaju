import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import { ZeroHash, id } from "ethers";
import { reverts } from "./helpers.js";
import { params, warp, ONE, DAY } from "./v7helpers.js";

describe("V7 governance — Safe → Timelock → contracts", () => {
  async function gov() {
    const { ethers } = await hre.network.connect();
    const [deployer, safe, guardian, treasury, stranger] = await ethers.getSigners();
    const timelock = await ethers.deployContract("AsajuTimelock", [2n * DAY, [safe.address], [safe.address]]);
    const tl = await timelock.getAddress();
    const agent = await ethers.deployContract("AsajuAgentV7", [params({ admin: tl, guardian: guardian.address })]);
    const market = await ethers.deployContract("AsajuMarketV7", [await agent.getAddress(), "0x0000000000000000000000000000000000000000", tl, guardian.address, treasury.address, 250]);
    return { ethers, deployer, safe, guardian, stranger, timelock, agent, market };
  }

  it("the deployer keeps no admin power", async () => {
    const { deployer, agent, market, timelock } = await gov();
    assert.equal(await agent.owner(), await timelock.getAddress());
    assert.equal(await market.owner(), await timelock.getAddress());
    await reverts(agent.connect(deployer).setFees(1n, 1n, 1n), agent, "OwnableUnauthorizedAccount");
    await reverts(market.connect(deployer).setFeeBps(0), market, "OwnableUnauthorizedAccount");
  });

  it("admin changes wait out the delay and only the multisig can schedule them", async () => {
    const { ethers, safe, stranger, timelock, agent } = await gov();
    const target = await agent.getAddress();
    const data = agent.interface.encodeFunctionData("setFees", [ONE, ONE / 2n, ONE]);
    const salt = id("fees-1");
    await reverts(timelock.connect(stranger).schedule(target, 0, data, ZeroHash, salt, 2n * DAY), timelock, "AccessControlUnauthorizedAccount");
    await reverts(timelock.connect(safe).schedule(target, 0, data, ZeroHash, salt, DAY), timelock, "TimelockInsufficientDelay");
    await timelock.connect(safe).schedule(target, 0, data, ZeroHash, salt, 2n * DAY);
    await reverts(timelock.connect(safe).execute(target, 0, data, ZeroHash, salt), timelock, "TimelockUnexpectedOperationState");
    await warp(ethers, 2n * DAY);
    await reverts(timelock.connect(stranger).execute(target, 0, data, ZeroHash, salt), timelock, "AccessControlUnauthorizedAccount");
    await timelock.connect(safe).execute(target, 0, data, ZeroHash, salt);
    assert.equal(await agent.spawnFee(), ONE);
  });

  it("the guardian pauses immediately, without the timelock", async () => {
    const { guardian, agent, market } = await gov();
    await agent.connect(guardian).pause();
    await market.connect(guardian).pause();
    assert.equal(await agent.paused(), true);
    assert.equal(await market.paused(), true);
  });
});

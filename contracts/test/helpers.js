import assert from "node:assert/strict";
import hre from "hardhat";

export const ONE = 10n ** 18n;

/** A fresh simulated chain per call, so tests never share state. */
export async function setup() {
  const { ethers } = await hre.network.connect();
  const [admin, alice, bob, carol] = await ethers.getSigners();
  const agent = await ethers.deployContract("AsajuAgentV6");
  return { ethers, admin, alice, bob, carol, agent };
}

/** Spawn an agent owned by `owner`; returns the agent's wallet (funded by the provision). */
export async function spawn(ethers, agent, owner) {
  const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
  await (await agent.connect(owner).spawnAgent(wallet.address, { value: await agent.spawnFee() })).wait();
  return wallet;
}

export async function mint(agent, wallet, title = "Lesson") {
  return (await agent.connect(wallet).mintAttendanceNFT(wallet.address, title, "https://youtu.be/x", "YouTube", "A", "summary", "Trading/Investment")).wait();
}

/** Assert a call reverts, by custom error name or revert string. */
export async function reverts(promise, contract, expected) {
  try {
    await (await promise).wait?.();
  } catch (e) {
    const data = e?.data ?? e?.error?.data ?? e?.info?.error?.data;
    let name;
    try { name = data ? contract.interface.parseError(data)?.name : undefined } catch { /* not a custom error */ }
    const text = `${name ?? ""} ${e?.shortMessage ?? ""} ${e?.message ?? ""}`;
    assert.ok(text.includes(expected), `expected revert "${expected}", got: ${text.slice(0, 300)}`);
    return;
  }
  assert.fail(`expected revert "${expected}" but the call succeeded`);
}

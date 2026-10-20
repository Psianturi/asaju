import hre from "hardhat";
import { id } from "ethers";

export const ONE = 10n ** 18n;
export const DAY = 86400n;
export const LEGACY = { None: 0, V6: 1, V4: 2 };

export function params(over = {}) {
  return {
    admin: over.admin,
    guardian: over.guardian ?? over.admin,
    spawnFee: ONE / 100n,
    agentProvision: ONE / 200n,
    breedCost: ONE / 50n,
    royaltyBps: 250,
    legacy: "0x0000000000000000000000000000000000000000",
    legacyKind: LEGACY.None,
    migrationSigner: "0x0000000000000000000000000000000000000000",
    migrationWindow: 0,
    imageBaseURI: "",
    chainLabel: "Hardhat",
    ...over,
  };
}

/** Fresh chain; V7 owned by `admin` directly (timelock is tested on its own). */
export async function setupV7(over = {}) {
  const { ethers } = await hre.network.connect();
  const [admin, alice, bob, carol, dave] = await ethers.getSigners();
  const agent = await ethers.deployContract("AsajuAgentV7", [params({ admin: admin.address, ...over })]);
  return { ethers, admin, alice, bob, carol, dave, agent };
}

export async function deployMarket(env, { token = null, feeBps = 250 } = {}) {
  const tokenAddr = token ? await token.getAddress() : "0x0000000000000000000000000000000000000000";
  return env.ethers.deployContract("AsajuMarketV7", [
    await env.agent.getAddress(), tokenAddr, env.admin.address, env.admin.address, env.carol.address, feeBps,
  ]);
}

/** The agent wallet's EIP-712 consent to be spawned for `owner`. */
export async function consent(agent, wallet, owner) {
  const { chainId } = await agent.runner.provider.getNetwork();
  return wallet.signTypedData(
    { name: "AsajuAgentV7", version: "1", chainId, verifyingContract: await agent.getAddress() },
    { SpawnConsent: [{ name: "agentWallet", type: "address" }, { name: "owner", type: "address" }] },
    { agentWallet: wallet.address, owner: owner.address ?? owner },
  );
}

/** Spawn an agent owned by `owner`; returns its funded wallet signer. */
export async function spawnV7(ethers, agent, owner) {
  const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
  await (await agent.connect(owner).spawnAgent(wallet.address, await consent(agent, wallet, owner), { value: await agent.spawnFee() })).wait();
  return wallet;
}

export async function lessons(agent, wallet, n) {
  for (let i = 0; i < n; i++) {
    await (await agent.connect(wallet).recordLesson(wallet.address, id(`lesson-${i}`), `ipfs://lesson/${i}`)).wait();
  }
}

export const tokenIdOf = (addr) => BigInt(addr);

export async function now(ethers) {
  return BigInt((await ethers.provider.getBlock("latest")).timestamp);
}

export async function warp(ethers, seconds) {
  await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
  await ethers.provider.send("evm_mine", []);
}

export function decodeTokenURI(uri) {
  const b64 = uri.replace("data:application/json;base64,", "");
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

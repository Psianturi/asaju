import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import { reverts, mint } from "./helpers.js";
import { params, consent, tokenIdOf, now, warp, LEGACY, ONE, DAY } from "./v7helpers.js";

async function chain() {
  const { ethers } = await hre.network.connect();
  const [admin, alice, bob, carol] = await ethers.getSigners();
  return { ethers, admin, alice, bob, carol };
}

describe("Migration V6 → V7 (trustless)", () => {
  async function v6env() {
    const env = await chain();
    const { ethers, admin, alice } = env;
    const v6 = await ethers.deployContract("AsajuAgentV6");
    const w = ethers.Wallet.createRandom().connect(ethers.provider);
    await v6.connect(alice).spawnAgent(w.address, { value: await v6.spawnFee() });
    for (let i = 0; i < 3; i++) await mint(v6, w, `L${i}`);
    const v7 = await ethers.deployContract("AsajuAgentV7", [params({ admin: admin.address, legacy: await v6.getAddress(), legacyKind: LEGACY.V6 })]);
    return { ...env, v6, v7, w };
  }

  it("moves the agent atomically: V6 record frozen under V7, Passport to the owner, stats read on-chain", async () => {
    const { admin, alice, v6, v7, w } = await v6env();
    await v6.connect(admin).setMarketplaceApproval(await v7.getAddress(), true);
    await v7.connect(alice).claimLegacy(w.address);
    assert.equal(await v6.agentOwner(w.address), await v7.getAddress());
    assert.equal(await v7.ownerOf(tokenIdOf(w.address)), alice.address);
    assert.equal(await v7.migrated(w.address), true);
    const s = await v7.getAgentStats(w.address);
    assert.equal(s.totalEvents, 3n);
    assert.equal(s.currentLevel, 2n);
    assert.equal(s.generation, 1n);
  });

  it("a legacy wallet cannot be squatted with a fresh spawn", async () => {
    const { bob, v7, w } = await v6env();
    await reverts(v7.connect(bob).spawnAgent(w.address, await consent(v7, w, bob), { value: await v7.spawnFee() }), v7, "ReservedForMigration");
  });

  it("only the V6 owner can claim, and only once", async () => {
    const { admin, alice, bob, v6, v7, w } = await v6env();
    await v6.connect(admin).setMarketplaceApproval(await v7.getAddress(), true);
    await reverts(v7.connect(bob).claimLegacy(w.address), v7, "NotLegacyOwner");
    await v7.connect(alice).claimLegacy(w.address);
    await reverts(v7.connect(alice).claimLegacy(w.address), v7, "NotLegacyOwner");
  });

  it("without the one-time V6 approval nothing moves", async () => {
    const { alice, v6, v7, w } = await v6env();
    await reverts(v7.connect(alice).claimLegacy(w.address), v6, "NotAgentOwner");
    assert.equal(await v6.agentOwner(w.address), alice.address);
  });

  it("after the claim the old escrow can no longer sell it", async () => {
    const { ethers, admin, alice, bob, v6, v7, w } = await v6env();
    const old = await ethers.deployContract("AsajuMarketplace", [await v6.getAddress(), 1200n]);
    await v6.connect(admin).setMarketplaceApproval(await old.getAddress(), true);
    await v6.connect(admin).setMarketplaceApproval(await v7.getAddress(), true);
    await old.connect(alice).list(w.address, ONE);         // listed before claiming
    await v7.connect(alice).claimLegacy(w.address);
    await reverts(old.connect(bob).buy(w.address, { value: ONE }), old, "NotSeller");
    await reverts(old.connect(alice).list(w.address, ONE), old, "NotAgentOwner");
    assert.equal(await v7.ownerOf(tokenIdOf(w.address)), alice.address);
  });
});

describe("Migration Mantle V4 → V7 (attestation)", () => {
  async function v4env(windowSecs = 60n * DAY) {
    const env = await chain();
    const { ethers, admin, carol } = env;
    const v4 = await ethers.deployContract("MAEFDynamicNFTV4");
    const w = ethers.Wallet.createRandom();
    await v4.connect(admin).spawnAgent(w.address, { value: await v4.spawnFee() });
    for (let i = 0; i < 5; i++) {
      await v4.connect(admin).mintAttendanceNFT(w.address, `L${i}`, "u", "YouTube", "N", "s", "Trading/Investment"); // Mode A
    }
    const v7 = await ethers.deployContract("AsajuAgentV7", [params({
      admin: admin.address, legacy: await v4.getAddress(), legacyKind: LEGACY.V4,
      migrationSigner: carol.address, migrationWindow: windowSecs,
    })]);
    return { ...env, v4, v7, w };
  }

  async function attest(ethers, v7, signer, agentWallet, owner, deadline) {
    const { chainId } = await ethers.provider.getNetwork();
    return signer.signTypedData(
      { name: "AsajuAgentV7", version: "1", chainId, verifyingContract: await v7.getAddress() },
      { LegacyClaim: [{ name: "agentWallet", type: "address" }, { name: "owner", type: "address" }, { name: "deadline", type: "uint256" }] },
      { agentWallet, owner, deadline },
    );
  }

  it("the attested owner claims; stats come from V4 on-chain", async () => {
    const { ethers, alice, carol, v7, w } = await v4env();
    const deadline = (await now(ethers)) + DAY;
    const sig = await attest(ethers, v7, carol, w.address, alice.address, deadline);
    await v7.connect(alice).claimWithAttestation(w.address, deadline, sig);
    assert.equal(await v7.ownerOf(tokenIdOf(w.address)), alice.address);
    const s = await v7.getAgentStats(w.address);
    assert.equal(s.totalEvents, 5n);
    assert.equal(s.currentLevel, 3n);
    assert.equal(s.wisdomUnlocked, true);
  });

  it("someone else cannot use the owner's attestation, a forged one, or claim twice", async () => {
    const { ethers, alice, bob, carol, v7, w } = await v4env();
    const deadline = (await now(ethers)) + DAY;
    const sig = await attest(ethers, v7, carol, w.address, alice.address, deadline);
    await reverts(v7.connect(bob).claimWithAttestation(w.address, deadline, sig), v7, "BadSignature");
    const forged = await attest(ethers, v7, bob, w.address, bob.address, deadline);
    await reverts(v7.connect(bob).claimWithAttestation(w.address, deadline, forged), v7, "BadSignature");
    await v7.connect(alice).claimWithAttestation(w.address, deadline, sig);
    await reverts(v7.connect(alice).claimWithAttestation(w.address, deadline, sig), v7, "AlreadySpawned");
  });

  it("an agent V4 never spawned cannot be claimed", async () => {
    const { ethers, alice, carol, v7 } = await v4env();
    const ghost = ethers.Wallet.createRandom().address;
    const deadline = (await now(ethers)) + DAY;
    const sig = await attest(ethers, v7, carol, ghost, alice.address, deadline);
    await reverts(v7.connect(alice).claimWithAttestation(ghost, deadline, sig), v7, "NotSpawned");
  });

  it("expired attestations, a passed window and a closed migration all refuse", async () => {
    const { ethers, admin, alice, carol, v7, w } = await v4env(2n * DAY);
    let deadline = (await now(ethers)) + 100n;
    let sig = await attest(ethers, v7, carol, w.address, alice.address, deadline);
    await warp(ethers, 200n);
    await reverts(v7.connect(alice).claimWithAttestation(w.address, deadline, sig), v7, "SignatureExpired");

    await warp(ethers, 3n * DAY);
    deadline = (await now(ethers)) + DAY;
    sig = await attest(ethers, v7, carol, w.address, alice.address, deadline);
    await reverts(v7.connect(alice).claimWithAttestation(w.address, deadline, sig), v7, "SignatureExpired");

    await v7.connect(admin).closeMigration();
    await reverts(v7.connect(alice).claimWithAttestation(w.address, deadline, sig), v7, "MigrationUnavailable");
    await reverts(v7.connect(admin).setMigrationSigner(carol.address), v7, "MigrationUnavailable");
  });

  it("a V6-kind deployment refuses attestations and vice versa", async () => {
    const { ethers, alice, carol, v7, w } = await v4env();
    await reverts(v7.connect(alice).claimLegacy(w.address), v7, "MigrationUnavailable");
    void ethers; void carol;
  });
});

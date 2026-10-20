import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, id, keccak256 } from "ethers";
import { reverts } from "./helpers.js";
import { setupV7, spawnV7, consent, lessons, tokenIdOf, warp, decodeTokenURI, ONE, DAY } from "./v7helpers.js";

const commitmentOf = (wallet, payload, salt) =>
  keccak256(AbiCoder.defaultAbiCoder().encode(["address", "bytes", "bytes32"], [wallet, payload, salt]));

describe("AsajuAgentV7 — spawn and Passport", () => {
  it("mints the Passport to the spawner, forwards the provision, keeps the rest as fee", async () => {
    const { ethers, agent, alice } = await setupV7();
    const w = ethers.Wallet.createRandom();
    const fee = await agent.spawnFee();
    await (await agent.connect(alice).spawnAgent(w.address, await consent(agent, w, alice), { value: fee })).wait();
    const tid = tokenIdOf(w.address);
    assert.equal(await agent.ownerOf(tid), alice.address);
    assert.equal(await agent.agentOwner(w.address), alice.address);
    assert.equal(await agent.creatorOf(tid), alice.address);
    assert.equal(await agent.isAgentSpawned(w.address), true);
    assert.equal(await ethers.provider.getBalance(w.address), await agent.agentProvision());
    assert.equal(await ethers.provider.getBalance(await agent.getAddress()), fee - (await agent.agentProvision()));
    assert.equal(await agent.getTotalMinted(), 1n);
  });

  it("requires the exact fee and refuses a second spawn of the same wallet", async () => {
    const { ethers, agent, alice, bob } = await setupV7();
    const w = ethers.Wallet.createRandom();
    const fee = await agent.spawnFee();
    const sig = await consent(agent, w, alice);
    await reverts(agent.connect(alice).spawnAgent(w.address, sig, { value: fee - 1n }), agent, "WrongPayment");
    await reverts(agent.connect(alice).spawnAgent(w.address, sig, { value: fee + 1n }), agent, "WrongPayment");
    await agent.connect(alice).spawnAgent(w.address, sig, { value: fee });
    await reverts(agent.connect(bob).spawnAgent(w.address, await consent(agent, w, bob), { value: fee }), agent, "AlreadySpawned");
  });

  it("V7 FIX: nobody can spawn a wallet without that wallet's consent", async () => {
    const { ethers, agent, alice, bob } = await setupV7();
    const w = ethers.Wallet.createRandom();
    const fee = await agent.spawnFee();
    const forAlice = await consent(agent, w, alice);
    await reverts(agent.connect(bob).spawnAgent(w.address, forAlice, { value: fee }), agent, "BadSignature"); // front-run with alice's consent
    await reverts(agent.connect(bob).spawnAgent(w.address, await consent(agent, ethers.Wallet.createRandom(), bob), { value: fee }), agent, "BadSignature");
    await agent.connect(alice).spawnAgent(w.address, forAlice, { value: fee });
    assert.equal(await agent.agentOwner(w.address), alice.address);
  });

  it("transfers like any ERC-721 and emits the V6 ownership event", async () => {
    const { ethers, agent, alice, bob } = await setupV7();
    const w = await spawnV7(ethers, agent, alice);
    const tid = tokenIdOf(w.address);
    const nonce = await agent.ownershipNonce(tid);
    const r = await (await agent.connect(alice).transferFrom(alice.address, bob.address, tid)).wait();
    const ev = r.logs.map((l) => { try { return agent.interface.parseLog(l) } catch { return null } }).find((e) => e?.name === "AgentOwnershipTransferred");
    assert.equal(ev.args.agentWallet, w.address);
    assert.equal(ev.args.previousOwner, alice.address);
    assert.equal(ev.args.newOwner, bob.address);
    assert.equal(await agent.agentOwner(w.address), bob.address);
    assert.equal(await agent.ownershipNonce(tid), nonce + 1n);
  });

  it("V7 FIX: no admin path can move someone else's agent", async () => {
    const { ethers, agent, admin, alice } = await setupV7();
    const w = await spawnV7(ethers, agent, alice);
    const tid = tokenIdOf(w.address);
    await reverts(agent.connect(admin).transferFrom(alice.address, admin.address, tid), agent, "ERC721InsufficientApproval");
    assert.equal(agent.interface.getFunction("setMarketplaceApproval"), null);
    assert.equal(agent.interface.getFunction("transferAgentOwnership"), null);
    assert.equal(await agent.ownerOf(tid), alice.address);
  });

  it("pause stops spawning but never stops an owner moving their Passport", async () => {
    const { ethers, agent, admin, alice, bob } = await setupV7();
    const w = await spawnV7(ethers, agent, alice);
    await agent.connect(admin).pause();
    const fresh = ethers.Wallet.createRandom();
    await reverts(agent.connect(alice).spawnAgent(fresh.address, await consent(agent, fresh, alice), { value: await agent.spawnFee() }), agent, "EnforcedPause");
    await agent.connect(alice).transferFrom(alice.address, bob.address, tokenIdOf(w.address));
    assert.equal(await agent.agentOwner(w.address), bob.address);
  });

  it("reports ERC-721, ERC-2981 and ERC-4906, and pays royalties to the creator", async () => {
    const { ethers, agent, alice, bob } = await setupV7();
    const w = await spawnV7(ethers, agent, alice);
    const tid = tokenIdOf(w.address);
    for (const iid of ["0x80ac58cd", "0x2a55205a", "0x49064906"]) assert.equal(await agent.supportsInterface(iid), true);
    await agent.connect(alice).transferFrom(alice.address, bob.address, tid);
    const [receiver, amount] = await agent.royaltyInfo(tid, 10_000n);
    assert.equal(receiver, alice.address); // creator, not current owner
    assert.equal(amount, 250n);
  });
});

describe("AsajuAgentV7 — lessons, level, metadata", () => {
  it("only the agent records lessons; level = lessons/2+1; wisdom at 5", async () => {
    const { ethers, agent, alice } = await setupV7();
    const w = await spawnV7(ethers, agent, alice);
    await reverts(agent.connect(alice).recordLesson(w.address, id("x"), ""), agent, "NotAuthorized");
    await lessons(agent, w, 5);
    const s = await agent.getAgentStats(w.address);
    assert.equal(s.totalEvents, 5n);
    assert.equal(s.currentLevel, 3n);
    assert.equal(s.wisdomUnlocked, true);
    assert.equal(s.totalGasSpent, 0n);
    assert.equal(await agent.lessonCount(w.address), 5n);
    assert.equal(await agent.lessonAt(w.address, 0), id("lesson-0"));
  });

  it("V7 FIX: recordGasSpent no longer exists", async () => {
    const { agent } = await setupV7();
    assert.equal(agent.interface.getFunction("recordGasSpent"), null);
  });

  it("serves on-chain JSON metadata that follows the agent's stats", async () => {
    const { ethers, agent, alice } = await setupV7({ imageBaseURI: "https://img.asaju.ai/" });
    const w = await spawnV7(ethers, agent, alice);
    await agent.connect(alice).setProfile(w.address, "Naruto", "Trading/Investment");
    await lessons(agent, w, 6);
    const meta = decodeTokenURI(await agent.tokenURI(tokenIdOf(w.address)));
    assert.equal(meta.name, "Naruto");
    assert.equal(meta.image, "https://img.asaju.ai/wisdom.png");
    const attr = Object.fromEntries(meta.attributes.map((a) => [a.trait_type, a.value]));
    assert.deepEqual(attr, { Niche: "Trading/Investment", Level: 4, Lessons: 6, Generation: 1, Wisdom: "Unlocked", Chain: "Hardhat" });
  });

  it("profile labels cannot break the JSON, and only the owner or agent may set them", async () => {
    const { ethers, agent, alice, bob } = await setupV7();
    const w = await spawnV7(ethers, agent, alice);
    await reverts(agent.connect(alice).setProfile(w.address, 'x","image":"evil', "n"), agent, "InvalidLabel");
    await reverts(agent.connect(alice).setProfile(w.address, "a\\b", "n"), agent, "InvalidLabel");
    await reverts(agent.connect(alice).setProfile(w.address, "x".repeat(33), "n"), agent, "InvalidLabel");
    await reverts(agent.connect(bob).setProfile(w.address, "mine", "n"), agent, "NotAuthorized");
    await agent.connect(w).setProfile(w.address, "Self named", "Technology");
    assert.equal(await agent.agentName(w.address), "Self named");
  });
});

describe("AsajuAgentV7 — breeding", () => {
  async function parents(env) {
    const a = await spawnV7(env.ethers, env.agent, env.alice);
    const b = await spawnV7(env.ethers, env.agent, env.alice);
    return [a, b];
  }
  const due = async (agent) => (await agent.breedCost()) + (await agent.spawnFee());

  it("V7 FIX: both parents must belong to the breeder", async () => {
    const env = await setupV7();
    const [a] = await parents(env);
    const c = await spawnV7(env.ethers, env.agent, env.bob);
    await reverts(env.agent.connect(env.alice).breedAgents(a.address, c.address, id("o1"), { value: await due(env.agent) }), env.agent, "NotParentOwner");
  });

  it("derives generation and heritage on-chain and escrows the exact provision", async () => {
    const env = await setupV7();
    const { ethers, agent, admin, alice, bob } = env;
    const [a, b] = await parents(env);
    await agent.connect(alice).breedAgents(a.address, b.address, id("o1"), { value: await due(agent) });
    const provisionAtBreed = await agent.agentProvision();
    assert.equal(await agent.pendingProvisionEscrow(), provisionAtBreed);

    // Fees change before activation: the offspring still gets what was prepaid.
    await agent.connect(admin).setFees(ONE / 10n, ONE / 20n, ONE / 50n);
    const off = ethers.Wallet.createRandom();
    await reverts(agent.connect(bob).spawnBredAgent(off.address, id("o1"), await consent(agent, off, bob)), agent, "NotAuthorized");
    await agent.connect(alice).spawnBredAgent(off.address, id("o1"), await consent(agent, off, alice));
    assert.equal(await ethers.provider.getBalance(off.address), provisionAtBreed);
    assert.equal(await agent.pendingProvisionEscrow(), 0n);
    assert.equal(await agent.ownerOf(tokenIdOf(off.address)), alice.address);
    const s = await agent.getAgentStats(off.address);
    assert.equal(s.generation, 2n);
    assert.equal(s.parent1Wallet, a.address);
    const again = ethers.Wallet.createRandom();
    await reverts(agent.connect(alice).spawnBredAgent(again.address, id("o1"), await consent(agent, again, alice)), agent, "OffspringAlreadySpawned");
  });

  it("enforces cooldown, breed limit, unique offspring ids and exact payment", async () => {
    const env = await setupV7();
    const { ethers, agent, alice } = env;
    const [a, b] = await parents(env);
    const v = await due(agent);
    await reverts(agent.connect(alice).breedAgents(a.address, b.address, id("o1"), { value: v - 1n }), agent, "WrongPayment");
    await reverts(agent.connect(alice).breedAgents(a.address, a.address, id("o1"), { value: v }), agent, "BreedNotAllowed");
    await agent.connect(alice).breedAgents(a.address, b.address, id("o1"), { value: v });
    await reverts(agent.connect(alice).breedAgents(a.address, b.address, id("o2"), { value: v }), agent, "BreedNotAllowed");
    await warp(ethers, DAY);
    await reverts(agent.connect(alice).breedAgents(a.address, b.address, id("o1"), { value: v }), agent, "OffspringIdTaken");
    await agent.connect(alice).breedAgents(a.address, b.address, id("o2"), { value: v });
    await warp(ethers, DAY);
    await agent.connect(alice).breedAgents(a.address, b.address, id("o3"), { value: v });
    await warp(ethers, DAY);
    await reverts(agent.connect(alice).breedAgents(a.address, b.address, id("o4"), { value: v }), agent, "BreedNotAllowed");
  });

  it("withdrawFees never touches prepaid provisions", async () => {
    const env = await setupV7();
    const { ethers, agent, admin, alice, dave } = env;
    const [a, b] = await parents(env);
    await agent.connect(alice).breedAgents(a.address, b.address, id("o1"), { value: await due(agent) });
    await agent.connect(admin).withdrawFees(dave.address);
    assert.equal(await ethers.provider.getBalance(await agent.getAddress()), await agent.pendingProvisionEscrow());
    await reverts(agent.connect(admin).withdrawFees(dave.address), agent, "NoFees");
    const off = ethers.Wallet.createRandom();
    await agent.connect(alice).spawnBredAgent(off.address, id("o1"), await consent(agent, off, alice));
  });
});

describe("AsajuAgentV7 — decisions and proposals", () => {
  it("commit by agent or owner, reveal only with the matching payload and salt, once", async () => {
    const { ethers, agent, alice, bob } = await setupV7();
    const w = await spawnV7(ethers, agent, alice);
    const payload = AbiCoder.defaultAbiCoder().encode(["string", "string"], ["BUY", "ETH"]);
    const salt = id("salt");
    const c = commitmentOf(w.address, payload, salt);
    await reverts(agent.connect(bob).commitDecision(w.address, c), agent, "NotAuthorized");
    await agent.connect(w).commitDecision(w.address, c);
    await agent.connect(alice).commitDecision(w.address, commitmentOf(w.address, "0x01", salt));
    assert.equal(await agent.decisionCount(w.address), 2n);
    await reverts(agent.connect(bob).revealDecision(w.address, 0, payload, id("wrong")), agent, "BadCommitment");
    await agent.connect(bob).revealDecision(w.address, 0, payload, salt);
    await reverts(agent.connect(bob).revealDecision(w.address, 0, payload, salt), agent, "AlreadyRevealed");
    const d = await agent.decisionAt(w.address, 0);
    assert.ok(d.revealedAt >= d.committedAt);
  });

  it("pause stops new commitments", async () => {
    const { ethers, agent, admin, alice } = await setupV7();
    const w = await spawnV7(ethers, agent, alice);
    await agent.connect(admin).pause();
    await reverts(agent.connect(w).commitDecision(w.address, id("c")), agent, "EnforcedPause");
  });

  it("proposal records count once and cap heritage at 100", async () => {
    const { ethers, agent, alice, bob } = await setupV7();
    const w = await spawnV7(ethers, agent, alice);
    await reverts(agent.connect(bob).recordExecutedProposal(w.address, id("p")), agent, "NotAuthorized");
    for (let i = 0; i < 22; i++) await agent.connect(alice).recordExecutedProposal(w.address, id(`p${i}`));
    await reverts(agent.connect(w).recordExecutedProposal(w.address, id("p0")), agent, "AlreadyRecorded");
    const s = await agent.getAgentStats(w.address);
    assert.equal(s.proposalsApproved, 22n);
    assert.equal(s.heritageScore, 100n);
  });
});

describe("AsajuAgentV7 — admin limits", () => {
  it("only the owner sets fees/royalty, within caps; guardian can only pause", async () => {
    const { ethers, agent, admin, alice, carol } = await setupV7();
    await reverts(agent.connect(alice).setFees(1n, 1n, 1n), agent, "OwnableUnauthorizedAccount");
    await reverts(agent.connect(admin).setFees(1n, 2n, 1n), agent, "ProvisionExceedsFee");
    await reverts(agent.connect(admin).setRoyaltyBps(1001), agent, "ValueTooHigh");
    await agent.connect(admin).setGuardian(carol.address);
    await agent.connect(carol).pause();
    await agent.connect(carol).unpause();
    await reverts(agent.connect(carol).setRoyaltyBps(10), agent, "OwnableUnauthorizedAccount");
    await reverts(agent.connect(alice).pause(), agent, "NotAuthorized");
    void ethers;
  });
});

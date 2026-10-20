import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { id } from "ethers";
import { setupV7, deployMarket, consent, tokenIdOf, now, warp, ONE, DAY } from "./v7helpers.js";

/**
 * Random action sequences against AgentV7 + MarketV7, checking the spec's
 * invariants after every step. Seeded, so a failure replays exactly.
 *   1. every spawned agent has exactly one Passport with a non-zero owner
 *   2. no admin action changes ownerOf (admin acts every few steps)
 *   3. agent balance >= pendingProvisionEscrow
 *   4. lesson counts only grow
 *   5. market balance == totalCredits == sum of everyone's credits
 */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) >>> 0) / 2 ** 32);
}

describe("V7 invariants (randomised)", () => {
  for (const seed of [1, 7, 42]) {
    it(`holds across 120 random steps (seed ${seed})`, async () => {
      const env = await setupV7();
      const { ethers, agent, admin } = env;
      const market = await deployMarket(env);
      const mAddr = await market.getAddress();
      const users = [env.alice, env.bob, env.dave];
      const accounts = [...users, env.carol];
      const agents = [];           // { wallet, lessons }
      const offspring = [];        // { id, breeder }
      const r = rng(seed);
      const pick = (arr) => arr[Math.floor(r() * arr.length)];
      const tryTx = async (p) => { try { await (await p).wait(); return true } catch { return false } };
      const done = { spawn: 0, lesson: 0, breed: 0, bred: 0, list: 0, buy: 0, transfer: 0, withdraw: 0 };

      for (let step = 0; step < 120; step++) {
        const action = Math.floor(r() * 9);
        const u = pick(users);
        if (action === 0 || agents.length < 2) {
          const w = ethers.Wallet.createRandom().connect(ethers.provider);
          if (await tryTx(agent.connect(u).spawnAgent(w.address, await consent(agent, w, u), { value: await agent.spawnFee() }))) { agents.push({ wallet: w, lessons: 0n }); done.spawn++; }
        } else if (action === 1) {
          const a = pick(agents);
          if (await tryTx(agent.connect(a.wallet).recordLesson(a.wallet.address, id(`s${step}`), ""))) { a.lessons++; done.lesson++; }
        } else if (action === 2) {
          const [a, b] = [pick(agents), pick(agents)];
          const oid = id(`o${seed}-${step}`);
          const due = (await agent.breedCost()) + (await agent.spawnFee());
          if (await tryTx(agent.connect(u).breedAgents(a.wallet.address, b.wallet.address, oid, { value: due }))) { offspring.push({ id: oid, breeder: u }); done.breed++; }
        } else if (action === 3 && offspring.length) {
          const o = offspring.shift();
          const w = ethers.Wallet.createRandom().connect(ethers.provider);
          if (await tryTx(agent.connect(o.breeder).spawnBredAgent(w.address, o.id, await consent(agent, w, o.breeder)))) { agents.push({ wallet: w, lessons: 0n }); done.bred++; }
        } else if (action === 4) {
          const a = pick(agents), tid = tokenIdOf(a.wallet.address);
          const ownerAddr = await agent.ownerOf(tid);
          const seller = users.find((x) => x.address === ownerAddr);
          if (seller) {
            await tryTx(agent.connect(seller).approve(mAddr, tid));
            if (await tryTx(market.connect(seller).list(tid, BigInt(1 + Math.floor(r() * 5)) * ONE / 10n, (await now(ethers)) + DAY))) done.list++;
          }
        } else if (action === 5) {
          // Prefer a live listing so sales actually happen; stale ones must still revert.
          const live = [];
          for (const a of agents) if (await market.isListingValid(tokenIdOf(a.wallet.address))) live.push(a);
          const a = live.length && r() < 0.8 ? pick(live) : pick(agents), tid = tokenIdOf(a.wallet.address);
          const l = await market.listings(tid);
          const valid = await market.isListingValid(tid);
          if (l.seller !== "0x0000000000000000000000000000000000000000") {
            const ok = await tryTx(market.connect(u).buy(tid, l.price, { value: l.price }));
            assert.equal(ok, valid, `buy outcome disagrees with isListingValid at step ${step}`);
            if (ok) done.buy++;
          }
        } else if (action === 6) {
          const a = pick(agents), tid = tokenIdOf(a.wallet.address);
          const ownerAddr = await agent.ownerOf(tid);
          const from = users.find((x) => x.address === ownerAddr);
          if (from && await tryTx(agent.connect(from).transferFrom(from.address, pick(users).address, tid))) done.transfer++;
        } else if (action === 7) {
          if (await tryTx(market.connect(pick(accounts)).withdraw())) done.withdraw++;
        } else {
          // Admin does everything it is allowed to; none of it may move a token.
          const before = await Promise.all(agents.map((a) => agent.ownerOf(tokenIdOf(a.wallet.address))));
          await tryTx(agent.connect(admin).setFees(ONE / BigInt(10 + Math.floor(r() * 90)), ONE / 400n, ONE / 50n));
          await tryTx(agent.connect(admin).withdrawFees(admin.address));
          await tryTx(market.connect(admin).setFeeBps(Math.floor(r() * 1000)));
          await tryTx(agent.connect(admin).transferFrom(before[0], admin.address, tokenIdOf(agents[0].wallet.address)));
          const after = await Promise.all(agents.map((a) => agent.ownerOf(tokenIdOf(a.wallet.address))));
          assert.deepEqual(after, before, `admin moved a token at step ${step}`);
          if (r() < 0.3) await warp(ethers, DAY);
        }

        // ── invariants ──
        for (const a of agents) {
          assert.notEqual(await agent.ownerOf(tokenIdOf(a.wallet.address)), "0x0000000000000000000000000000000000000000");
          assert.equal(await agent.lessonCount(a.wallet.address), a.lessons);
        }
        assert.equal(await agent.totalPassports(), BigInt(agents.length));
        assert.ok(await ethers.provider.getBalance(await agent.getAddress()) >= await agent.pendingProvisionEscrow(), `escrow underfunded at step ${step}`);
        let sum = 0n;
        for (const acc of [...accounts, admin]) sum += await market.credits(acc.address);
        const total = await market.totalCredits();
        assert.equal(sum, total, `credits mismatch at step ${step}`);
        assert.equal(await ethers.provider.getBalance(mAddr), total, `market balance mismatch at step ${step}`);
      }
      console.log(`seed ${seed}:`, JSON.stringify(done));
      for (const k of ["spawn", "lesson", "list", "buy", "transfer", "withdraw"]) assert.ok(done[k] > 0, `seed ${seed} never managed a ${k}`);
    });
  }
});

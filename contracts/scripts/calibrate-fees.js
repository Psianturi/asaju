/**
 * Derive spawn economics from each chain's LIVE gas price instead of hand-picked
 * numbers, then optionally push them on-chain via setFees()/setBreedCost().
 *
 *   npx hardhat run scripts/calibrate-fees.js --network bscTestnet          (dry run)
 *   APPLY=1 CONTRACT=0x... npx hardhat run scripts/calibrate-fees.js --network bscTestnet
 *
 * Why a formula rather than constants: a spawn fee only means something relative
 * to what gas costs on that chain. 1 MNT and 0.02 ETH look wildly different in
 * dollars, but both happen to buy an agent the same amount of autonomous work.
 * Picking numbers per chain by hand is how they drift apart.
 *
 *   provision = gasPrice x MINT_GAS x RUNWAY_MINTS x SAFETY
 *   spawnFee  = provision x 2      (half funds the agent, half is platform fee —
 *                                   the ratio Mantle has always used)
 *   breedCost = spawnFee x 2
 *
 * V5 fees are mutable, so recalibrating never needs a redeploy.
 */

import hre from "hardhat";

/** Gas a mintAttendanceNFT() call uses, rounded up from observed receipts. */
const MINT_GAS = 200_000n;
/** Autonomous mints a freshly spawned agent should be able to afford. */
const RUNWAY_MINTS = 25n;
/** Headroom for gas spikes — testnet gas prices are not stable. */
const SAFETY = 2n;

/** Round up to a readable number so fees are not 0.0011500000000001. */
function prettyCeil(wei) {
  if (wei === 0n) return 0n;
  const digits = wei.toString().length;
  const unit = 10n ** BigInt(Math.max(digits - 2, 0)); // keep ~2 significant digits
  return ((wei + unit - 1n) / unit) * unit;
}

async function main() {
  const net = await hre.network.create();
  const { ethers } = net;
  const networkName = net.networkName;

  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 0n;
  if (gasPrice === 0n) throw new Error("Could not read gas price");

  const perMint = gasPrice * MINT_GAS;
  // The formula sets a safety floor. An operator may want more than the floor —
  // a provision large enough to be visibly non-trivial on the agent card, for
  // instance — so SPAWN_FEE overrides it, and the runway is reported either way.
  const derived = prettyCeil(perMint * RUNWAY_MINTS * SAFETY);
  const override = process.env.SPAWN_FEE
    ? ethers.parseEther(process.env.SPAWN_FEE)
    : null;
  const spawnFee = override ?? derived * 2n;
  const provision = spawnFee / 2n;
  const breedCost = spawnFee * 2n;

  if (override && provision < derived) {
    console.warn(
      `WARNING: provision ${ethers.formatEther(provision)} is below the ` +
      `${ethers.formatEther(derived)} floor for ${RUNWAY_MINTS} mints of runway.`,
    );
  }

  const fmt = (v) => ethers.formatEther(v);

  console.log("Network      :", networkName);
  console.log("Gas price    :", ethers.formatUnits(gasPrice, "gwei"), "gwei");
  console.log("Cost per mint:", fmt(perMint));
  console.log("");
  console.log(`Derived from ${RUNWAY_MINTS} mints of runway x${SAFETY} safety:`);
  console.log("  agentProvision:", fmt(provision));
  console.log("  spawnFee      :", fmt(spawnFee), "(user pays this)");
  console.log("  breedCost     :", fmt(breedCost));
  console.log("  breed total   :", fmt(breedCost + spawnFee), "(V5 charges breed + spawn together)");

  const addr = process.env.CONTRACT;
  if (!addr) {
    console.log("\nSet CONTRACT=0x... to compare against the live contract.");
    return;
  }

  const c = await ethers.getContractAt("AsajuAgentV5", addr);
  const [curSpawn, curProv, curBreed] = await Promise.all([
    c.spawnFee(),
    c.agentProvision(),
    c.breedCost(),
  ]);

  console.log("\nLive on-chain right now:");
  console.log("  agentProvision:", fmt(curProv));
  console.log("  spawnFee      :", fmt(curSpawn));
  console.log("  breedCost     :", fmt(curBreed));

  const runwayNow = perMint > 0n ? curProv / perMint : 0n;
  console.log(`\nCurrent provision buys ${runwayNow} mints of runway.`);

  if (process.env.APPLY !== "1") {
    console.log("\nDry run. Re-run with APPLY=1 to write these on-chain.");
    return;
  }

  console.log("\nApplying...");
  await (await c.setFees(spawnFee, provision)).wait();
  await (await c.setBreedCost(breedCost)).wait();

  const [s2, p2, b2] = await Promise.all([c.spawnFee(), c.agentProvision(), c.breedCost()]);
  console.log("Verified on-chain:");
  console.log("  agentProvision:", fmt(p2));
  console.log("  spawnFee      :", fmt(s2));
  console.log("  breedCost     :", fmt(b2));
  console.log("\nUpdate spawnFee/agentProvision in src/lib/blockchain/chains.ts to match.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

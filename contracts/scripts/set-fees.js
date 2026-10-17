/**
 * set-fees.js — update spawnFee / agentProvision / breedCost on a live
 * AsajuAgentV6 without redeploying. Owner-only.
 *
 *   CONTRACT=0x... SPAWN=0.005 PROVISION=0.0025 BREED=0.01 \
 *     npx hardhat run scripts/set-fees.js --network ethereumSepolia
 *
 * Any of SPAWN/PROVISION/BREED may be omitted to leave that value unchanged.
 * Keep src/lib/blockchain/chains.ts in sync with whatever you set here.
 */
import hre from "hardhat";

async function main() {
  const net = await hre.network.create();
  const { ethers } = net;
  const addr = process.env.CONTRACT;
  if (!addr) throw new Error("Set CONTRACT=0x...");

  const c = await ethers.getContractAt("AsajuAgentV6", addr);
  const [signer] = await ethers.getSigners();
  console.log("Network :", net.networkName);
  console.log("Signer  :", signer.address);
  console.log("Contract:", addr);

  const curSpawn = await c.spawnFee();
  const curProv = await c.agentProvision();
  const curBreed = await c.breedCost();
  console.log("\nCurrent: spawn", ethers.formatEther(curSpawn), "provision", ethers.formatEther(curProv), "breed", ethers.formatEther(curBreed));

  const spawn = process.env.SPAWN ? ethers.parseEther(process.env.SPAWN) : curSpawn;
  const prov = process.env.PROVISION ? ethers.parseEther(process.env.PROVISION) : curProv;
  const breed = process.env.BREED ? ethers.parseEther(process.env.BREED) : curBreed;

  if (spawn !== curSpawn || prov !== curProv) {
    console.log(`\nsetFees(${ethers.formatEther(spawn)}, ${ethers.formatEther(prov)})...`);
    await (await c.setFees(spawn, prov)).wait();
    console.log("  done");
  }
  if (breed !== curBreed) {
    console.log(`setBreedCost(${ethers.formatEther(breed)})...`);
    await (await c.setBreedCost(breed)).wait();
    console.log("  done");
  }

  console.log("\nVerified on-chain:");
  console.log("  spawnFee      :", ethers.formatEther(await c.spawnFee()));
  console.log("  agentProvision:", ethers.formatEther(await c.agentProvision()));
  console.log("  breedCost     :", ethers.formatEther(await c.breedCost()));
}

main().catch((err) => { console.error(err); process.exit(1); });

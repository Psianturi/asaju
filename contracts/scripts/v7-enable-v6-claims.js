/**
 * One-time step per V6 chain: let AsajuAgentV7 freeze V6 records during
 * claimLegacy(). Calls V6.setMarketplaceApproval(v7, true) as the V6 owner.
 *
 *   V7_CONFIRM=yes npx hardhat run scripts/v7-enable-v6-claims.js --network bscTestnet
 *
 * Reads the V7 address from deployments/v7-<chainId>.json. This grants the V7
 * contract the same power V6's escrow already has; V7's code only uses it in
 * claimLegacy(), for the owner who calls it.
 */

import fs from "node:fs";
import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.create();
  const [signer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const dep = JSON.parse(fs.readFileSync(`deployments/v7-${chainId}.json`, "utf8"));
  if (dep.legacyKind !== "V6") throw new Error("This chain's legacy contract is not V6.");

  const v6 = new ethers.Contract(dep.legacy, [
    "function owner() view returns (address)",
    "function isApprovedMarketplace(address) view returns (bool)",
    "function setMarketplaceApproval(address,bool)",
  ], signer);
  const v7 = new ethers.Contract(dep.agent, ["function legacy() view returns (address)", "function legacyKind() view returns (uint8)"], ethers.provider);

  if ((await v7.legacy()) !== dep.legacy || Number(await v7.legacyKind()) !== 1) throw new Error("V7 is not wired to this V6.");
  if ((await v6.owner()) !== signer.address) throw new Error(`Signer ${signer.address} is not the V6 owner.`);
  console.log("V6:", dep.legacy, "| V7:", dep.agent, "| approved now:", await v6.isApprovedMarketplace(dep.agent));

  if (process.env.V7_CONFIRM !== "yes") {
    console.log("Dry run only. Re-run with V7_CONFIRM=yes.");
    return;
  }
  await (await v6.setMarketplaceApproval(dep.agent, true)).wait();
  console.log("Approved:", await v6.isApprovedMarketplace(dep.agent));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

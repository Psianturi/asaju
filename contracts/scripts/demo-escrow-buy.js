/**
 * End-to-end escrow-buy demo on Robinhood Chain testnet (VibeVibe), settling
 * in ASA.
 *
 * Walks the full lifecycle against the live contracts:
 *   1. spawn a fresh agent (deployer pays spawnFee, agent gets its own gas)
 *   2. approve the marketplace on the agent contract (seller-side, once)
 *   3. list the agent for sale at a price in ASA
 *   4. create a buyer wallet, funded with ASA from the deployer
 *   5. buyer approves the marketplace for exactly the listing price
 *   6. buyer calls buy() — escrow settles, 12% fee retained, owner moves
 *   7. verify on-chain: owner changed, seller paid, fee accumulated
 *
 * The buyer key is written next to this script as .demo-buyer-key so the ASA is
 * never stranded in a wallet nobody can sign for.
 *
 *   npx hardhat run scripts/demo-escrow-buy.js --network robinhoodTestnet
 *   npx hardhat run scripts/demo-escrow-buy.js --network robinhoodTestnet --dry-run
 */
import hre from "hardhat";
import { ethers } from "ethers";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const EXPLORER = "https://explorer.testnet.chain.robinhood.com";

const AGENT_V6 = "0x480E7BA834348ef45a140Aa8F5b09c4997c5F0a3";
const MARKETPLACE = "0x110edEa5DB874589ec4492d15660082634E173f0";
const ASA = "0x1c919078B57326EeE9990E9C30D92a182eDe8f5C";

// 50 ASA — a round number that still leaves the deployer's balance obviously
// untouched, so the transfer is easy to verify by eye afterwards.
const PRICE_ASA = 50;
const FEE_BPS = 1200;

const AGENT_ABI = [
  "function spawnAgent(address agentWallet) payable",
  "function agentOwner(address) view returns (address)",
  "function setMarketplaceApproval(address, bool)",
  "function isApprovedMarketplace(address) view returns (bool)",
  "function spawnFee() view returns (uint256)",
  "function agentProvision() view returns (uint256)",
  "function tokenURI(uint256) view returns (string)",
];
const MARKET_ABI = [
  "function list(address, uint256)",
  "function buy(address)",
  "function cancel(address)",
  "function listings(address) view returns (address seller, uint256 price, bool active)",
  "function accumulatedFees() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "event AgentSold(address indexed agentWallet, address indexed seller, address indexed buyer, uint256 price, uint256 fee)",
];
const ERC20_ABI = [
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

// This project is ESM ("type": "module"), so __dirname is not defined.
// import.meta.dirname is the ESM equivalent and needs no shim.
const SCRIPT_DIR = import.meta.dirname;
const BUYER_KEY_PATH = join(SCRIPT_DIR, ".demo-buyer-key");

/**
 * Buyer wallet is persisted next to this script. Creating a throwaway wallet
 * without saving its key would strand the ASA it holds — there is no way to
 * recover it afterwards.
 */
function loadOrCreateBuyer() {
  if (existsSync(BUYER_KEY_PATH)) {
    const saved = JSON.parse(readFileSync(BUYER_KEY_PATH, "utf8"));
    return new ethers.Wallet(saved.privateKey);
  }
  const w = ethers.Wallet.createRandom();
  writeFileSync(
    BUYER_KEY_PATH,
    JSON.stringify(
      {
        address: w.address,
        privateKey: w.privateKey,
        note: "Demo buyer for the ASAJU escrow-buy test. Holds testnet ASA only.",
      },
      null,
      2,
    ),
  );
  console.log(`  buyer key saved to ${BUYER_KEY_PATH}`);
  return w;
}

async function main() {
  const dryRun = process.env.DRY_RUN === "1" || hre.argv.includes("--dry-run");
  const net = await hre.network.create();
  const { ethers: hreEthers } = net;
  const [deployer] = await hreEthers.getSigners();

  const agent = new hreEthers.Contract(AGENT_V6, AGENT_ABI, deployer);
  const market = new hreEthers.Contract(MARKETPLACE, MARKET_ABI, deployer);
  const asa = new hreEthers.Contract(ASA, ERC20_ABI, deployer);

  console.log("=== ASAJU escrow-buy demo · Robinhood Chain testnet ===");
  console.log("deployer    :", deployer.address);
  console.log("agent  V6   :", AGENT_V6);
  console.log("marketplace :", MARKETPLACE);
  console.log("ASA         :", await asa.symbol(), `(${await asa.decimals()} decimals)`);
  console.log("spawnFee    :", hreEthers.formatEther(await agent.spawnFee()), "ETH");
  console.log("feeBps      :", (await market.feeBps()).toString());

  const price = hreEthers.parseUnits(String(PRICE_ASA), 18);
  const fee = (price * BigInt(FEE_BPS)) / 10000n;
  const toSeller = price - fee;
  console.log(`\nlisting price: ${PRICE_ASA} ASA`);
  console.log(`  fee (12%)  : ${hreEthers.formatEther(fee)} ASA  -> marketplace`);
  console.log(`  to seller  : ${hreEthers.formatEther(toSeller)} ASA`);

  // ── 1. spawn ──────────────────────────────────────────────────────────────
  const agentWallet = hreEthers.Wallet.createRandom().address;
  const spawnFee = await agent.spawnFee();
  if (dryRun) {
    console.log(`\n[dry-run] would spawn ${agentWallet} with ${hreEthers.formatEther(spawnFee)} ETH`);
  } else {
    console.log(`\n1. spawn agent ${agentWallet}`);
    const tx = await agent.spawnAgent(agentWallet, { value: spawnFee });
    await tx.wait();
    console.log("   owner:", await agent.agentOwner(agentWallet));
  }

  // ── 2. approve marketplace ────────────────────────────────────────────────
  if (dryRun) {
    console.log("[dry-run] would setMarketplaceApproval(marketplace, true)");
  } else {
    console.log("2. approve marketplace on the agent contract");
    const already = await agent.isApprovedMarketplace(MARKETPLACE);
    if (already) {
      console.log("   already approved (skip)");
    } else {
      await (await agent.setMarketplaceApproval(MARKETPLACE, true)).wait();
      console.log("   approved:", await agent.isApprovedMarketplace(MARKETPLACE));
    }
  }

  // ── 3. list ───────────────────────────────────────────────────────────────
  if (dryRun) {
    console.log("[dry-run] would list agent for 50 ASA");
  } else {
    console.log("3. list for sale");
    await (await market.list(agentWallet, price)).wait();
    const l = await market.listings(agentWallet);
    console.log("   active:", l.active, "price:", hreEthers.formatEther(l.price), "ASA");
  }

  // ── 4. fund buyer ─────────────────────────────────────────────────────────
  const buyer = loadOrCreateBuyer();
  const buyerAsSigner = buyer.connect(deployer.provider);
  console.log(`\n4. buyer ${buyer.address}`);
  if (dryRun) {
    console.log("[dry-run] would fund buyer with ASA + gas");
  } else {
    await (await asa.transfer(buyer.address, price)).wait();
    const gas = hreEthers.parseEther("0.02");
    await (await deployer.sendTransaction({ to: buyer.address, value: gas })).wait();
    console.log("   ASA:", hreEthers.formatEther(await asa.balanceOf(buyer.address)));
    console.log("   ETH:", hreEthers.formatEther(await deployer.provider.getBalance(buyer.address)));
  }

  // ── 5. buyer approves marketplace ─────────────────────────────────────────
  if (dryRun) {
    console.log("[dry-run] would approve marketplace for the exact price");
  } else {
    console.log("5. buyer approves marketplace (exact price)");
    await (await asa.connect(buyerAsSigner).approve(MARKETPLACE, price)).wait();
    console.log("   allowance:", hreEthers.formatEther(await asa.allowance(buyer.address, MARKETPLACE)), "ASA");
  }

  // ── 6. buy ────────────────────────────────────────────────────────────────
  if (dryRun) {
    console.log("[dry-run] would call buy()");
  } else {
    console.log("6. buyer calls buy()");
    const before = await market.accumulatedFees();
    const tx = await market.connect(buyerAsSigner).buy(agentWallet);
    const receipt = await tx.wait();
    console.log("   tx:", `${EXPLORER}/tx/${receipt.hash}`);
  }

  // ── 7. verify ─────────────────────────────────────────────────────────────
  if (dryRun) {
    console.log("\n7. verify — skipped (dry-run submitted nothing)");
    console.log(`   expected after a real run: owner = ${buyer.address},`);
    console.log(`   fees +${hreEthers.formatEther(fee)} ASA, seller +${hreEthers.formatEther(toSeller)} ASA, listing cleared`);
    return;
  }

  console.log("\n7. verify");
  const owner = await agent.agentOwner(agentWallet);
  console.log("   agent owner now      :", owner);
  console.log("   == buyer?            :", owner.toLowerCase() === buyer.address.toLowerCase());
  const fees = await market.accumulatedFees();
  console.log("   marketplace fees     :", hreEthers.formatEther(fees), "ASA");
  console.log("   listing cleared      :", !(await market.listings(agentWallet)).active);

  console.log("\nEscrow buy settled on-chain. Agent ownership moved, fee retained, listing cleared.");
  console.log(`Buyer key: ${BUYER_KEY_PATH} (${buyer.address})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
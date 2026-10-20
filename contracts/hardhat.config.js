import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import "dotenv/config";

/** @type import('hardhat/config').HardhatUserConfig */
export default defineConfig({
  plugins: [hardhatEthers, hardhatVerify],
  solidity: {
    version: "0.8.24",
    // Optional local compiler (native or soljson.js) for machines that cannot
    // download one; unset, Hardhat downloads 0.8.24 as usual.
    ...(process.env.SOLC_PATH ? { path: process.env.SOLC_PATH } : {}),
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      viaIR: true,
    },
  },
  networks: {
    mantleSepolia: {
      type: "http",
      url: "https://rpc.sepolia.mantle.xyz",
      chainId: 5003,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
    mantleMainnet: {
      type: "http",
      url: "https://rpc.mantle.xyz",
      chainId: 5000,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
    ethereumSepolia: {
      type: "http",
      url: "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
    bscTestnet: {
      type: "http",
      url: "https://bsc-testnet-rpc.publicnode.com",
      chainId: 97,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
    // VibeVibe testnet runs on Robinhood Chain (an Arbitrum Orbit L2). The ASA
    // token (0x1c919078B57326EeE9990E9C30D92a182eDe8f5C) is deployed here, so
    // the ERC-20 marketplace settles in ASA on this network.
    robinhoodTestnet: {
      type: "http",
      url: "https://rpc.testnet.chain.robinhood.com/rpc",
      chainId: 46630,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
    polygonAmoy: {
      type: "http",
      url: "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
  },
  verify: {
    etherscan: {
      apiKey: process.env.MANTLE_EXPLORER_API_KEY || "no-api-key",
      customChains: [
        {
          network: "mantleSepolia",
          chainId: 5003,
          urls: {
            apiURL: "https://explorer.sepolia.mantle.xyz/api",
            browserURL: "https://explorer.sepolia.mantle.xyz",
          },
        },
      ],
    },
  },
});

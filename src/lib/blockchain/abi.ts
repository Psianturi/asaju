// ABI for MAEFDynamicNFT (ERC721A) — matches MAEFNFTERC721A.sol
export const MAEF_NFT_ABI = [
  { "inputs": [], "stateMutability": "nonpayable", "type": "constructor" },

  // Events
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "agentWallet", "type": "address" }, { "indexed": false, "internalType": "string", "name": "eventTitle", "type": "string" }, { "indexed": false, "internalType": "string", "name": "agentName", "type": "string" }, { "indexed": false, "internalType": "uint256", "name": "agentLevel", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256" }], "name": "NFTMinted", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "agentWallet", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "newLevel", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "totalEvents", "type": "uint256" }], "name": "AgentLevelUp", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "agentWallet", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256" }], "name": "WisdomUnlocked", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "agentWallet", "type": "address" }, { "indexed": true, "internalType": "address", "name": "spawner", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "provisionAmount", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256" }], "name": "AgentSpawned", "type": "event" },

  // Write functions
  {
    "inputs": [{ "internalType": "address", "name": "agentWallet", "type": "address" }],
    "name": "spawnAgent",
    "outputs": [],
    "stateMutability": "payable", "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "agentWallet", "type": "address" }, { "internalType": "bytes32", "name": "offspringId", "type": "bytes32" }],
    "name": "spawnBredAgent",
    "outputs": [],
    "stateMutability": "nonpayable", "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "agentWallet", "type": "address" }, { "internalType": "string", "name": "eventTitle", "type": "string" }, { "internalType": "string", "name": "eventUrl", "type": "string" }, { "internalType": "string", "name": "platform", "type": "string" }, { "internalType": "string", "name": "agentName", "type": "string" }, { "internalType": "string", "name": "summary", "type": "string" }, { "internalType": "string", "name": "niche", "type": "string" }],
    "name": "mintAttendanceNFT",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "nonpayable", "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "minter", "type": "address" }],
    "name": "grantMinterRole",
    "outputs": [],
    "stateMutability": "nonpayable", "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "minter", "type": "address" }],
    "name": "revokeMinterRole",
    "outputs": [],
    "stateMutability": "nonpayable", "type": "function"
  },
  {
    "inputs": [{ "internalType": "string", "name": "newBaseURI", "type": "string" }],
    "name": "setBaseMetadataURI",
    "outputs": [],
    "stateMutability": "nonpayable", "type": "function"
  },

  // Read functions
  {
    "inputs": [{ "internalType": "address", "name": "agentWallet", "type": "address" }],
    "name": "getAgentTokenIds",
    "outputs": [{ "internalType": "uint256[]", "name": "", "type": "uint256[]" }],
    "stateMutability": "view", "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
    "name": "getEventDetails",
    "outputs": [{ "components": [{ "internalType": "string", "name": "eventTitle", "type": "string" }, { "internalType": "string", "name": "eventUrl", "type": "string" }, { "internalType": "string", "name": "platform", "type": "string" }, { "internalType": "string", "name": "agentName", "type": "string" }, { "internalType": "address", "name": "agentAddress", "type": "address" }, { "internalType": "string", "name": "summary", "type": "string" }, { "internalType": "uint256", "name": "timestamp", "type": "uint256" }, { "internalType": "uint256", "name": "agentLevel", "type": "uint256" }, { "internalType": "string", "name": "niche", "type": "string" }], "internalType": "struct MAEFDynamicNFT.EventAttendance", "name": "", "type": "tuple" }],
    "stateMutability": "view", "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "agentWallet", "type": "address" }],
    "name": "getAgentStats",
    "outputs": [{ "components": [{ "internalType": "uint256", "name": "totalEvents", "type": "uint256" }, { "internalType": "uint256", "name": "currentLevel", "type": "uint256" }, { "internalType": "uint256", "name": "totalGasSpent", "type": "uint256" }, { "internalType": "bool", "name": "wisdomUnlocked", "type": "bool" }, { "internalType": "uint256", "name": "lastEventTimestamp", "type": "uint256" }], "internalType": "struct MAEFDynamicNFT.AgentStats", "name": "", "type": "tuple" }],
    "stateMutability": "view", "type": "function"
  },
  {
    "inputs": [],
    "name": "getTotalMinted",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view", "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
    "name": "tokenURI",
    "outputs": [{ "internalType": "string", "name": "", "type": "string" }],
    "stateMutability": "view", "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "agentWallet", "type": "address" }],
    "name": "isAgentActive",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view", "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view", "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
    "name": "ownerOf",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view", "type": "function"
  },
  {
    "inputs": [],
    "name": "MINTER_ROLE",
    "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
    "stateMutability": "view", "type": "function"
  }
] as const

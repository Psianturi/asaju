# Contract tests

Runs on Hardhat 3's simulated network, one fresh chain per test.

```
npm ci
npm test
```

Machines that cannot download the compiler can point Hardhat at a local one
(`npm i solc@0.8.24` somewhere, then):

```
SOLC_PATH=/path/to/node_modules/solc/soljson.js npm test
```

Tests named `KNOWN ISSUE (V7)` pin today's unsafe behaviour so it is
documented and cannot change silently. The next contract version must
make each of them fail, and they should then be rewritten as the opposite
assertion.

## V7

`AsajuAgentV7.test.js`, `AsajuMarketV7.test.js`, `V7Migration.test.js`,
`V7Governance.test.js` and `V7Invariants.test.js` cover the V7 spec. Tests
named `V7 FIX` assert the opposite of a V6 `KNOWN ISSUE`. The invariant test
runs seeded random sequences (spawn, breed, lessons, list, buy, transfer,
withdraw, admin actions) and checks after every step that no admin action
moves a token, the provision escrow stays funded, and market balance equals
the sum of credits.

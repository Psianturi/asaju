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

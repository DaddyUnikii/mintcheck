<div align="center">

# 🧪 mintcheck

**Read any NFT mint contract and know in one command: free or paid, open or closed, safe to try or not.**

[![CI](https://github.com/DaddyUnikii/mintcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/DaddyUnikii/mintcheck/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![Read only](https://img.shields.io/badge/read--only-never%20signs-blueviolet)
![License](https://img.shields.io/badge/license-MIT-blue)

</div>

---

New mints get shilled every hour, usually with a contract address and a "free mint!" claim.
`mintcheck` reads the contract straight from the chain so you don't have to trust the tweet:
the real price, the quote for **your** wallet, supply left, per-wallet limits, gates, and a
dry-run of the mint itself. It never signs or sends anything.

```
$ mintcheck 0x19758609B4B1885B02ba64c0BeaDb436503CfcAe --wallet 0xYOUR_WALLET --simulate

  FACEID.AI (FACEID)  [PAID]
  0x19758609B4B1885B02ba64c0BeaDb436503CfcAe · BNB Smart Chain

  Minted        807 / 2800 (28.8%)
  Price         0.0013 BNB
  Quote x1      0.0013 BNB
  Max/wallet    10
  You minted    1
  Mint open     yes
  Gate          agent-only (needs an agent ID)
  Owner         0xe5310d5288c0f74452fd3b57cc09818b1f498eb0
  Mint fn       mint(uint256)
  Simulation    mint(uint256) reverts: WrongPayment()
  Heads up      owner can change the price
  Heads up      owner can open/close minting
  Heads up      unrevealed: art/tiers are set at reveal

  Verdict: PAID · quote for this wallet
```

## ✨ Features

- 💸 **Free or paid?** Reads `price()`, `mintPrice()`, `cost()` and friends, plus `quote(wallet, qty)` when the contract has one
- 📦 **Supply**: minted vs max, with a sold-out check
- 👛 **Your wallet**: how many you already minted, the free allowance left, the per-wallet cap
- 🚦 **Open / paused / gated**: agent-only and allowlist (merkle root) gates are flagged
- 🧪 **`--simulate`**: dry-runs the mint with `eth_call` at value 0 and decodes the revert (`WrongPayment()`, `SoldOut()`, `Error(string)` ...)
- ⚠️ **Heads up** on admin powers found in the bytecode: change price, pause, change metadata, unrevealed art
- 🔑 **`--selector`**: built-in Keccak-256, so you can hash any function signature offline
- ⛓️ BSC, Ethereum, Base, Arbitrum, Polygon, or any `--rpc` URL
- 🤖 `--json` output for bots · 🪶 zero dependencies, Node 18+

## 🚀 Usage

```bash
git clone https://github.com/DaddyUnikii/mintcheck && cd mintcheck

# quick look (BSC by default)
node bin/mintcheck.js 0xContract

# price for your wallet, and dry-run the mint
node bin/mintcheck.js 0xContract --wallet 0xYOUR_WALLET --simulate

# other chains / custom RPC
node bin/mintcheck.js 0xContract --chain base
node bin/mintcheck.js 0xContract --rpc https://your-rpc.example

# JSON for scripts
node bin/mintcheck.js 0xContract --json

# hash a function signature
node bin/mintcheck.js --selector "mint(uint256)"     # 0xa0712d68
```

Or install globally: `npm i -g .` then run `mintcheck <contract>`.

### Verdicts

| Verdict | Meaning |
|---|---|
| `FREE` | Quote or price is 0 (or you still have free allowance) |
| `PAID` | Costs something, shown in the chain's native token |
| `CLOSED` | Mint is not open, or the contract is paused |
| `SOLD OUT` | Minted supply reached max supply |
| `UNKNOWN` | No standard price function; try `--wallet` and `--simulate` |

## 🧠 How it works

1. `eth_getCode` pulls the bytecode and every `PUSH4` operand is collected, so mintcheck knows which functions exist before calling them (proxies fall back to trying everything).
2. Common getter names are probed with `eth_call`; the first one that answers wins (`sources` in `--json` shows which).
3. `--simulate` calls the mint function from your address with value 0. A pass means a free mint would go through right now; a revert is decoded into a readable error.
4. Everything is read-only. There is no private key anywhere in this tool.

## 🧪 Tests

```bash
npm test
```

Tests run against a mocked RPC, so CI never touches the network.

## ⚠️ Disclaimer

A green verdict is not an audit. Owners can change prices and rules after you check, and a passing
simulation can still differ from the real transaction. Always read what your wallet asks you to sign.

## 📄 License

MIT © [Unikii](https://github.com/DaddyUnikii)

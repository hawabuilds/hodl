# Security

## Scope

| In scope | Address (Robinhood Chain 4663) |
| --- | --- |
| HodlRouter v2 | [`0xBcf97C486DB56642BD27FCbE9CDeBed9A72468eb`](https://robin.etherscan.io/address/0xBcf97C486DB56642BD27FCbE9CDeBed9A72468eb) |
| FeeCollector v2 | [`0x380b8Ced6F27c3800BA9F16796a34Ea74cC3BfCf`](https://robin.etherscan.io/address/0x380b8Ced6F27c3800BA9F16796a34Ea74cC3BfCf) |
| The app at [hodl.fan](https://hodl.fan) and this repository | |

v1 (router `0x50cb78e0034b4869d8d42ad901c614866f5c5e99`) is paused and retired. Reports about it are still welcome.

## Ownership

Both v2 contracts are owned by the Safe [`0xD6bD19742663ac1B1f5dd33aDB453E6DD9321aF8`](https://robin.etherscan.io/address/0xD6bD19742663ac1B1f5dd33aDB453E6DD9321aF8) (Safe 1.5.0, **2-of-3**). Every admin action, including `pause`, needs two signatures. Fee, size-cap and venue changes wait a 2-day timelock. Ownership is two-step and cannot be renounced. The full list of admin powers is in [`contracts/README.md`](contracts/README.md#admin-powers-and-delays).

## Audit summary

v2 is the result of a self-audit of v1. There has been no third-party audit.

### Fixed in v2

| Issue | v1 | v2 |
| --- | --- | --- |
| **Donation DoS** (High) | Every router balance had to be zero after a trade, so 1 wei of USDG sent to the router blocked all trading. | Balances must be no higher than at the start of the trade. Donations neither block trades nor can be extracted. Covered by `HodlRouterAttack.t.sol` and the invariant suite. |
| **V4 swap encoding** | Swap params were encoded as flat fields; the Universal Router read the first word as a struct offset, so only native-ETH V4 pools worked. Long (WETH) and Pons USDG pools reverted. | Encoded as `ExactInputSingleParams`. Fork-tested on real Pons ETH, Pons USDG and Long WETH pools. |
| **V3 multi-hop `SliceOutOfBounds`** | The app's `V3_SWAP_EXACT_IN` call to Universal Router 2.1.1 left out the `maxHopSlippage` array, so every ETH → USDG → stock → token trade reverted. | Fixed in `src/lib/swapTx.ts`, with a regression test in `test/swap-tx.test.ts`. |
| Seller minimum | Checked before the fee. | Checked on what the seller actually receives, after the fee. |
| ETH payouts | V4 PoolManager ETH payouts were rejected; on an ETH payout the router unwrapped its whole WETH balance. | `receive()` accepts ETH only during a trade; only the WETH this swap produced is unwrapped. |
| Price source for size limits | Spot price. | 10-minute TWAP of the WETH/USDG pool. |
| Admin changes | One-step ownership; instant fee and cap changes. | `Ownable2Step`; 2-day timelock on fee, cap and venues; `renounceOwnership` disabled. |
| FeeCollector | Funds could be stuck once a buyback module was set. | Module removed; the owner can always withdraw to the owner. |
| Unsafe casts and token calls | Silent `uint128` truncation; hand-rolled token calls and lock. | OZ `SafeCast`, `SafeERC20`, `ReentrancyGuardTransient`. |
| Fee-on-transfer tokens | Failed deep inside a venue. | Rejected on input (`FeeOnTransferToken`); output minimum checked after any tax. |

The full v1 → v2 diff and the known limits are in [`contracts/README.md`](contracts/README.md#changes-from-v1).

## Testing and analysis

- **OpenZeppelin Contracts v5.7.0** (`Ownable2Step`, `ReentrancyGuardTransient`, `SafeERC20`, `SafeCast`), pinned in `contracts/foundry.lock`.
- **103 Foundry tests:** 95 unit, fuzz, invariant and attack tests, plus 8 fork tests against real Pons and Long V4 pools and a V3 pool.
- **Coverage: 100%** of lines (279/279), statements (417/417), branches (123/123) and functions (48/48) in `HodlRouter` and `FeeCollector`.
- **Slither 0.11.4: 0 High**, 24 Medium, 2 Low, 13 Informational. Every Medium and Low was reviewed; they are false positives or intended (TickMath `divide-before-multiply`, comparisons against constants, an unused `observe()` return, timestamp comparisons for deadline and timelock). One `arbitrary-send-eth` on `WETH.deposit` is suppressed in place because `WETH` is immutable.
- **Contracts CI** ([`.github/workflows/contracts.yml`](.github/workflows/contracts.yml)) on every change under `contracts/`: `forge fmt --check`, build, tests, a ≥95% branch-coverage gate, and Slither failing on any High.
- Fork tests need live chain state, so they run locally before each deploy, not in CI. See [`contracts/README.md`](contracts/README.md#tests).

## Reporting a vulnerability

Please report privately. Don't open a public issue, and don't test against mainnet funds you don't own.

- **Email:** hawabuilds@outlook.com
- Include: the affected contract or URL, steps to reproduce (a Foundry test against a fork is ideal), and the impact you expect.
- For a critical contract issue, the Safe owners can pause the router while a fix is prepared.

There is no formal bug bounty at the moment.

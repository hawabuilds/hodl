# HODL contracts (v2)

Two contracts on Robinhood Chain (4663), compiled with exactly `solc 0.8.26` (EVM `cancun`).

Built on **OpenZeppelin Contracts v5.7.0** (`lib/openzeppelin-contracts`, pinned in `foundry.lock`): `Ownable2Step`, `ReentrancyGuardTransient`, `SafeERC20` and `SafeCast`. `renounceOwnership` is disabled on both contracts.

| Contract | Role |
| --- | --- |
| `HodlRouter` | Single-transaction swap wrapper around Uniswap V4 (Pons and Long pools, through the Universal Router) and Uniswap V3 (SwapRouter02). Takes a 0.5% fee on the ETH / WETH / USDG side of every trade and sends it to `FeeCollector`. It never accepts router `commands` or `inputs` from the caller. |
| `FeeCollector` | Holds the fees, away from the router. The owner withdraws to the owner. Nothing else can move funds. |

## Deployments (Robinhood Chain 4663)

| | v2 (current) | v1 (to retire) |
| --- | --- | --- |
| HodlRouter | [`0xBcf97C486DB56642BD27FCbE9CDeBed9A72468eb`](https://robinhoodchain.blockscout.com/address/0xBcf97C486DB56642BD27FCbE9CDeBed9A72468eb) | `0x50cb78e0034b4869d8d42ad901c614866f5c5e99` |
| FeeCollector | [`0x380b8Ced6F27c3800BA9F16796a34Ea74cC3BfCf`](https://robinhoodchain.blockscout.com/address/0x380b8Ced6F27c3800BA9F16796a34Ea74cC3BfCf) | `0x1090d265749c1199919a754a8c2dd00150d1f0f9` |

v2 was deployed on 2026-10-03 from master `4f13b71` by `0x4523D729d7dac7445EDb6806677AB1EB667FD0BD`, paused, with a 50 bps fee and a $100 cap:
- FeeCollector: tx [`0x597757f0…6f50`](https://robinhoodchain.blockscout.com/tx/0x597757f06915b70b3ee88a6b2645da84df84c778458b5d64dec2c00eb9536f50), block 79428729
- HodlRouter: tx [`0x3cbd9f7a…42e9`](https://robinhoodchain.blockscout.com/tx/0x3cbd9f7ab5517d6b6520ea673a1b27d1d1d2f4779eb072ad85efc313d98142e9), block 79428755
- Source verified on Sourcify (`exact_match`, creation and runtime): [FeeCollector](https://repo.sourcify.dev/4663/0x380b8Ced6F27c3800BA9F16796a34Ea74cC3BfCf), [HodlRouter](https://repo.sourcify.dev/4663/0xBcf97C486DB56642BD27FCbE9CDeBed9A72468eb)
- Forge record: `broadcast/Deploy.s.sol/4663/run-1791065414976.json`

Unpaused on 2026-10-04: tx [`0xdb38a13f…2a4f`](https://robinhoodchain.blockscout.com/tx/0xdb38a13f1071a728493d00f9f0d07f4d9e09a3a129a993d73af33f4211d82a4f), block 79450272.

Live test trades through v2 from the app preview (wallet `0xA16CeB5857F880d86b35309fBF9Ac021644b6516`). Each fee was exactly 50 bps and landed in the v2 FeeCollector. Each trade received at least its minimum, and the router held nothing afterwards:

| Trade | Route | Fee | Minimum → received | Tx |
| --- | --- | --- | --- | --- |
| Buy FIG, paid 2 USDG | `buyWithToken`, V3 USDG pool | 0.01 USDG | 0.0921 → 0.0930 FIG | [`0xf123c6c1…71d3`](https://robinhoodchain.blockscout.com/tx/0xf123c6c15b92393927435b2f34d7ce7275896db4b5c4e790379d9e27376971d3) |
| Buy ORBIO (Pons), paid 0.0007 ETH | `buy`, V3 WETH pool | 0.0000035 ETH | 17.96 → 18.10 ORBIO | [`0xbd1c0c86…1d31`](https://robinhoodchain.blockscout.com/tx/0xbd1c0c86fd5397193f1e210ccea700c87a740146f6aca2b2efab2521b44d1d31) |
| Sell 18 ORBIO for ETH | `sell`, V3 WETH pool, minimum checked after fee | 0.00000344 ETH | 0.000676 → 0.000684 ETH | [`0x9531fbe9…356b`](https://robinhoodchain.blockscout.com/tx/0x9531fbe93a0ef76c391cfe0ed02909eeb53883e8442fc47ac226e08edaa8356b) |

Not covered live: the V4 route (Pons/Long pools paired directly with ETH, WETH or USDG). No token the app lists uses it today; every listed V4 token is multi-hop and goes through the Universal Router. That route is covered by the fork tests against real Pons ETH, Pons USDG and Long WETH pools. A FIG sell from the app went FIG → USDG → ETH through the Universal Router ([`0xbb47dfcf…8769`](https://robinhoodchain.blockscout.com/tx/0xbb47dfcf6ff484a93f7f7ffdb7b8151fe0c1fea5d92c2051eb386c9c7d958769)), with its 0.5% fee paid to the v2 FeeCollector.

## Trade flow

`buy` (ETH in), `buyWithToken` (USDG or WETH in) and `sell` (any token in; ETH, WETH or USDG out) all run `_trade`:

1. **Checks.** Deadline, `tokenIn != tokenOut`, and the hint:
   - `hooks == 0`: a V3 swap; `fee` must be 100, 500, 3000 or 10000.
   - `hooks == PONS_HOOK`: fee 0, tick spacing 200.
   - `hooks == LONG_HOOK`: fee `0x800000` (dynamic), tick spacing 8.
   - Any other hook reverts `BadHook` before any external call. For V4, `currency0 < currency1`, one side must be ETH, WETH or USDG, and the pool must hold both trade tokens (ETH and WETH count as the same side).
2. **Snapshot.** The router records its ETH, WETH, USDG, `tokenIn` and `tokenOut` balances. For `buy`, `msg.value` is subtracted from the ETH figure.
3. **Pull.** `transferFrom` the caller, then check that exactly `amountIn` arrived. Otherwise it reverts `FeeOnTransferToken`.
4. **Fee on input (buys).** The trade must be between $1 and `maxNotionalUsd`. Then `fee = amountIn * feeBps / 10_000` goes to the collector (WETH is unwrapped and sent as ETH), and `amountIn - fee` is swapped.
5. **Swap.** The router builds the V4 `SWAP_EXACT_IN_SINGLE → SETTLE(_ALL) → TAKE_ALL` actions or the V3 `exactInputSingle` call itself. If the pool uses the other form of ETH (native vs WETH), it wraps or unwraps only what this swap moved. Output is measured as the change in the router's own balance.
6. **Fee on output (sells).** The $1 / cap check, then the fee comes out of the output.
7. **Deliver.** The router sends the rest to the caller and measures what the caller actually gained. **`minAmountOut` is checked against that amount**: after the fee on sells, and after any transfer tax on buys.
8. **No-gain check.** None of the five balances may be higher than in the snapshot, otherwise it reverts `Leftover(token)`. Donated or force-sent funds are tolerated and never spent. A trade can never leave funds behind.

### Size limits and the price source

The $1 floor and `maxNotionalUsd` cap ($100 at deploy) use a **10-minute TWAP** of the WETH/USDG 0.01% V3 pool (`observe([600, 0])`, mean tick rounded down, Uniswap TickMath). These are risk limits on trade size only. No amount paid or received is derived from this price. A same-block push of the pool moves the TWAP by roughly one second's worth of the window, so neither limit can be bypassed cheaply. If the pool's oracle can't answer, ETH-sized trades revert; USDG-sized trades don't need it.

## Admin powers and delays

| Action | Who | Delay |
| --- | --- | --- |
| `pause` / `unpause` | owner | instant (emergency button) |
| `sweep(token, to)` | owner | instant, **only while paused**; moves donated / force-sent balances |
| `queueFeeBps` (0–100 bps) | owner | `TIMELOCK` = 2 days, then `executeChange(FeeBps)` |
| `queueMaxNotionalUsd` (> 0) | owner | 2 days, then `executeChange(MaxNotionalUsd)` |
| `queueUniversalRouter` | owner | 2 days, then `executeChange(UniversalRouter)` |
| `queueSwapRouter02` | owner | 2 days, then `executeChange(SwapRouter02)` |
| `cancelChange(param)` | owner | instant |
| `transferOwnership` → `acceptOwnership` | owner, then the new owner | two-step (OZ `Ownable2Step`); `transferOwnership(0)` cancels |
| `renounceOwnership` | — | disabled (reverts `RenounceDisabled`) |
| `FeeCollector.withdrawETH / withdrawToken` | owner | instant; always pays the owner |

- Queueing again replaces the value and **restarts the 2-day clock**, so a harmless change can't be queued early and swapped for a different one just before it matures.
- `pendingChange(param)` returns the queued value and its earliest execution time.
- Events: `ChangeQueued`, `ChangeCancelled`, `ChangeExecuted(old, new)`, `OwnershipTransferStarted`, `OwnershipTransferred`, `Paused`, `Unpaused`, `Sweep`, `Withdraw`, `Trade`.
- Fixed for the router's lifetime: `feeCollector`, `WETH`, `USDG`, `wethUsdgPool`, the two hook addresses and their PoolKey parameters, `MAX_FEE_BPS`, `TIMELOCK`.
- The router deploys **paused** with `feeBps = 50`.

## Changes from v1

| v1 | v2 |
| --- | --- |
| Every balance had to be **zero** after a trade, so 1 wei of USDG sent to the router blocked all trading (High). | Balances must be **no higher** than at the start. Donations neither block nor leak. |
| Seller minimum checked **before** the fee. | Checked on what the seller **receives**, after the fee. |
| `uint128(amountIn)` truncated silently. | OZ `SafeCast.toUint128` reverts `SafeCastOverflowedUintDowncast`. |
| Hand-rolled token calls and lock. | OZ `SafeERC20` (`safeTransfer`, `safeTransferFrom`, `forceApprove`) and `ReentrancyGuardTransient`. |
| Fee-on-transfer tokens failed deep inside a venue. | Input: `FeeOnTransferToken`. Output: the minimum is checked on the post-tax amount. |
| V4 swap params encoded as flat fields. The router reads the first word as a struct offset, so **only native-ETH pools worked**; Long (WETH) and Pons USDG pools reverted. | Encoded as `ExactInputSingleParams`; fork-tested on Pons ETH, Pons USDG and Long WETH pools. |
| ETH payouts from the V4 PoolManager were rejected by `receive()`. | `receive()` accepts ETH only while a trade is running. |
| On an ETH payout, the router unwrapped its **whole** WETH balance and paid it out. | Only the WETH this swap produced is unwrapped. |
| Spot price for the $1 / cap check. | 10-minute TWAP. |
| One-step `transferOwnership`; instant fee and cap changes. | Two-step ownership; fee, cap and venue changes wait 2 days. |
| `pragma ^0.8.26` | `pragma 0.8.26` |
| `FeeCollector`: once a buyback module was set, withdrawals reverted and the module had no way to pull, so funds were stuck. | Module removed. The owner can always withdraw to the owner. A future buyback contract becomes the owner (two-step) or is funded by the owner. |
| Slot layout | Slot 0 = owner. `feeBps` and `paused` pack with the pending owner in slot 1, so a trade reads one slot. The reentrancy lock uses transient storage (no slot, no refund games). |

## Known limits

- **No renounce.** Ownership can only be handed over (two-step), never dropped, so pause, sweep, timelocked changes and fee withdrawals always have someone able to act.
- **Trusted owner.** The owner can pause indefinitely and can, after 2 days, point the router at a different Universal Router or SwapRouter02. Users who don't trust a queued change have 2 days to stop trading. Use a multisig.
- **Hook allow-list is fixed.** A new Pons or Long hook needs a new router.
- **V3 hints aren't cross-checked.** For V3, `hint.currency0/1` are ignored; SwapRouter02 resolves the pool from its factory.
- **Fee-on-transfer sells are not supported** (they revert by design). Fee-on-transfer buys work, but `minAmountOut` must allow for the token's tax.
- **Rebasing or otherwise weird tokens** that change balances without transfers may hit `Leftover` or deliver less than expected. They revert rather than lose funds.
- **Oracle dependency.** ETH-sized trades need the WETH/USDG pool's oracle. If it's ever unusable, the owner must pause.
- **Rounding.** The fee rounds down; at $1 a 0.5% fee is 5,000 raw USDG units.
- `sweep` sends the router's **whole** balance of a token, so pause first and check what's there.

## Tests

```bash
cd contracts
forge test                                   # unit, fuzz, invariant (fork suite forks the `rh` endpoint)
forge test --fork-url <4663 RPC>             # full suite on a fork
forge coverage --no-match-coverage "test|script" --no-match-contract Fork
```

| Suite | What it proves |
| --- | --- |
| `HodlRouter.t.sol` | Every trade shape on mocks, every revert path, FoT buy/sell, struct encoding, TickMath vs Uniswap MIN/MAX, FeeCollector. |
| `HodlRouterAttack.t.sol` | USDG, WETH, output-token and forced-ETH donations don't block any trade shape and can't be extracted; reentry through all three entry points is blocked. |
| `HodlRouterAdmin.t.sol` | Two-step ownership; each delayed change; no bypass (re-queue restarts the clock, no replay, strangers and pending owner rejected); slot-0 packing. |
| `HodlRouterFuzz.t.sol` | `fee + swap == input` for every fee 0–100 bps at $1 and $100 in USDG and ETH, plus fuzzed amounts; sellers always get at least their minimum after the fee. |
| `HodlRouterInvariant.t.sol` | Random trades and donations: router balances always equal what was donated. |
| `HodlRouterFork.t.sol` | Real Pons (native ETH and USDG) and Long (WETH) pools: buy and sell, quoter-checked minimums; donations on real venues; V3; TWAP vs spot. |

**Fork block.** `FORK_BLOCK` is pinned. The public RPC keeps only ~20 minutes of state (the chain makes ~10 blocks/s), so reruns depend on Foundry's on-disk cache (`~/.foundry/cache/rpc/4663/<block>`) or an archive RPC. The fork suite never skips: if the block is gone it fails. Bump `FORK_BLOCK` to a recent block and rerun.

**Slither** (0.11.4, 100 detectors, `--filter-paths "test|script|lib"`): 0 High, 24 Medium, 2 Low, 13 Informational. One High (`arbitrary-send-eth`) is suppressed in place: it flags `WETH.deposit{value: …}()`, and `WETH` is immutable. Every Medium and Low was reviewed and is a false positive or intended:
- `divide-before-multiply` (19): the `>> 128` steps of TickMath, identical to Uniswap's; checked against Uniswap's MIN/MAX sqrt prices and a 60-digit reference in tests.
- `incorrect-equality` (4): comparisons against zero and constants (`amount == 0`, `venue == VENUE_V3`, empty revert data).
- `unused-return` (1): `observe()`'s seconds-per-liquidity array isn't needed.
- `timestamp` (2): deadline and timelock comparisons.
- Informational: low-level calls and assembly (ETH sends, `balanceOf`, venue calls, revert bubbling), `WETH`/`USDG` naming (kept for ABI compatibility), unindexed `Paused`/`Unpaused` (kept from v1), TickMath literals and complexity.

**CI** (`.github/workflows/contracts.yml`): format, build, unit/fuzz/invariant tests, a ≥95% branch-coverage gate, and Slither failing on High. Fork tests can't run in CI (no archive RPC); run them locally before a deploy.

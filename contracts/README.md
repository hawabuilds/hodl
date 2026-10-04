# HODL contracts (v2)

Two contracts on Robinhood Chain (4663), compiled with exactly `solc 0.8.26` (EVM `cancun`).

Built on **OpenZeppelin Contracts v5.7.0** (`lib/openzeppelin-contracts`, pinned in `foundry.lock`): `Ownable2Step`, `ReentrancyGuardTransient`, `SafeERC20` and `SafeCast`. `renounceOwnership` is disabled on both contracts.

| Contract | Role |
| --- | --- |
| `HodlRouter` | Single-transaction swap wrapper around Uniswap V4 (Pons and Long pools, through the Universal Router) and Uniswap V3 (SwapRouter02). Takes a 0.5% fee on the ETH / WETH / USDG side of every trade and sends it to `FeeCollector`. It never accepts router `commands` or `inputs` from the caller. |
| `FeeCollector` | Holds the fees, away from the router. The owner withdraws to the owner. Nothing else can move funds. |

## Deployments (Robinhood Chain 4663)

| | v2 (live) | v1 (paused, retired) |
| --- | --- | --- |
| HodlRouter | [`0xBcf97C486DB56642BD27FCbE9CDeBed9A72468eb`](https://robin.etherscan.io/address/0xBcf97C486DB56642BD27FCbE9CDeBed9A72468eb) | `0x50cb78e0034b4869d8d42ad901c614866f5c5e99` |
| FeeCollector | [`0x380b8Ced6F27c3800BA9F16796a34Ea74cC3BfCf`](https://robin.etherscan.io/address/0x380b8Ced6F27c3800BA9F16796a34Ea74cC3BfCf) | `0x1090d265749c1199919a754a8c2dd00150d1f0f9` |
| Owner | Safe [`0xD6bD19742663ac1B1f5dd33aDB453E6DD9321aF8`](https://robin.etherscan.io/address/0xD6bD19742663ac1B1f5dd33aDB453E6DD9321aF8) (2-of-3) | deployer key |

- Source verified (exact match) on RobinScan: [HodlRouter](https://robin.etherscan.io/address/0xBcf97C486DB56642BD27FCbE9CDeBed9A72468eb#code), [FeeCollector](https://robin.etherscan.io/address/0x380b8Ced6F27c3800BA9F16796a34Ea74cC3BfCf#code). Also on Sourcify (below).
- The app reads the addresses from `NEXT_PUBLIC_HODL_ROUTER` / `NEXT_PUBLIC_FEE_COLLECTOR`; unset, it falls back to v1 (`src/lib/contracts.ts`).

v2 was deployed on 2026-10-03 from master `3e76f23` by `0x4523D729d7dac7445EDb6806677AB1EB667FD0BD`, paused, with a 50 bps fee and a $100 cap:
- FeeCollector: tx [`0x597757f0…6f50`](https://robin.etherscan.io/tx/0x597757f06915b70b3ee88a6b2645da84df84c778458b5d64dec2c00eb9536f50), block 79428729
- HodlRouter: tx [`0x3cbd9f7a…42e9`](https://robin.etherscan.io/tx/0x3cbd9f7ab5517d6b6520ea673a1b27d1d1d2f4779eb072ad85efc313d98142e9), block 79428755
- Source verified on Sourcify (`exact_match`, creation and runtime): [FeeCollector](https://repo.sourcify.dev/4663/0x380b8Ced6F27c3800BA9F16796a34Ea74cC3BfCf), [HodlRouter](https://repo.sourcify.dev/4663/0xBcf97C486DB56642BD27FCbE9CDeBed9A72468eb)
- Forge record: `broadcast/Deploy.s.sol/4663/run-1791065414976.json`

Unpaused on 2026-10-04: tx [`0xdb38a13f…2a4f`](https://robin.etherscan.io/tx/0xdb38a13f1071a728493d00f9f0d07f4d9e09a3a129a993d73af33f4211d82a4f), block 79450272.

Live trades through v2 from the app preview (wallet `0xA16CeB5857F880d86b35309fBF9Ac021644b6516`). Each fee was exactly 50 bps and landed in the v2 FeeCollector. Each trade received at least its minimum, and the router held nothing afterwards:

| Trade | Route | Fee | Minimum → received | Tx |
| --- | --- | --- | --- | --- |
| Buy FIG, paid 2 USDG | `buyWithToken`, V3 USDG pool | 0.01 USDG | 0.0921 → 0.0930 FIG | [`0xf123c6c1…71d3`](https://robin.etherscan.io/tx/0xf123c6c15b92393927435b2f34d7ce7275896db4b5c4e790379d9e27376971d3) |
| Buy ORBIO (Pons), paid 0.0007 ETH | `buy`, V3 WETH pool | 0.0000035 ETH | 17.96 → 18.10 ORBIO | [`0xbd1c0c86…1d31`](https://robin.etherscan.io/tx/0xbd1c0c86fd5397193f1e210ccea700c87a740146f6aca2b2efab2521b44d1d31) |
| Sell 18 ORBIO for ETH | `sell`, V3 WETH pool, minimum checked after fee | 0.00000344 ETH | 0.000676 → 0.000684 ETH | [`0x9531fbe9…356b`](https://robin.etherscan.io/tx/0x9531fbe93a0ef76c391cfe0ed02909eeb53883e8442fc47ac226e08edaa8356b) |

Not covered live: the V4 route (Pons/Long pools paired directly with ETH, WETH or USDG). No token the app lists uses it today; every listed V4 token is multi-hop and goes through the Universal Router. That route is covered by the fork tests against real Pons ETH, Pons USDG and Long WETH pools. A FIG sell from the app went FIG → USDG → ETH through the Universal Router ([`0xbb47dfcf…8769`](https://robin.etherscan.io/tx/0xbb47dfcf6ff484a93f7f7ffdb7b8151fe0c1fea5d92c2051eb386c9c7d958769)), with its 0.5% fee paid to the v2 FeeCollector.

USDG trades from hodl.fan on 2026-10-04 (same wallet). ORBIO has no USDG pool, so each went ORBIO ⇄ WETH ⇄ USDG through the Universal Router. Each paid its 0.5% fee in USDG to the v2 FeeCollector:

| Time (UTC) | Trade | Fee | Tx |
| --- | --- | --- | --- |
| 05:51 | Buy 16.95 ORBIO, paid 2 USDG | 0.01 USDG | [`0x92942f2d…a661`](https://robin.etherscan.io/tx/0x92942f2d76fdcc814da2b86324623e2121b044727a697914f59f6a17a8b6a661) |
| 05:53 | Sell 20 ORBIO, received 2.322 USDG | 0.011669 USDG | [`0x48926d3c…5c40`](https://robin.etherscan.io/tx/0x48926d3c52ac107047f64def550b5cbe7860fd994843799e56eff3ba07e45c40) |
| 05:54 | Sell 20 ORBIO, received 2.325 USDG | 0.011684 USDG | [`0x278d630b…6e54`](https://robin.etherscan.io/tx/0x278d630b8d6f06a931c6cf69ec6ea71d26a26714c277cf02cecc083be8ef6e54) |
| 06:05 | Sell 20 ORBIO, received 2.391 USDG | 0.012014 USDG | [`0xd257b3f1…a161`](https://robin.etherscan.io/tx/0xd257b3f12bdc76a27d926ea4598d375f6e45609d7402e3ce54b2af43431da161) |
| 06:06 | Sell 20 ORBIO, received 2.348 USDG | 0.011797 USDG | [`0xaac02207…c7aa`](https://robin.etherscan.io/tx/0xaac022072b31f5873c58c3c6cfa432956a42baee5b2a0c83655a499d390dc7aa) |

## Build

Requires [Foundry](https://getfoundry.sh). The dependencies are git submodules (`lib/forge-std`, `lib/openzeppelin-contracts`), pinned in `foundry.lock`.

```bash
git submodule update --init --recursive   # once, if you didn't clone with --recurse-submodules
cd contracts
forge build --sizes
forge fmt --check
```

## Trade flow

**Which trades come here.** HodlRouter handles **single-hop** trades only: one V3 or V4 pool with ETH, WETH or USDG on one side. For those, the fee, the caller's minimum and the $1 / $100 limits are enforced on-chain, as below. A token that is two hops away (for example ETH → USDG → stock → token) has no such pool, so the app sends it through Uniswap's Universal Router directly. That transaction pays the same 0.5% to `FeeCollector` (a `PAY_PORTION` or `TRANSFER` step the app adds), and **the app**, not this contract, enforces the $100 cap and the minimum before the wallet opens. It uses this router's own `quoteUsdg` for ETH amounts, so both paths measure a trade the same way.

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

- **Trades are capped at $100 while the contracts are unaudited.** The cap is set by our Safe and any change is timelocked for 2 days. We raise it after an audit.
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
forge test --no-match-contract Fork          # unit, fuzz, invariant, attack (no network)
forge test --match-contract HodlRouterFork   # fork suite (see below)
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

**Counts.** 103 tests: 95 unit, fuzz, invariant and attack tests, plus 8 fork tests. Coverage (fork suite excluded): **100%** of lines (279/279), statements (417/417), branches (123/123) and functions (48/48) in `HodlRouter` and `FeeCollector`.

**Fork tests.** `HodlRouterFork.t.sol` forks chain 4663 at a pinned `FORK_BLOCK` through the `rh` endpoint in `foundry.toml` (`${ALCHEMY_RPC_URL}`). The tests never skip: no RPC, or an RPC that has pruned `FORK_BLOCK`, is a failure. The public RPC keeps only ~20 minutes of state (the chain makes ~10 blocks/s), so a pinned block goes stale quickly. Reruns at the same block work from Foundry's on-disk cache (`~/.foundry/cache/rpc/robinhood/<FORK_BLOCK>/`), and nowhere else unless you have an archive RPC.

To run them on another machine:

```bash
export ALCHEMY_RPC_URL=https://rpc.mainnet.chain.robinhood.com   # or any 4663 RPC
cast block-number --rpc-url $ALCHEMY_RPC_URL                     # pick a block ~100 below this
# set FORK_BLOCK in test/HodlRouterFork.t.sol to that block, then straight away:
forge test --match-contract HodlRouterFork
```

The first run fetches state for ~1 minute and writes the cache; after that the same block reruns offline. Don't commit a bumped `FORK_BLOCK` unless you mean to move the pin.

If you ran `forge coverage` just before, forge may report "no tests match" for the fork suite: run `forge clean` or add `--force`.

**Slither** (0.11.4, 100 detectors, `--filter-paths "test|script|lib"`): 0 High, 24 Medium, 2 Low, 13 Informational. One High (`arbitrary-send-eth`) is suppressed in place: it flags `WETH.deposit{value: …}()`, and `WETH` is immutable. Every Medium and Low was reviewed and is a false positive or intended:
- `divide-before-multiply` (19): the `>> 128` steps of TickMath, identical to Uniswap's; checked against Uniswap's MIN/MAX sqrt prices and a 60-digit reference in tests.
- `incorrect-equality` (4): comparisons against zero and constants (`amount == 0`, `venue == VENUE_V3`, empty revert data).
- `unused-return` (1): `observe()`'s seconds-per-liquidity array isn't needed.
- `timestamp` (2): deadline and timelock comparisons.
- Informational: low-level calls and assembly (ETH sends, `balanceOf`, venue calls, revert bubbling), `WETH`/`USDG` naming (kept for ABI compatibility), unindexed `Paused`/`Unpaused` (kept from v1), TickMath literals and complexity.

**CI** (`.github/workflows/contracts.yml`): format, build, unit/fuzz/invariant tests, a ≥95% branch-coverage gate, and Slither failing on High. Fork tests can't run in CI (no archive RPC); run them locally before a deploy.

## Deploy

`script/Deploy.s.sol` deploys FeeCollector, then HodlRouter (paused, 50 bps, $100 cap) with the Uniswap, WETH, USDG and TWAP-pool addresses for chain 4663 hard-coded. It signs with an encrypted Foundry keystore and never reads a raw key. It never unpauses and never changes the fee or cap.

```bash
cast wallet import hodl-deployer --interactive                                               # once
forge script script/Deploy.s.sol --rpc-url $ALCHEMY_RPC_URL --account hodl-deployer             # dry run
forge script script/Deploy.s.sol --rpc-url $ALCHEMY_RPC_URL --account hodl-deployer --broadcast # deploy
```

The deployer becomes owner of both contracts. The run writes `broadcast/Deploy.s.sol/4663/run-latest.json`.

## Verify

Sourcify (no API key):

```bash
forge verify-contract <FEE_COLLECTOR> src/FeeCollector.sol:FeeCollector \
  --chain 4663 --verifier sourcify \
  --constructor-args $(cast abi-encode "constructor(address)" <DEPLOYER>)

forge verify-contract <ROUTER> src/HodlRouter.sol:HodlRouter \
  --chain 4663 --verifier sourcify \
  --constructor-args $(cast abi-encode \
    "constructor(address,address,address,address,address,address,uint256,address)" \
    <FEE_COLLECTOR> \
    0x8876789976dEcBfCbBbe364623C63652db8C0904 \
    0xCaf681a66D020601342297493863E78C959E5cb2 \
    0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 \
    0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 \
    0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca \
    100 <DEPLOYER>)
```

RobinScan ([robin.etherscan.io](https://robin.etherscan.io)): the same commands with `--verifier etherscan --etherscan-api-key <ETHERSCAN_API_KEY>`. An Etherscan API v2 key covers chain 4663.

The constructor arguments are the ones `Deploy.s.sol` passes: the Universal Router, SwapRouter02, WETH, USDG and the WETH/USDG pool, a $100 cap, and the deployer as initial owner. For v2 the deployer was `0x4523D729d7dac7445EDb6806677AB1EB667FD0BD`. Check that the build settings match `foundry.toml` (solc 0.8.26, cancun, optimizer 200 runs), or the bytecode won't match.

## Safe ownership

v2's owner is the Safe `0xD6bD19742663ac1B1f5dd33aDB453E6DD9321aF8` (Safe 1.5.0, threshold 2 of 3 owners). Every power in [Admin powers and delays](#admin-powers-and-delays) needs two Safe signatures, including `pause`.

Handing ownership to a Safe (or from one Safe to another) is two-step, for each contract:

1. The current owner calls `transferOwnership(<safe>)`. Ownership doesn't move yet; `pendingOwner()` shows the Safe.
2. The Safe executes `acceptOwnership()` on the contract (a Safe transaction with two signatures).
3. Check: `cast call <contract> "owner()(address)" --rpc-url $ALCHEMY_RPC_URL` returns the Safe.

`transferOwnership(address(0))` cancels a pending handover. Ownership can't be renounced.


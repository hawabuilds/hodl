// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title HodlRouter (v2)
/// @notice Single-transaction swap wrapper. Builds Universal Router / SwapRouter02
///         calldata internally. Never accepts `commands` or `inputs` from the caller.
///
/// Security approach (hook validation, not on-chain factory recovery):
///   The client already recovered the V4 PoolKey from the Pons factory or Long
///   Airlock (venue resolver). Re-reading those on every swap is extra gas and
///   several factory versions. PoolKey.hooks is the attack surface, so it must
///   be one of the two hardcoded hook addresses. currency0 < currency1 and one
///   side must be ETH / WETH / USDG. Unknown hooks revert before any UR call.
///
/// Funds in, swap, funds out — one function. Swap size is always measured from
/// what the caller actually sent, never from this contract's balance. At the end
/// of every trade no tracked balance (ETH, WETH, USDG, tokenIn, tokenOut) may be
/// higher than it was when the trade started. Donated or force-sent balances
/// therefore never block trading and are never spent; the owner can sweep them
/// while paused.
///
/// Admin: two-step ownership (OpenZeppelin Ownable2Step; renounce disabled).
/// Fee, notional cap and venue changes wait `TIMELOCK`. Pause / unpause are
/// instant (emergency button). Reentrancy lock: OpenZeppelin
/// ReentrancyGuardTransient (EIP-1153, as used by the V4 PoolManager here).
contract HodlRouter is Ownable2Step, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @notice Highest fee the owner can ever queue (1%).
    uint16 public constant MAX_FEE_BPS = 100;
    /// @notice Fee set at deploy (0.5%).
    uint16 public constant DEFAULT_FEE_BPS = 50;
    /// @notice Delay between queueing and executing an admin change.
    uint256 public constant TIMELOCK = 2 days;
    /// @notice Smallest trade, in USDG raw units ($1, 6 decimals).
    uint256 public constant DUST_USDG = 1_000_000;
    /// @notice USDG has 6 decimals; `maxNotionalUsd` is whole dollars.
    uint256 public constant USDG_DECIMALS_FACTOR = 1_000_000;
    /// @notice TWAP window, in seconds, for pricing ETH in USDG.
    uint32 public constant TWAP_WINDOW = 600;

    /// Confirmed on Robinhood Chain 4663. Do not change without a new review.
    /// @notice Pons Uniswap V4 hook.
    address public constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    /// @notice Long (Doppler) Uniswap V4 hook.
    address public constant LONG_HOOK = 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544;
    /// @notice Locked Pons PoolKey fee.
    uint24 public constant PONS_FEE = 0;
    /// @notice Locked Pons PoolKey tick spacing.
    int24 public constant PONS_TICK_SPACING = 200;
    /// @notice Locked Long PoolKey fee (dynamic-fee flag).
    uint24 public constant LONG_FEE = 0x800000;
    /// @notice Locked Long PoolKey tick spacing.
    int24 public constant LONG_TICK_SPACING = 8;

    uint8 internal constant UR_V4_SWAP = 0x10;
    uint8 internal constant V4_SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 internal constant V4_SETTLE = 0x0b;
    uint8 internal constant V4_SETTLE_ALL = 0x0c;
    uint8 internal constant V4_TAKE_ALL = 0x0f;

    /// @notice Trade event venue id for Uniswap V4 (Pons / Long).
    uint8 public constant VENUE_V4 = 0;
    /// @notice Trade event venue id for Uniswap V3 (SwapRouter02).
    uint8 public constant VENUE_V3 = 1;

    struct PoolKeyHint {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    /// Universal Router 2.1 `IV4Router.ExactInputSingleParams`.
    struct ExactInputSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    /// @notice Settings that can only change after `TIMELOCK`.
    enum Param {
        FeeBps,
        MaxNotionalUsd,
        UniversalRouter,
        SwapRouter02
    }

    struct Pending {
        uint256 value;
        uint256 eta;
    }

    /// Per-trade working state, kept in memory to stay within the stack limit.
    /// The five balances are taken at the start; none may be higher at the end.
    struct TradeState {
        uint256 eth;
        uint256 weth;
        uint256 usdg;
        uint256 tokenIn;
        uint256 tokenOut;
        uint256 fee;
        uint256 amountOut;
        uint8 venue;
    }

    // Storage: slot 0 = Ownable._owner. Slot 1 = Ownable2Step._pendingOwner (20)
    // + feeBps (2) + paused (1). Every trade reads feeBps and paused: one SLOAD.
    // The reentrancy lock is transient, so it costs no storage slot.
    /// @notice Fee in basis points, taken from the quote side of every trade.
    uint16 public feeBps;
    /// @notice True while trading is stopped.
    bool public paused;

    /// @notice Uniswap Universal Router used for V4 swaps.
    address public universalRouter;
    /// @notice Uniswap SwapRouter02 used for V3 swaps.
    address public swapRouter02;
    /// @notice Largest trade, in whole US dollars.
    uint256 public maxNotionalUsd;

    /// @notice Receives every fee. Fixed for the life of this router.
    address public immutable feeCollector;
    /// @notice Wrapped ETH.
    address public immutable WETH;
    /// @notice USDG stablecoin (6 decimals).
    address public immutable USDG;
    /// @notice Uniswap V3 WETH/USDG pool used as the ETH price oracle.
    address public immutable wethUsdgPool;

    Pending[4] private _pending;

    event Paused(address account);
    event Unpaused(address account);
    event ChangeQueued(Param indexed param, uint256 value, uint256 eta);
    event ChangeCancelled(Param indexed param, uint256 value);
    event ChangeExecuted(Param indexed param, uint256 oldValue, uint256 newValue);
    event Sweep(address indexed token, address indexed to, uint256 amount);
    event Trade(
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeAmount,
        address feeToken,
        uint8 venue
    );

    error ZeroAddress();
    error ZeroValue();
    error PausedError();
    error FeeTooHigh();
    error Dust();
    error Cap();
    error DeadlineExpired();
    error BadHook();
    error BadPool();
    error BadFeeTier();
    error BadPair();
    error NothingSupplied();
    error InsufficientOut();
    error Leftover(address token);
    error NothingQueued();
    error TimelockNotReady();
    error NoSweepWhileLive();
    error FeeOnTransferToken();
    error EthTransferFailed();
    error BalanceQueryFailed();
    error UnexpectedEth();
    error RenounceDisabled();

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    /// @notice Deploys paused with the default fee.
    /// @param feeCollector_ Fee recipient (immutable).
    /// @param universalRouter_ Uniswap Universal Router.
    /// @param swapRouter02_ Uniswap SwapRouter02.
    /// @param weth_ Wrapped ETH.
    /// @param usdg_ USDG (6 decimals).
    /// @param wethUsdgPool_ WETH (token0) / USDG (token1) Uniswap V3 pool used for the TWAP.
    /// @param maxNotionalUsd_ Largest trade in whole dollars. Must be non-zero.
    /// @param owner_ Initial owner (zero reverts `OwnableInvalidOwner`).
    constructor(
        address feeCollector_,
        address universalRouter_,
        address swapRouter02_,
        address weth_,
        address usdg_,
        address wethUsdgPool_,
        uint256 maxNotionalUsd_,
        address owner_
    ) Ownable(owner_) {
        if (
            feeCollector_ == address(0) || universalRouter_ == address(0)
                || swapRouter02_ == address(0) || weth_ == address(0) || usdg_ == address(0)
                || wethUsdgPool_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (maxNotionalUsd_ == 0) revert ZeroValue();
        feeCollector = feeCollector_;
        universalRouter = universalRouter_;
        swapRouter02 = swapRouter02_;
        WETH = weth_;
        USDG = usdg_;
        wethUsdgPool = wethUsdgPool_;
        maxNotionalUsd = maxNotionalUsd_;
        feeBps = DEFAULT_FEE_BPS;
        paused = true;
        emit Paused(owner_);
    }

    /// @notice Accepts ETH only while a trade is running (WETH unwraps, and V4
    ///         payouts, which the PoolManager sends directly). Gifts revert.
    /// @dev Force-sent ETH (selfdestruct) still lands; the no-gain check tolerates it.
    ///      ETH received mid-trade is either the swap output or reverts the trade
    ///      via `Leftover`, so nothing sent here can stay.
    receive() external payable {
        if (!_reentrancyGuardEntered()) revert UnexpectedEth();
    }

    // -------------------------------------------------------------------------
    // Trades
    // -------------------------------------------------------------------------

    /// @notice Buy `tokenOut` with native ETH. The fee is taken from the input.
    /// @param tokenOut Token to buy.
    /// @param minAmountOut Least `tokenOut` the caller must actually receive.
    /// @param hint V4 PoolKey (hooks = Pons/Long) or V3 fee tier (hooks = 0).
    /// @param deadline Last valid timestamp.
    function buy(
        address tokenOut,
        uint128 minAmountOut,
        PoolKeyHint calldata hint,
        uint256 deadline
    ) external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert NothingSupplied();
        _trade(address(0), msg.value, tokenOut, minAmountOut, hint, deadline, true);
    }

    /// @notice Buy `tokenOut` with USDG or WETH. The fee is taken from the input.
    /// @param tokenIn USDG or WETH. Caller must approve `amountIn`.
    /// @param amountIn Amount to pull from the caller.
    /// @param tokenOut Token to buy.
    /// @param minAmountOut Least `tokenOut` the caller must actually receive.
    /// @param hint V4 PoolKey (hooks = Pons/Long) or V3 fee tier (hooks = 0).
    /// @param deadline Last valid timestamp.
    function buyWithToken(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint128 minAmountOut,
        PoolKeyHint calldata hint,
        uint256 deadline
    ) external nonReentrant whenNotPaused {
        if (amountIn == 0) revert NothingSupplied();
        if (tokenIn != WETH && tokenIn != USDG) revert BadPair();
        _trade(tokenIn, amountIn, tokenOut, minAmountOut, hint, deadline, true);
    }

    /// @notice Sell a token for ETH, WETH or USDG. The fee is taken from the output,
    ///         and `minAmountOut` is checked after the fee.
    /// @dev Fee-on-transfer input tokens revert with `FeeOnTransferToken`: neither
    ///      V3 nor V4 can settle an input that shrinks in transit.
    /// @param tokenIn Token to sell. Caller must approve `amountIn`.
    /// @param amountIn Amount to pull from the caller.
    /// @param tokenOut ETH (address(0)), WETH or USDG.
    /// @param minAmountOut Least the caller must receive after the fee.
    /// @param hint V4 PoolKey (hooks = Pons/Long) or V3 fee tier (hooks = 0).
    /// @param deadline Last valid timestamp.
    function sell(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint128 minAmountOut,
        PoolKeyHint calldata hint,
        uint256 deadline
    ) external nonReentrant whenNotPaused {
        if (amountIn == 0) revert NothingSupplied();
        if (!_isQuote(tokenOut)) revert BadPair();
        _trade(tokenIn, amountIn, tokenOut, minAmountOut, hint, deadline, false);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice ETH value in USDG raw units at the `TWAP_WINDOW` average price.
    /// @param ethWei Amount of ETH in wei.
    /// @return USDG raw units (6 decimals).
    function quoteUsdg(uint256 ethWei) public view returns (uint256) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = TWAP_WINDOW;
        (int56[] memory cumulatives,) = IUniswapV3Pool(wethUsdgPool).observe(ago);
        int56 delta = cumulatives[1] - cumulatives[0];
        int56 window = int56(uint56(TWAP_WINDOW));
        int24 tick = int24(delta / window);
        if (delta < 0 && delta % window != 0) tick--;
        uint256 p = _sqrtPriceAtTick(tick);
        // WETH is token0, USDG token1: usdgRaw = ethWei * sqrtP² / 2^192.
        return (((ethWei * p) >> 96) * p) >> 96;
    }

    /// @notice A queued change and the earliest time it can execute.
    /// @param param Which setting.
    /// @return value Queued value (addresses are cast to uint256).
    /// @return eta Earliest execution time; zero when nothing is queued.
    function pendingChange(Param param) external view returns (uint256 value, uint256 eta) {
        Pending storage p = _pending[uint8(param)];
        return (p.value, p.eta);
    }

    // -------------------------------------------------------------------------
    // Admin — ownership (two-step, from Ownable2Step)
    // -------------------------------------------------------------------------

    /// @notice Disabled. Without an owner the router could never be unpaused,
    ///         swept or have a queued change executed or cancelled.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // -------------------------------------------------------------------------
    // Admin — instant
    // -------------------------------------------------------------------------

    /// @notice Stop all trading immediately.
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Resume trading immediately.
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Send this contract's whole balance of `token` to `to`. Paused only.
    /// @dev Only donated or force-sent funds can be here; trades never leave any.
    /// @param token Token to sweep, or address(0) for ETH.
    /// @param to Recipient.
    function sweep(address token, address to) external onlyOwner nonReentrant {
        if (!paused) revert NoSweepWhileLive();
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = _holdings(token);
        _push(token, to, amount);
        emit Sweep(token, to, amount);
    }

    // -------------------------------------------------------------------------
    // Admin — timelocked
    // -------------------------------------------------------------------------

    /// @notice Queue a new fee. Executable after `TIMELOCK`.
    /// @param next Fee in basis points, at most `MAX_FEE_BPS`.
    function queueFeeBps(uint16 next) external onlyOwner {
        if (next > MAX_FEE_BPS) revert FeeTooHigh();
        _queue(Param.FeeBps, next);
    }

    /// @notice Queue a new notional cap. Executable after `TIMELOCK`.
    /// @param next Cap in whole US dollars. Must be non-zero; use `pause` to stop trading.
    function queueMaxNotionalUsd(uint256 next) external onlyOwner {
        if (next == 0) revert ZeroValue();
        _queue(Param.MaxNotionalUsd, next);
    }

    /// @notice Queue a new Universal Router. Executable after `TIMELOCK`.
    /// @param next Router address.
    function queueUniversalRouter(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        _queue(Param.UniversalRouter, uint256(uint160(next)));
    }

    /// @notice Queue a new SwapRouter02. Executable after `TIMELOCK`.
    /// @param next Router address.
    function queueSwapRouter02(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        _queue(Param.SwapRouter02, uint256(uint160(next)));
    }

    /// @notice Drop a queued change.
    /// @param param Which setting.
    function cancelChange(Param param) external onlyOwner {
        Pending storage p = _pending[uint8(param)];
        if (p.eta == 0) revert NothingQueued();
        uint256 value = p.value;
        delete _pending[uint8(param)];
        emit ChangeCancelled(param, value);
    }

    /// @notice Apply a queued change once its delay has passed.
    /// @param param Which setting.
    function executeChange(Param param) external onlyOwner {
        Pending storage p = _pending[uint8(param)];
        uint256 eta = p.eta;
        if (eta == 0) revert NothingQueued();
        if (block.timestamp < eta) revert TimelockNotReady();
        uint256 next = p.value;
        delete _pending[uint8(param)];

        uint256 old;
        if (param == Param.FeeBps) {
            old = feeBps;
            feeBps = SafeCast.toUint16(next); // also bounded by queueFeeBps
        } else if (param == Param.MaxNotionalUsd) {
            old = maxNotionalUsd;
            maxNotionalUsd = next;
        } else if (param == Param.UniversalRouter) {
            old = uint160(universalRouter);
            universalRouter = address(uint160(next));
        } else {
            old = uint160(swapRouter02);
            swapRouter02 = address(uint160(next));
        }
        emit ChangeExecuted(param, old, next);
    }

    function _queue(Param param, uint256 value) private {
        uint256 eta = block.timestamp + TIMELOCK;
        _pending[uint8(param)] = Pending(value, eta);
        emit ChangeQueued(param, value, eta);
    }

    // -------------------------------------------------------------------------
    // Core
    // -------------------------------------------------------------------------

    function _trade(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint128 minAmountOut,
        PoolKeyHint calldata hint,
        uint256 deadline,
        bool feeOnInput
    ) private {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (tokenOut == tokenIn || (_isEthish(tokenIn) && _isEthish(tokenOut))) revert BadPair();

        // Hint is validated before any call to a caller-supplied token.
        TradeState memory t = _snapshot(_validateHint(hint, tokenIn, tokenOut), tokenIn, tokenOut);
        if (tokenIn != address(0)) _pullExact(tokenIn, amountIn, t.tokenIn);

        if (feeOnInput) t.fee = _takeFee(tokenIn, amountIn);
        t.amountOut =
            _swap(t.venue, hint, tokenIn, tokenOut, amountIn - t.fee, minAmountOut, deadline);
        if (!feeOnInput) {
            t.fee = _takeFee(tokenOut, t.amountOut);
            t.amountOut -= t.fee;
        }

        // The minimum applies to what the caller actually receives: after the
        // fee on sells, and after any transfer tax on buys.
        t.amountOut = _deliver(tokenOut, msg.sender, t.amountOut);
        if (t.amountOut < minAmountOut) revert InsufficientOut();
        _assertNoGain(t, tokenIn, tokenOut);

        emit Trade(
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            t.amountOut,
            t.fee,
            feeOnInput ? tokenIn : tokenOut,
            t.venue
        );
    }

    /// Pulls `amountIn` and reverts unless exactly that much arrived. Neither
    /// V3 nor V4 can settle an input that shrinks in transit, so a
    /// fee-on-transfer input fails here with a clear error, not deep in a venue.
    function _pullExact(address token, uint256 amountIn, uint256 before) private {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountIn);
        if (_balanceOf(token, address(this)) - before != amountIn) revert FeeOnTransferToken();
    }

    /// Checks the trade size on the quote side, then pays the fee on `amount`.
    function _takeFee(address quoteToken, uint256 amount) private returns (uint256 fee) {
        _enforceNotional(quoteToken, amount);
        fee = (amount * feeBps) / 10_000;
        _payFee(quoteToken, fee);
    }

    function _validateHint(PoolKeyHint calldata hint, address tokenIn, address tokenOut)
        private
        view
        returns (uint8 venue)
    {
        if (hint.hooks == address(0)) {
            if (!_v3Fee(hint.fee)) revert BadFeeTier();
            return VENUE_V3;
        }
        if (hint.hooks != PONS_HOOK && hint.hooks != LONG_HOOK) revert BadHook();
        if (hint.currency0 >= hint.currency1) revert BadPool();
        if (hint.hooks == PONS_HOOK) {
            if (hint.fee != PONS_FEE || hint.tickSpacing != PONS_TICK_SPACING) revert BadPool();
        } else {
            if (hint.fee != LONG_FEE || hint.tickSpacing != LONG_TICK_SPACING) revert BadPool();
        }
        address c0 = hint.currency0;
        address c1 = hint.currency1;
        if (!_isQuote(c0) && !_isQuote(c1)) revert BadPair();
        if (!_pairMatches(c0, c1, tokenIn, tokenOut)) revert BadPair();
        return VENUE_V4;
    }

    function _pairMatches(address c0, address c1, address tokenIn, address tokenOut)
        private
        view
        returns (bool)
    {
        return _isSide(c0, tokenIn) && _isSide(c1, tokenOut) || _isSide(c1, tokenIn)
            && _isSide(c0, tokenOut);
    }

    /// Native ETH and WETH are different PoolKeys; both count as the ETH quote.
    function _isSide(address currency, address token) private view returns (bool) {
        return currency == token || (_isEthish(currency) && _isEthish(token));
    }

    function _isEthish(address a) private view returns (bool) {
        return a == address(0) || a == WETH;
    }

    function _isQuote(address a) private view returns (bool) {
        return a == address(0) || a == WETH || a == USDG;
    }

    function _v3Fee(uint24 fee) private pure returns (bool) {
        return fee == 100 || fee == 500 || fee == 3000 || fee == 10000;
    }

    function _swap(
        uint8 venue,
        PoolKeyHint calldata hint,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint128 minAmountOut,
        uint256 deadline
    ) private returns (uint256 amountOut) {
        uint256 outBefore = _holdings(tokenOut);
        // Only what this swap produced is converted between ETH and WETH;
        // donated balances stay where they are.
        uint256 ethBefore = address(this).balance;
        uint256 wethBefore = _balanceOf(WETH, address(this));
        if (venue == VENUE_V3) {
            _swapV3(tokenIn, tokenOut, hint.fee, amountIn, minAmountOut);
        } else {
            _swapV4(hint, tokenIn, tokenOut, amountIn, minAmountOut, deadline);
        }
        if (tokenOut == address(0)) {
            uint256 produced = _balanceOf(WETH, address(this)) - wethBefore;
            if (produced > 0) IWETH9(WETH).withdraw(produced);
        } else if (tokenOut == WETH) {
            // A native-ETH V4 pool pays ETH; the caller asked for WETH. tokenIn is
            // not ETH-ish here, so any ETH gained came from the swap.
            uint256 produced = address(this).balance - ethBefore;
            // WETH is immutable: this ETH can only go to the WETH contract.
            // slither-disable-next-line arbitrary-send-eth
            if (produced > 0) IWETH9(WETH).deposit{value: produced}();
        }
        amountOut = _holdings(tokenOut) - outBefore;
    }

    function _swapV3(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint128 minAmountOut
    ) private {
        address routerIn = tokenIn == address(0) ? WETH : tokenIn;
        address routerOut = tokenOut == address(0) ? WETH : tokenOut;
        uint256 value = 0;
        if (tokenIn == address(0)) {
            value = amountIn;
        } else {
            IERC20(routerIn).forceApprove(swapRouter02, amountIn);
        }

        (bool ok, bytes memory data) = swapRouter02.call{value: value}(
            abi.encodeWithSelector(
                0x04e45aaf,
                routerIn,
                routerOut,
                fee,
                address(this),
                amountIn,
                uint256(minAmountOut),
                uint160(0)
            )
        );
        if (!ok) _propagate(data);
        if (tokenIn != address(0)) IERC20(routerIn).forceApprove(swapRouter02, 0);
    }

    function _swapV4(
        PoolKeyHint calldata hint,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint128 minAmountOut,
        uint256 deadline
    ) private {
        // ETH and WETH are interchangeable for the caller; use whichever the pool holds.
        address eth = hint.currency0 == address(0) ? address(0) : WETH;
        address currencyIn = _isEthish(tokenIn) ? eth : tokenIn;
        address currencyOut = _isEthish(tokenOut) ? eth : tokenOut;

        uint256 value = 0;
        if (currencyIn == address(0)) {
            if (tokenIn == WETH) IWETH9(WETH).withdraw(amountIn);
            value = amountIn;
        } else {
            if (tokenIn == address(0)) IWETH9(WETH).deposit{value: amountIn}();
            IERC20(currencyIn).safeTransfer(universalRouter, amountIn);
        }

        bytes memory commands = abi.encodePacked(UR_V4_SWAP);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = _encodeV4Swap(
            hint,
            currencyIn == hint.currency0,
            SafeCast.toUint128(amountIn),
            minAmountOut,
            currencyIn,
            currencyOut,
            value == 0
        );

        (bool ok, bytes memory data) = universalRouter.call{value: value}(
            abi.encodeWithSelector(IUniversalRouter.execute.selector, commands, inputs, deadline)
        );
        if (!ok) _propagate(data);
    }

    function _encodeV4Swap(
        PoolKeyHint calldata hint,
        bool zeroForOne,
        uint128 amountIn,
        uint128 minAmountOut,
        address currencyIn,
        address currencyOut,
        bool erc20In
    ) private pure returns (bytes memory) {
        // Encoded as one struct: the router's decoder reads a leading offset
        // word. (v1 encoded the fields flat, which only decoded when currency0
        // was address(0), i.e. native-ETH pools.)
        bytes memory swapParams = abi.encode(
            ExactInputSingleParams(
                PoolKey(hint.currency0, hint.currency1, hint.fee, hint.tickSpacing, hint.hooks),
                zeroForOne,
                amountIn,
                minAmountOut,
                0,
                ""
            )
        );
        bytes memory settle = erc20In
            ? abi.encode(currencyIn, uint256(amountIn), false)
            : abi.encode(currencyIn, uint256(amountIn));
        bytes memory take = abi.encode(currencyOut, uint256(minAmountOut));
        bytes memory actions = erc20In
            ? abi.encodePacked(V4_SWAP_EXACT_IN_SINGLE, V4_SETTLE, V4_TAKE_ALL)
            : abi.encodePacked(V4_SWAP_EXACT_IN_SINGLE, V4_SETTLE_ALL, V4_TAKE_ALL);
        bytes[] memory params = new bytes[](3);
        params[0] = swapParams;
        params[1] = settle;
        params[2] = take;
        return abi.encode(actions, params);
    }

    function _payFee(address token, uint256 amount) private {
        if (amount == 0) return;
        if (token == WETH) {
            IWETH9(WETH).withdraw(amount);
            _sendETH(feeCollector, amount);
        } else {
            _push(token, feeCollector, amount);
        }
    }

    /// Sends `amount` and returns what `to` actually gained, so a token that
    /// taxes transfers is checked against the caller's minimum.
    function _deliver(address token, address to, uint256 amount) private returns (uint256) {
        if (token == address(0)) {
            _sendETH(to, amount);
            return amount;
        }
        uint256 before = _balanceOf(token, to);
        IERC20(token).safeTransfer(to, amount);
        return _balanceOf(token, to) - before;
    }

    function _push(address token, address to, uint256 amount) private {
        if (token == address(0)) _sendETH(to, amount);
        else IERC20(token).safeTransfer(to, amount);
    }

    function _holdings(address token) private view returns (uint256) {
        if (token == address(0)) return address(this).balance;
        return _balanceOf(token, address(this));
    }

    function _snapshot(uint8 venue, address tokenIn, address tokenOut)
        private
        view
        returns (TradeState memory s)
    {
        s.venue = venue;
        s.eth = address(this).balance - msg.value;
        s.weth = _balanceOf(WETH, address(this));
        s.usdg = _balanceOf(USDG, address(this));
        if (tokenIn != address(0)) s.tokenIn = _balanceOf(tokenIn, address(this));
        if (tokenOut != address(0)) s.tokenOut = _balanceOf(tokenOut, address(this));
    }

    /// The trade may not leave anything behind: no balance is higher than at the start.
    function _assertNoGain(TradeState memory s, address tokenIn, address tokenOut) private view {
        if (address(this).balance > s.eth) revert Leftover(address(0));
        if (_balanceOf(WETH, address(this)) > s.weth) revert Leftover(WETH);
        if (_balanceOf(USDG, address(this)) > s.usdg) revert Leftover(USDG);
        if (tokenIn != address(0) && _balanceOf(tokenIn, address(this)) > s.tokenIn) {
            revert Leftover(tokenIn);
        }
        if (tokenOut != address(0) && _balanceOf(tokenOut, address(this)) > s.tokenOut) {
            revert Leftover(tokenOut);
        }
    }

    /// @dev The $1 floor and the $100 cap are risk limits on trade size, not
    ///      pricing inputs: no amount paid or received is derived from this
    ///      price. A 10-minute TWAP still stops a same-block push of the
    ///      WETH/USDG pool from moving either limit.
    function _enforceNotional(address quoteToken, uint256 amount) private view {
        // Callers only pass a quote token: buys check tokenIn, sells check tokenOut.
        uint256 usdgRaw = quoteToken == USDG ? amount : quoteUsdg(amount);
        if (usdgRaw < DUST_USDG) revert Dust();
        if (usdgRaw > maxNotionalUsd * USDG_DECIMALS_FACTOR) revert Cap();
    }

    /// sqrt(1.0001^tick) * 2^96. Same constants as Uniswap TickMath; |tick| is
    /// bounded by the int24 mean of a real pool, so no range check is needed
    /// beyond the one below.
    function _sqrtPriceAtTick(int24 tick) private pure returns (uint256) {
        uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
        if (absTick > 887272) revert BadPool();

        uint256 ratio = absTick & 0x1 != 0
            ? 0xfffcb933bd6fad37aa2d162d1a594001
            : 0x100000000000000000000000000000000;
        if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
        if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
        if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
        if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
        if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
        if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
        if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
        if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
        if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
        if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
        if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
        if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
        if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
        if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
        if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
        if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
        if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
        if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
        if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

        if (tick > 0) ratio = type(uint256).max / ratio;
        return (ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1);
    }

    function _sendETH(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    function _balanceOf(address token, address who) private view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(0x70a08231, who));
        if (!ok || data.length < 32) revert BalanceQueryFailed();
        return abi.decode(data, (uint256));
    }

    function _propagate(bytes memory data) private pure {
        if (data.length == 0) revert InsufficientOut();
        assembly {
            revert(add(data, 0x20), mload(data))
        }
    }
}

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)
        external
        payable;
}

interface IUniswapV3Pool {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128);
}

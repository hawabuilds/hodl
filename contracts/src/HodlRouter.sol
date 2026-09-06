// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title HodlRouter
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
/// Funds in, swap, funds out — one function. Swap size is always msg.value or
/// transferFrom amount, never this contract's balance. Both trade currencies
/// (and ETH) must be zero at the end of every external trade. Owner sweep
/// reverts while unpaused.
contract HodlRouter {
    uint16 public constant MAX_FEE_BPS = 100;
    uint16 public constant DEFAULT_FEE_BPS = 50;
    uint256 public constant TIMELOCK = 2 days;
    uint256 public constant DUST_USDG = 1_000_000; // $1, 6 decimals
    uint256 public constant USDG_DECIMALS_FACTOR = 1_000_000;

    /// Confirmed on Robinhood Chain 4663. Do not change without a new review.
    address public constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address public constant LONG_HOOK = 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544;
    uint24 public constant PONS_FEE = 0;
    int24 public constant PONS_TICK_SPACING = 200;
    uint24 public constant LONG_FEE = 0x800000;
    int24 public constant LONG_TICK_SPACING = 8;

    uint8 internal constant UR_V4_SWAP = 0x10;
    uint8 internal constant V4_SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 internal constant V4_SETTLE = 0x0b;
    uint8 internal constant V4_SETTLE_ALL = 0x0c;
    uint8 internal constant V4_TAKE_ALL = 0x0f;

    uint8 public constant VENUE_V4 = 0;
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

    address public owner;
    address public immutable feeCollector;
    address public immutable WETH;
    address public immutable USDG;
    address public immutable wethUsdgPool;

    address public universalRouter;
    address public swapRouter02;

    address public pendingUniversalRouter;
    uint256 public pendingUniversalRouterEta;
    address public pendingSwapRouter02;
    uint256 public pendingSwapRouter02Eta;

    uint16 public feeBps;
    uint256 public maxNotionalUsd;
    bool public paused;

    uint256 private _locked = 1;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeeChanged(uint16 oldBps, uint16 newBps);
    event MaxNotionalChanged(uint256 oldCap, uint256 newCap);
    event Paused(address account);
    event Unpaused(address account);
    event RouterProposed(bytes32 indexed which, address indexed next, uint256 eta);
    event RouterApplied(bytes32 indexed which, address indexed next);
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

    error NotOwner();
    error ZeroAddress();
    error PausedError();
    error NotPaused();
    error Reentrancy();
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
    error Leftover();
    error TimelockPending();
    error TimelockNotReady();
    error NoSweepWhileLive();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    constructor(
        address feeCollector_,
        address universalRouter_,
        address swapRouter02_,
        address weth_,
        address usdg_,
        address wethUsdgPool_,
        uint256 maxNotionalUsd_,
        address owner_
    ) {
        if (
            feeCollector_ == address(0) || universalRouter_ == address(0)
                || swapRouter02_ == address(0) || weth_ == address(0) || usdg_ == address(0)
                || wethUsdgPool_ == address(0) || owner_ == address(0)
        ) {
            revert ZeroAddress();
        }
        feeCollector = feeCollector_;
        universalRouter = universalRouter_;
        swapRouter02 = swapRouter02_;
        WETH = weth_;
        USDG = usdg_;
        wethUsdgPool = wethUsdgPool_;
        maxNotionalUsd = maxNotionalUsd_;
        owner = owner_;
        feeBps = DEFAULT_FEE_BPS;
        paused = true;
        emit OwnershipTransferred(address(0), owner_);
        emit Paused(owner_);
    }

    /// @dev Only WETH unwrap / Universal Router may send ETH. Direct gifts revert.
    receive() external payable {
        if (msg.sender != WETH && msg.sender != universalRouter) revert NothingSupplied();
    }

    // -------------------------------------------------------------------------
    // Trades
    // -------------------------------------------------------------------------

    /// @notice Buy `tokenOut` with native ETH. Skims the fee from the input.
    function buy(address tokenOut, uint128 minAmountOut, PoolKeyHint calldata hint, uint256 deadline)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        uint256 amountIn = msg.value;
        if (amountIn == 0) revert NothingSupplied();
        _trade(address(0), amountIn, tokenOut, minAmountOut, hint, deadline, true);
    }

    /// @notice Buy `tokenOut` with USDG or WETH. Skims the fee from the input.
    function buyWithToken(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint128 minAmountOut,
        PoolKeyHint calldata hint,
        uint256 deadline
    ) external nonReentrant whenNotPaused {
        if (amountIn == 0) revert NothingSupplied();
        if (!_isQuote(tokenIn) || tokenIn == address(0)) revert BadPair();
        _pull(tokenIn, msg.sender, amountIn);
        _trade(tokenIn, amountIn, tokenOut, minAmountOut, hint, deadline, true);
    }

    /// @notice Sell a launchpad token for ETH or USDG. Skims the fee from the output.
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
        _pull(tokenIn, msg.sender, amountIn);
        _trade(tokenIn, amountIn, tokenOut, minAmountOut, hint, deadline, false);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setFeeBps(uint16 next) external onlyOwner {
        if (next > MAX_FEE_BPS) revert FeeTooHigh();
        emit FeeChanged(feeBps, next);
        feeBps = next;
    }

    function setMaxNotionalUsd(uint256 next) external onlyOwner {
        emit MaxNotionalChanged(maxNotionalUsd, next);
        maxNotionalUsd = next;
    }

    function setUniversalRouter(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        pendingUniversalRouter = next;
        pendingUniversalRouterEta = block.timestamp + TIMELOCK;
        emit RouterProposed("ur", next, pendingUniversalRouterEta);
    }

    function applyUniversalRouter() external onlyOwner {
        if (pendingUniversalRouterEta == 0) revert TimelockPending();
        if (block.timestamp < pendingUniversalRouterEta) revert TimelockNotReady();
        universalRouter = pendingUniversalRouter;
        emit RouterApplied("ur", universalRouter);
        pendingUniversalRouter = address(0);
        pendingUniversalRouterEta = 0;
    }

    function setSwapRouter02(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        pendingSwapRouter02 = next;
        pendingSwapRouter02Eta = block.timestamp + TIMELOCK;
        emit RouterProposed("v3", next, pendingSwapRouter02Eta);
    }

    function applySwapRouter02() external onlyOwner {
        if (pendingSwapRouter02Eta == 0) revert TimelockPending();
        if (block.timestamp < pendingSwapRouter02Eta) revert TimelockNotReady();
        swapRouter02 = pendingSwapRouter02;
        emit RouterApplied("v3", swapRouter02);
        pendingSwapRouter02 = address(0);
        pendingSwapRouter02Eta = 0;
    }

    /// @notice Rescue stranded dust. Reverts while the router is live.
    function sweep(address token, address to) external onlyOwner nonReentrant {
        if (!paused) revert NoSweepWhileLive();
        if (to == address(0)) revert ZeroAddress();
        uint256 amount;
        if (token == address(0)) {
            amount = address(this).balance;
            _sendETH(to, amount);
        } else {
            amount = _balanceOf(token, address(this));
            _safeTransfer(token, to, amount);
        }
        emit Sweep(token, to, amount);
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
        if (tokenOut == tokenIn) revert BadPair();

        uint8 venue = _validateHint(hint, tokenIn, tokenOut);

        uint256 feeAmount;
        uint256 swapIn = amountIn;
        address feeToken = feeOnInput ? tokenIn : tokenOut;

        if (feeOnInput) {
            _enforceNotional(tokenIn, amountIn);
            feeAmount = (amountIn * feeBps) / 10_000;
            swapIn = amountIn - feeAmount;
            if (swapIn == 0) revert Dust();
            _payFee(tokenIn, feeAmount);
        }

        uint256 outBefore = _holdings(tokenOut);
        _swap(venue, hint, tokenIn, tokenOut, swapIn, minAmountOut, deadline);
        uint256 amountOut = _holdings(tokenOut) - outBefore;
        if (amountOut < minAmountOut) revert InsufficientOut();

        if (!feeOnInput) {
            _enforceNotional(tokenOut, amountOut);
            feeAmount = (amountOut * feeBps) / 10_000;
            amountOut -= feeAmount;
            _payFee(tokenOut, feeAmount);
        }

        _push(tokenOut, msg.sender, amountOut);
        _assertEmpty(tokenIn, tokenOut);

        emit Trade(msg.sender, tokenIn, tokenOut, amountIn, amountOut, feeAmount, feeToken, venue);
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
        return _isSide(c0, tokenIn) && _isSide(c1, tokenOut)
            || _isSide(c1, tokenIn) && _isSide(c0, tokenOut);
    }

    /// Native ETH and WETH are different PoolKeys; both count as the ETH quote.
    function _isSide(address currency, address token) private view returns (bool) {
        if (currency == token) return true;
        if (_isEthish(currency) && _isEthish(token)) return true;
        return false;
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
    ) private {
        if (venue == VENUE_V3) {
            _swapV3(tokenIn, tokenOut, hint.fee, amountIn, minAmountOut);
            return;
        }
        _swapV4(hint, tokenIn, tokenOut, amountIn, minAmountOut, deadline);
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
        uint256 value;
        if (tokenIn == address(0)) {
            value = amountIn;
        } else {
            _safeApprove(routerIn, swapRouter02, amountIn);
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
        if (tokenOut == address(0)) _unwrapAll();
        if (tokenIn != address(0)) _safeApprove(routerIn, swapRouter02, 0);
    }

    function _swapV4(
        PoolKeyHint calldata hint,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint128 minAmountOut,
        uint256 deadline
    ) private {
        bool poolNativeIn = _poolHas(hint, address(0)) && tokenIn == address(0);
        bool poolNativeOut = _poolHas(hint, address(0)) && tokenOut == address(0);
        address currencyIn = poolNativeIn ? address(0) : (tokenIn == address(0) ? WETH : tokenIn);
        address currencyOut = poolNativeOut ? address(0) : (tokenOut == address(0) ? WETH : tokenOut);

        uint256 value;
        if (currencyIn == address(0)) {
            value = amountIn;
        } else {
            if (tokenIn == address(0)) {
                IWETH9(WETH).deposit{value: amountIn}();
            }
            _safeTransfer(currencyIn, universalRouter, amountIn);
        }

        bool zeroForOne = currencyIn == hint.currency0;
        bytes memory commands = abi.encodePacked(UR_V4_SWAP);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = _encodeV4Swap(
            hint, zeroForOne, uint128(amountIn), minAmountOut, currencyIn, currencyOut, value == 0
        );

        (bool ok, bytes memory data) = universalRouter.call{value: value}(
            abi.encodeWithSelector(IUniversalRouter.execute.selector, commands, inputs, deadline)
        );
        if (!ok) _propagate(data);
        if (tokenOut == address(0)) _unwrapAll();
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
        bytes memory swapParams = abi.encode(
            PoolKey(hint.currency0, hint.currency1, hint.fee, hint.tickSpacing, hint.hooks),
            zeroForOne,
            amountIn,
            minAmountOut,
            uint256(0),
            bytes("")
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

    function _poolHas(PoolKeyHint calldata hint, address currency) private pure returns (bool) {
        return hint.currency0 == currency || hint.currency1 == currency;
    }

    function _payFee(address token, uint256 amount) private {
        if (amount == 0) return;
        if (token == address(0)) {
            _sendETH(feeCollector, amount);
        } else if (token == WETH) {
            IWETH9(WETH).withdraw(amount);
            _sendETH(feeCollector, amount);
        } else {
            _safeTransfer(token, feeCollector, amount);
        }
    }

    function _push(address token, address to, uint256 amount) private {
        if (amount == 0) return;
        if (token == address(0)) _sendETH(to, amount);
        else _safeTransfer(token, to, amount);
    }

    function _pull(address token, address from, uint256 amount) private {
        _safeTransferFrom(token, from, address(this), amount);
    }

    function _unwrapAll() private {
        uint256 bal = _balanceOf(WETH, address(this));
        if (bal > 0) IWETH9(WETH).withdraw(bal);
    }

    function _holdings(address token) private view returns (uint256) {
        if (token == address(0)) return address(this).balance;
        return _balanceOf(token, address(this));
    }

    function _assertEmpty(address tokenIn, address tokenOut) private view {
        if (address(this).balance != 0) revert Leftover();
        if (tokenIn != address(0) && _balanceOf(tokenIn, address(this)) != 0) revert Leftover();
        if (tokenOut != address(0) && _balanceOf(tokenOut, address(this)) != 0) revert Leftover();
        if (_balanceOf(WETH, address(this)) != 0) revert Leftover();
        if (_balanceOf(USDG, address(this)) != 0) revert Leftover();
    }

    function _enforceNotional(address quoteToken, uint256 amount) private view {
        uint256 usdgRaw;
        if (quoteToken == USDG) {
            usdgRaw = amount;
        } else if (_isEthish(quoteToken)) {
            usdgRaw = _ethToUsdg(amount);
        } else {
            revert BadPair();
        }
        if (usdgRaw < DUST_USDG) revert Dust();
        if (usdgRaw > maxNotionalUsd * USDG_DECIMALS_FACTOR) revert Cap();
    }

    /// WETH is token0, USDG token1 on the confirmed 0.01% pool.
    /// usdgRaw ≈ ethWei * sqrtPriceX96² / 2^192.
    function _ethToUsdg(uint256 ethWei) private view returns (uint256) {
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3Pool(wethUsdgPool).slot0();
        uint256 p = uint256(sqrtPriceX96);
        return ((ethWei * p) >> 96) * p >> 96;
    }

    function _sendETH(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        require(ok, "ETH_XFER");
    }

    function _balanceOf(address token, address who) private view returns (uint256) {
        (bool ok, bytes memory data) =
            token.staticcall(abi.encodeWithSelector(0x70a08231, who));
        require(ok && data.length >= 32, "BAL");
        return abi.decode(data, (uint256));
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "XFER");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "XFER_FROM");
    }

    function _safeApprove(address token, address spender, uint256 amount) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(0x095ea7b3, spender, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "APPROVE");
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
    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool);
}

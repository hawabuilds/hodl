// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HodlRouter} from "../src/HodlRouter.sol";
import {FeeCollector} from "../src/FeeCollector.sol";
import {ForceSend} from "./mocks/MockWeirdTokens.sol";

interface IERC20Min {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

interface IWETHMin {
    function deposit() external payable;
}

interface IPonsHook {
    function launches(bytes32)
        external
        view
        returns (bool registered, bool memecoinIsCurrency0, address memecoin, address quoteToken);
}

interface IAirlock {
    function getAssetData(address)
        external
        view
        returns (address numeraire, address, address, address, address poolInitializer, address);
}

interface IV3PoolMin {
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool);
}

/// Real Pons and Long V4 pools on Robinhood Chain (4663), pinned to FORK_BLOCK.
///
///   forge test --match-contract HodlRouterFork --fork-url <4663 RPC>
///
/// Without --fork-url the suite forks the `rh` endpoint in foundry.toml.
/// Either way it rolls to FORK_BLOCK. These tests never skip: no RPC, or an RPC
/// that has pruned FORK_BLOCK, is a failure. The public RPC keeps only ~20
/// minutes of state, so reruns rely on Foundry's on-disk fork cache
/// (~/.foundry/cache/rpc/4663/FORK_BLOCK) or an archive RPC. Bump FORK_BLOCK
/// to a recent block when neither is available.
///
/// Every PoolKey is checked on-chain in setUp (Pons hook `launches(poolId)`,
/// Long Airlock `getAssetData`), not taken on trust.
contract HodlRouterForkTest is Test {
    uint256 constant FORK_BLOCK = 79357027;

    address constant UR = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant SR02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant WETH_USDG = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;
    address constant AIRLOCK = 0xeb7C034704eF8Dcd2D32324c1545f62fB4aD0862;
    address constant V4_QUOTER = 0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94;
    address constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant LONG_HOOK = 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544;

    /// Pons, native ETH pair. Pool 0x7616ac53…
    address constant PONS_ETH_TOKEN = 0x986C2f2f7881CC1767a22919A6543f9ce291E62c; // SETTLE
    /// Pons, USDG pair. Pool 0x6cabefd9…
    address constant PONS_USDG_TOKEN = 0x7706C18ee62F64452E779db29A70C32f97e69F49; // FILL
    /// Long (Doppler), WETH numeraire.
    address constant LONG_WETH_TOKEN = 0x877c2492722aBdc0f81ec5cC17c1BA24dEd74C94; // CLIIPED
    /// Uniswap V3 1% pool with WETH on one side.
    address constant V3_POOL = 0x6D29159e52A1e41982cb058b1b14A7341A83360b;

    /// V4Quoter `QuoteExactSingleParams`; dynamic (has bytes), so it must be
    /// encoded as one struct, not as flat arguments.
    struct QuoteParams {
        HodlRouter.PoolKeyHint poolKey;
        bool zeroForOne;
        uint128 exactAmount;
        bytes hookData;
    }

    HodlRouter internal router;
    FeeCollector internal collector;
    address internal trader = makeAddr("trader");

    function setUp() public {
        if (block.chainid == 4663) vm.rollFork(FORK_BLOCK);
        else vm.createSelectFork("rh", FORK_BLOCK);
        assertEq(block.chainid, 4663, "not Robinhood Chain");
        // No block-number assert: on Arbitrum Orbit chains Foundry reports the
        // parent-chain block for block.number. The run header shows FORK_BLOCK.

        collector = new FeeCollector(address(this));
        router =
            new HodlRouter(address(collector), UR, SR02, WETH, USDG, WETH_USDG, 100, address(this));
        router.unpause();
        vm.deal(trader, 5 ether);
        deal(USDG, trader, 200e6);
    }

    // ---------------------------------------------------------------------
    // PoolKeys, verified on-chain
    // ---------------------------------------------------------------------

    function _key(address a, address b, address hooks)
        internal
        pure
        returns (HodlRouter.PoolKeyHint memory h)
    {
        (h.currency0, h.currency1) = a < b ? (a, b) : (b, a);
        h.hooks = hooks;
        if (hooks == PONS_HOOK) {
            h.fee = 0;
            h.tickSpacing = 200;
        } else {
            h.fee = 0x800000;
            h.tickSpacing = 8;
        }
    }

    function _id(HodlRouter.PoolKeyHint memory h) internal pure returns (bytes32) {
        return keccak256(abi.encode(h.currency0, h.currency1, h.fee, h.tickSpacing, h.hooks));
    }

    function _ponsKey(address token, address quote)
        internal
        view
        returns (HodlRouter.PoolKeyHint memory h)
    {
        h = _key(token, quote, PONS_HOOK);
        (bool registered,, address memecoin, address quoteToken) =
            IPonsHook(PONS_HOOK).launches(_id(h));
        assertTrue(registered, "Pons pool not registered");
        assertEq(memecoin, token);
        assertEq(quoteToken, quote);
    }

    function _longKey(address token) internal view returns (HodlRouter.PoolKeyHint memory h) {
        (address numeraire,,,, address initializer,) = IAirlock(AIRLOCK).getAssetData(token);
        assertEq(numeraire, WETH, "Long numeraire");
        assertEq(initializer, LONG_HOOK, "Long hook");
        h = _key(token, numeraire, LONG_HOOK);
    }

    function _quote(HodlRouter.PoolKeyHint memory h, bool zeroForOne, uint256 amount)
        internal
        returns (uint256 out)
    {
        QuoteParams memory q = QuoteParams(h, zeroForOne, uint128(amount), "");
        (bool ok, bytes memory data) = V4_QUOTER.call(
            abi.encodeWithSignature(
                "quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))",
                q
            )
        );
        assertTrue(ok, "quoter failed");
        (out,) = abi.decode(data, (uint256, uint256));
        assertGt(out, 0, "empty quote");
    }

    function _net(uint256 amount) internal view returns (uint256) {
        return amount - (amount * router.feeBps()) / 10_000;
    }

    function _assertRouterClean(address token) internal view {
        assertEq(address(router).balance, 0, "router ETH");
        assertEq(IERC20Min(WETH).balanceOf(address(router)), 0, "router WETH");
        assertEq(IERC20Min(USDG).balanceOf(address(router)), 0, "router USDG");
        assertEq(IERC20Min(token).balanceOf(address(router)), 0, "router token");
    }

    // ---------------------------------------------------------------------
    // Pons
    // ---------------------------------------------------------------------

    function testFork_pons_native_eth_buy_and_sell() public {
        HodlRouter.PoolKeyHint memory h = _ponsKey(PONS_ETH_TOKEN, address(0));
        uint256 value = 0.005 ether;

        uint256 expected = _quote(h, true, _net(value));
        uint256 minOut = (expected * 99) / 100;
        vm.prank(trader);
        router.buy{value: value}(PONS_ETH_TOKEN, uint128(minOut), h, block.timestamp + 300);
        uint256 bought = IERC20Min(PONS_ETH_TOKEN).balanceOf(trader);
        assertGe(bought, minOut, "buy below min");
        assertEq(address(collector).balance, value - _net(value), "buy fee");
        _assertRouterClean(PONS_ETH_TOKEN);

        uint256 gross = _quote(h, false, bought);
        uint256 sellMin = (_net(gross) * 99) / 100;
        uint256 ethBefore = trader.balance;
        vm.startPrank(trader);
        IERC20Min(PONS_ETH_TOKEN).approve(address(router), bought);
        router.sell(PONS_ETH_TOKEN, bought, address(0), uint128(sellMin), h, block.timestamp + 300);
        vm.stopPrank();
        assertGe(trader.balance - ethBefore, sellMin, "sell below min after fee");
        assertEq(IERC20Min(PONS_ETH_TOKEN).balanceOf(trader), 0);
        _assertRouterClean(PONS_ETH_TOKEN);
    }

    function testFork_pons_usdg_buy_and_sell() public {
        HodlRouter.PoolKeyHint memory h = _ponsKey(PONS_USDG_TOKEN, USDG);
        uint256 amountIn = 20e6;
        bool usdgIs0 = h.currency0 == USDG;

        uint256 expected = _quote(h, usdgIs0, _net(amountIn));
        uint256 minOut = (expected * 99) / 100;
        vm.startPrank(trader);
        IERC20Min(USDG).approve(address(router), amountIn);
        router.buyWithToken(
            USDG, amountIn, PONS_USDG_TOKEN, uint128(minOut), h, block.timestamp + 300
        );
        vm.stopPrank();
        uint256 bought = IERC20Min(PONS_USDG_TOKEN).balanceOf(trader);
        assertGe(bought, minOut);
        assertEq(IERC20Min(USDG).balanceOf(address(collector)), amountIn - _net(amountIn));
        _assertRouterClean(PONS_USDG_TOKEN);

        uint256 gross = _quote(h, !usdgIs0, bought);
        uint256 sellMin = (_net(gross) * 99) / 100;
        uint256 usdgBefore = IERC20Min(USDG).balanceOf(trader);
        vm.startPrank(trader);
        IERC20Min(PONS_USDG_TOKEN).approve(address(router), bought);
        router.sell(PONS_USDG_TOKEN, bought, USDG, uint128(sellMin), h, block.timestamp + 300);
        vm.stopPrank();
        assertGe(IERC20Min(USDG).balanceOf(trader) - usdgBefore, sellMin);
        _assertRouterClean(PONS_USDG_TOKEN);
    }

    // ---------------------------------------------------------------------
    // Long
    // ---------------------------------------------------------------------

    function testFork_long_weth_buy_and_sell() public {
        HodlRouter.PoolKeyHint memory h = _longKey(LONG_WETH_TOKEN);
        uint256 value = 0.005 ether;
        bool wethIs0 = h.currency0 == WETH;

        uint256 expected = _quote(h, wethIs0, _net(value));
        uint256 minOut = (expected * 99) / 100;
        vm.prank(trader);
        router.buy{value: value}(LONG_WETH_TOKEN, uint128(minOut), h, block.timestamp + 300);
        uint256 bought = IERC20Min(LONG_WETH_TOKEN).balanceOf(trader);
        assertGe(bought, minOut);
        _assertRouterClean(LONG_WETH_TOKEN);

        uint256 gross = _quote(h, !wethIs0, bought);
        uint256 sellMin = (_net(gross) * 99) / 100;
        uint256 ethBefore = trader.balance;
        vm.startPrank(trader);
        IERC20Min(LONG_WETH_TOKEN).approve(address(router), bought);
        router.sell(LONG_WETH_TOKEN, bought, address(0), uint128(sellMin), h, block.timestamp + 300);
        vm.stopPrank();
        assertGe(trader.balance - ethBefore, sellMin);
        assertGt(address(collector).balance, 0);
        _assertRouterClean(LONG_WETH_TOKEN);
    }

    function testFork_long_buy_with_weth_sell_to_weth() public {
        HodlRouter.PoolKeyHint memory h = _longKey(LONG_WETH_TOKEN);
        vm.startPrank(trader);
        IWETHMin(WETH).deposit{value: 0.01 ether}();
        IERC20Min(WETH).approve(address(router), 0.01 ether);
        router.buyWithToken(WETH, 0.01 ether, LONG_WETH_TOKEN, 1, h, block.timestamp + 300);
        uint256 bought = IERC20Min(LONG_WETH_TOKEN).balanceOf(trader);
        IERC20Min(LONG_WETH_TOKEN).approve(address(router), bought);
        router.sell(LONG_WETH_TOKEN, bought, WETH, 1, h, block.timestamp + 300);
        vm.stopPrank();
        assertGt(IERC20Min(WETH).balanceOf(trader), 0);
        _assertRouterClean(LONG_WETH_TOKEN);
    }

    // ---------------------------------------------------------------------
    // Donations on real venues
    // ---------------------------------------------------------------------

    function testFork_donations_do_not_block_real_trades() public {
        HodlRouter.PoolKeyHint memory h = _ponsKey(PONS_ETH_TOKEN, address(0));
        deal(USDG, address(router), 3e6);
        vm.deal(address(this), 1 ether);
        IWETHMin(WETH).deposit{value: 0.1 ether}();
        IERC20Min(WETH).transfer(address(router), 0.1 ether);
        new ForceSend{value: 0.2 ether}(payable(address(router)));
        deal(PONS_ETH_TOKEN, address(router), 1 ether);

        vm.prank(trader);
        router.buy{value: 0.005 ether}(PONS_ETH_TOKEN, 1, h, block.timestamp + 300);
        uint256 bought = IERC20Min(PONS_ETH_TOKEN).balanceOf(trader);
        vm.startPrank(trader);
        IERC20Min(PONS_ETH_TOKEN).approve(address(router), bought);
        router.sell(PONS_ETH_TOKEN, bought, address(0), 1, h, block.timestamp + 300);
        vm.stopPrank();

        assertEq(address(router).balance, 0.2 ether);
        assertEq(IERC20Min(WETH).balanceOf(address(router)), 0.1 ether);
        assertEq(IERC20Min(USDG).balanceOf(address(router)), 3e6);
        assertEq(IERC20Min(PONS_ETH_TOKEN).balanceOf(address(router)), 1 ether);
    }

    // ---------------------------------------------------------------------
    // V3, slippage, limits, oracle
    // ---------------------------------------------------------------------

    function testFork_v3_buy() public {
        (bool ok, bytes memory d0) = V3_POOL.staticcall(abi.encodeWithSignature("token0()"));
        (bool ok1, bytes memory d1) = V3_POOL.staticcall(abi.encodeWithSignature("token1()"));
        assertTrue(ok && ok1);
        address t0 = abi.decode(d0, (address));
        address t1 = abi.decode(d1, (address));
        address token = t0 == WETH ? t1 : t0;
        HodlRouter.PoolKeyHint memory h = HodlRouter.PoolKeyHint(t0, t1, 10000, 0, address(0));
        vm.prank(trader);
        router.buy{value: 0.005 ether}(token, 1, h, block.timestamp + 300);
        assertGt(IERC20Min(token).balanceOf(trader), 0);
        _assertRouterClean(token);
    }

    function testFork_slippage_deadline_and_limits() public {
        HodlRouter.PoolKeyHint memory h = _ponsKey(PONS_ETH_TOKEN, address(0));
        vm.startPrank(trader);
        vm.expectRevert();
        router.buy{value: 0.005 ether}(PONS_ETH_TOKEN, type(uint128).max, h, block.timestamp + 300);
        vm.expectRevert(HodlRouter.DeadlineExpired.selector);
        router.buy{value: 0.005 ether}(PONS_ETH_TOKEN, 1, h, block.timestamp - 1);
        vm.expectRevert(HodlRouter.Dust.selector);
        router.buy{value: 1}(PONS_ETH_TOKEN, 1, h, block.timestamp + 300);
        vm.expectRevert(HodlRouter.Cap.selector);
        router.buy{value: 1 ether}(PONS_ETH_TOKEN, 1, h, block.timestamp + 300);
        vm.stopPrank();
        _assertRouterClean(PONS_ETH_TOKEN);
    }

    function testFork_twap_tracks_spot() public view {
        (uint160 sqrtP,,,,,,) = IV3PoolMin(WETH_USDG).slot0();
        uint256 p = uint256(sqrtP);
        uint256 spot = (((1 ether * p) >> 96) * p) >> 96;
        uint256 twap = router.quoteUsdg(1 ether);
        assertApproxEqRel(twap, spot, 0.02e18, "TWAP far from spot");
        assertGt(twap, 500e6);
        assertLt(twap, 20_000e6);
    }
}

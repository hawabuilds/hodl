// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {HodlRouter} from "../src/HodlRouter.sol";
import {FeeCollector} from "../src/FeeCollector.sol";

/// @dev Live 4663 tokens named in contracts.ts discovery comments.
///      PoolKeys are recovered from the Pons factory / Long Airlock — never
///      from a database pair_address.
interface IAirlock {
    function getAssetData(address)
        external
        view
        returns (
            address numeraire,
            address timelock,
            address governance,
            address liquidityMigrator,
            address poolInitializer,
            address pool
        );
}

interface IERC20Min {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// Run with: forge test --match-contract HodlRouterFork --fork-url $ALCHEMY_RPC_URL
/// These tests do not broadcast. They deploy a throwaway router on the fork.
///
/// Discovery "newest" Pons/Long tokens often pair an RWA (RBLX, HIMS), not
/// ETH/USDG. HodlRouter correctly rejects those (fee must be ETH or USDG).
/// The V4 ETH case uses the first Long Create whose numeraire is WETH.
contract HodlRouterForkTest is Test {
    address constant UR = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant SR02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant WETH_USDG = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;
    address constant AIRLOCK = 0xeb7C034704eF8Dcd2D32324c1545f62fB4aD0862;
    address constant LONG_HOOK = 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544;

    /// First Long Create on this Airlock. numeraire is WETH (confirmed via getAssetData).
    address constant LONG_WETH_TOKEN = 0xA61B14c20b3fBd26A16507459Ba48658a64bf7Be;
    address constant V3_POOL = 0x6D29159e52A1e41982cb058b1b14A7341A83360b;

    HodlRouter internal router;
    FeeCollector internal collector;
    address internal trader = address(0x70D);

    modifier onFork() {
        if (block.chainid != 4663) {
            vm.skip(true);
            return;
        }
        _;
    }

    function setUp() public onFork {
        collector = new FeeCollector(address(this));
        router = new HodlRouter(address(collector), UR, SR02, WETH, USDG, WETH_USDG, 100, address(this));
        router.unpause();
        vm.deal(trader, 5 ether);
        deal(USDG, trader, 200 * 1e6);
    }

    function _longHint(address token) internal view returns (HodlRouter.PoolKeyHint memory hint) {
        (address numeraire,,,, address initializer,) = IAirlock(AIRLOCK).getAssetData(token);
        address hooks = initializer == address(0) ? LONG_HOOK : initializer;
        address c0 = token < numeraire ? token : numeraire;
        address c1 = token < numeraire ? numeraire : token;
        hint = HodlRouter.PoolKeyHint(c0, c1, 0x800000, 8, hooks);
    }

    function testFork_v4_weth_long_buy_and_sell() public onFork {
        HodlRouter.PoolKeyHint memory hint = _longHint(LONG_WETH_TOKEN);
        if (!_v4Quotes(hint, uint128(0.005 ether))) {
            vm.skip(true);
            return;
        }
        uint256 before = IERC20Min(LONG_WETH_TOKEN).balanceOf(trader);
        vm.startPrank(trader);
        router.buy{value: 0.005 ether}(LONG_WETH_TOKEN, 1, hint, block.timestamp + 300);
        uint256 held = IERC20Min(LONG_WETH_TOKEN).balanceOf(trader);
        assertGt(held, before);
        assertEq(address(router).balance, 0);
        IERC20Min(LONG_WETH_TOKEN).approve(address(router), held - before);
        router.sell(LONG_WETH_TOKEN, held - before, address(0), 1, hint, block.timestamp + 300);
        vm.stopPrank();
        assertEq(address(router).balance, 0);
        assertEq(IERC20Min(LONG_WETH_TOKEN).balanceOf(address(router)), 0);
        assertGt(address(collector).balance, 0);
    }

    function testFork_v3_where_pool_exists() public onFork {
        address token0 = _v3token0();
        address token1 = _v3token1();
        address token = token0 == WETH ? token1 : token0;
        HodlRouter.PoolKeyHint memory hint = HodlRouter.PoolKeyHint({
            currency0: token0,
            currency1: token1,
            fee: 10000,
            tickSpacing: 0,
            hooks: address(0)
        });
        vm.startPrank(trader);
        router.buy{value: 0.005 ether}(token, 1, hint, block.timestamp + 300);
        vm.stopPrank();
        assertEq(address(router).balance, 0);
        assertGt(IERC20Min(token).balanceOf(trader), 0);
    }

    function testFork_slippage_and_deadline() public onFork {
        HodlRouter.PoolKeyHint memory hint = _longHint(LONG_WETH_TOKEN);
        vm.startPrank(trader);
        vm.expectRevert();
        router.buy{value: 0.005 ether}(LONG_WETH_TOKEN, type(uint128).max, hint, block.timestamp + 300);
        vm.expectRevert(HodlRouter.DeadlineExpired.selector);
        router.buy{value: 0.005 ether}(LONG_WETH_TOKEN, 1, hint, block.timestamp - 1);
        vm.stopPrank();
        assertEq(address(router).balance, 0);
    }

    function testFork_dust_and_fee_bounds() public onFork {
        vm.expectRevert(HodlRouter.FeeTooHigh.selector);
        router.setFeeBps(101);
        HodlRouter.PoolKeyHint memory hint = _longHint(LONG_WETH_TOKEN);
        vm.startPrank(trader);
        vm.expectRevert(HodlRouter.Dust.selector);
        router.buy{value: 1}(LONG_WETH_TOKEN, 1, hint, block.timestamp + 300);
        vm.stopPrank();
    }

    address constant V4_QUOTER = 0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94;

    function _v4Quotes(HodlRouter.PoolKeyHint memory hint, uint128 amount) private returns (bool) {
        bool zeroForOne = hint.currency0 == address(0) || hint.currency0 == WETH;
        try this._quoteV4(hint, zeroForOne, amount) returns (uint256 out) {
            return out > 0;
        } catch {
            return false;
        }
    }

    function _quoteV4(HodlRouter.PoolKeyHint memory hint, bool zeroForOne, uint128 amount)
        external
        returns (uint256)
    {
        (bool ok, bytes memory data) = V4_QUOTER.call(
            abi.encodeWithSignature(
                "quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))",
                hint.currency0,
                hint.currency1,
                hint.fee,
                hint.tickSpacing,
                hint.hooks,
                zeroForOne,
                amount,
                ""
            )
        );
        if (!ok) revert();
        (uint256 out,) = abi.decode(data, (uint256, uint256));
        return out;
    }

    function _v3token0() private view returns (address) {
        (bool ok, bytes memory data) = V3_POOL.staticcall(abi.encodeWithSignature("token0()"));
        require(ok);
        return abi.decode(data, (address));
    }

    function _v3token1() private view returns (address) {
        (bool ok, bytes memory data) = V3_POOL.staticcall(abi.encodeWithSignature("token1()"));
        require(ok);
        return abi.decode(data, (address));
    }
}

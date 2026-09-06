// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {HodlRouter} from "../src/HodlRouter.sol";
import {FeeCollector} from "../src/FeeCollector.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockWETH} from "./mocks/MockWETH.sol";
import {MockUniversalRouter, MockSwapRouter02, MockWethUsdgPool} from "./mocks/MockVenues.sol";

contract HodlRouterTest is Test {
    receive() external payable {}

    HodlRouter internal router;
    FeeCollector internal collector;
    MockWETH internal weth;
    MockERC20 internal usdg;
    MockERC20 internal meme;
    MockUniversalRouter internal ur;
    MockSwapRouter02 internal v3;
    MockWethUsdgPool internal pool;

    address internal owner = address(this);
    address internal alice = address(0xA11CE);

    HodlRouter.PoolKeyHint internal pons;
    HodlRouter.PoolKeyHint internal longHint;
    HodlRouter.PoolKeyHint internal v3Hint;

    function setUp() public {
        weth = new MockWETH();
        usdg = new MockERC20("USDG", "USDG", 6);
        meme = new MockERC20("MEME", "MEME", 18);
        ur = new MockUniversalRouter();
        v3 = new MockSwapRouter02();
        pool = new MockWethUsdgPool();
        collector = new FeeCollector(owner);
        router = new HodlRouter(
            address(collector),
            address(ur),
            address(v3),
            address(weth),
            address(usdg),
            address(pool),
            100,
            owner
        );
        assertTrue(router.paused());

        address c0 = address(0) < address(meme) ? address(0) : address(meme);
        address c1 = address(0) < address(meme) ? address(meme) : address(0);
        pons = HodlRouter.PoolKeyHint({
            currency0: c0,
            currency1: c1,
            fee: 0,
            tickSpacing: 200,
            hooks: router.PONS_HOOK()
        });

        address l0 = address(usdg) < address(meme) ? address(usdg) : address(meme);
        address l1 = address(usdg) < address(meme) ? address(meme) : address(usdg);
        longHint = HodlRouter.PoolKeyHint({
            currency0: l0,
            currency1: l1,
            fee: 0x800000,
            tickSpacing: 8,
            hooks: router.LONG_HOOK()
        });

        v3Hint = HodlRouter.PoolKeyHint({
            currency0: address(weth) < address(meme) ? address(weth) : address(meme),
            currency1: address(weth) < address(meme) ? address(meme) : address(weth),
            fee: 3000,
            tickSpacing: 0,
            hooks: address(0)
        });

        vm.deal(alice, 100 ether);
        usdg.mint(alice, 1_000_000 * 1e6);
        meme.mint(alice, 1_000_000 ether);
        router.unpause();
    }

    function _fundOut(address token, uint256 amount) internal {
        if (token == address(0)) {
            vm.deal(address(ur), amount);
            ur.setOutput(address(0), amount);
            vm.deal(address(v3), amount);
            v3.setOutput(address(0), amount);
        } else {
            MockERC20(token).mint(address(ur), amount);
            ur.setOutput(token, amount);
            MockERC20(token).mint(address(v3), amount);
            v3.setOutput(token, amount);
        }
    }

    function test_setFeeBps_101_reverts() public {
        vm.expectRevert(HodlRouter.FeeTooHigh.selector);
        router.setFeeBps(101);
    }

    function test_setFeeBps_0_then_trade_is_free() public {
        router.setFeeBps(0);
        uint256 out = 10 ether;
        _fundOut(address(meme), out);
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(meme), 1, pons, block.timestamp + 60);
        assertEq(meme.balanceOf(alice), 1_000_000 ether + out);
        assertEq(address(collector).balance, 0);
        assertEq(address(router).balance, 0);
    }

    function test_pause_blocks_trading() public {
        router.pause();
        vm.prank(alice);
        vm.expectRevert(HodlRouter.PausedError.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, pons, block.timestamp + 60);
    }

    function test_deadline_reverts() public {
        vm.prank(alice);
        vm.expectRevert(HodlRouter.DeadlineExpired.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, pons, block.timestamp - 1);
    }

    function test_dust_usdg_reverts() public {
        vm.startPrank(alice);
        usdg.approve(address(router), 999_999);
        vm.expectRevert(HodlRouter.Dust.selector);
        router.buyWithToken(address(usdg), 999_999, address(meme), 1, longHint, block.timestamp + 60);
        vm.stopPrank();
    }

    function test_usdg_one_dollar_fee_is_5000_not_18_decimals() public {
        _fundOut(address(meme), 1 ether);
        vm.startPrank(alice);
        usdg.approve(address(router), 1_000_000);
        router.buyWithToken(address(usdg), 1_000_000, address(meme), 1, longHint, block.timestamp + 60);
        vm.stopPrank();
        assertEq(usdg.balanceOf(address(collector)), 5_000);
        assertNotEq(usdg.balanceOf(address(collector)), 5e15);
        assertEq(usdg.balanceOf(address(router)), 0);
        assertEq(meme.balanceOf(address(router)), 0);
    }

    function test_buy_native_v4_skims_input_fee() public {
        uint256 value = 0.01 ether;
        uint256 fee = (value * 50) / 10_000;
        _fundOut(address(meme), 5 ether);
        vm.prank(alice);
        router.buy{value: value}(address(meme), 1, pons, block.timestamp + 60);
        assertEq(address(collector).balance, fee);
        assertEq(ur.lastCommands(), hex"10");
        assertEq(ur.lastValue(), value - fee);
        assertEq(address(router).balance, 0);
        assertEq(meme.balanceOf(address(router)), 0);
    }

    function test_buy_usdg_v4_long() public {
        uint256 amountIn = 20 * 1e6;
        uint256 fee = (amountIn * 50) / 10_000;
        _fundOut(address(meme), 3 ether);
        vm.startPrank(alice);
        usdg.approve(address(router), amountIn);
        router.buyWithToken(address(usdg), amountIn, address(meme), 1, longHint, block.timestamp + 60);
        vm.stopPrank();
        assertEq(usdg.balanceOf(address(collector)), fee);
        assertEq(usdg.balanceOf(address(router)), 0);
        assertEq(meme.balanceOf(alice), 1_000_000 ether + 3 ether);
    }

    function test_sell_v4_to_eth_skims_output_fee() public {
        uint256 out = 0.02 ether;
        uint256 fee = (out * 50) / 10_000;
        _fundOut(address(0), out);
        vm.startPrank(alice);
        meme.approve(address(router), 10 ether);
        uint256 before = alice.balance;
        router.sell(address(meme), 10 ether, address(0), 1, pons, block.timestamp + 60);
        vm.stopPrank();
        assertEq(alice.balance, before + out - fee);
        assertEq(address(collector).balance, fee);
        assertEq(address(router).balance, 0);
    }

    function test_sell_v4_to_usdg() public {
        uint256 out = 15 * 1e6;
        uint256 fee = (out * 50) / 10_000;
        _fundOut(address(usdg), out);
        vm.startPrank(alice);
        meme.approve(address(router), 10 ether);
        uint256 before = usdg.balanceOf(alice);
        router.sell(address(meme), 10 ether, address(usdg), 1, longHint, block.timestamp + 60);
        vm.stopPrank();
        assertEq(usdg.balanceOf(alice), before + out - fee);
        assertEq(usdg.balanceOf(address(collector)), fee);
        assertEq(usdg.balanceOf(address(router)), 0);
    }

    function test_v3_path() public {
        _fundOut(address(meme), 4 ether);
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(meme), 1, v3Hint, block.timestamp + 60);
        assertEq(meme.balanceOf(alice), 1_000_000 ether + 4 ether);
        assertEq(address(router).balance, 0);
        assertEq(meme.balanceOf(address(router)), 0);
    }

    function test_slippage_breach_reverts() public {
        _fundOut(address(meme), 1 ether);
        vm.prank(alice);
        vm.expectRevert(HodlRouter.InsufficientOut.selector);
        router.buy{value: 0.01 ether}(address(meme), uint128(2 ether), pons, block.timestamp + 60);
    }

    function test_bad_hook_reverts() public {
        HodlRouter.PoolKeyHint memory evil = pons;
        evil.hooks = address(0xDEAD);
        vm.prank(alice);
        vm.expectRevert(HodlRouter.BadHook.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, evil, block.timestamp + 60);
    }

    function test_currency_order_reverts() public {
        HodlRouter.PoolKeyHint memory bad = pons;
        address tmp = bad.currency0;
        bad.currency0 = bad.currency1;
        bad.currency1 = tmp;
        vm.prank(alice);
        vm.expectRevert(HodlRouter.BadPool.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, bad, block.timestamp + 60);
    }

    function test_cap_reverts() public {
        router.setMaxNotionalUsd(1);
        vm.startPrank(alice);
        usdg.approve(address(router), 2_000_000);
        vm.expectRevert(HodlRouter.Cap.selector);
        router.buyWithToken(address(usdg), 2_000_000, address(meme), 1, longHint, block.timestamp + 60);
        vm.stopPrank();
    }

    function test_router_balances_zero_after_every_trade() public {
        _fundOut(address(meme), 2 ether);
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(meme), 1, pons, block.timestamp + 60);

        _fundOut(address(meme), 2 ether);
        vm.startPrank(alice);
        usdg.approve(address(router), 5e6);
        router.buyWithToken(address(usdg), 5e6, address(meme), 1, longHint, block.timestamp + 60);
        vm.stopPrank();

        _fundOut(address(0), 0.02 ether);
        vm.startPrank(alice);
        meme.approve(address(router), 1 ether);
        router.sell(address(meme), 1 ether, address(0), 1, pons, block.timestamp + 60);
        vm.stopPrank();

        _fundOut(address(meme), 2 ether);
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(meme), 1, v3Hint, block.timestamp + 60);

        assertEq(address(router).balance, 0);
        assertEq(weth.balanceOf(address(router)), 0);
        assertEq(usdg.balanceOf(address(router)), 0);
        assertEq(meme.balanceOf(address(router)), 0);
    }

    function test_router_targets_are_timelocked() public {
        address next = address(0xBEEF);
        router.setUniversalRouter(next);
        vm.expectRevert(HodlRouter.TimelockNotReady.selector);
        router.applyUniversalRouter();
        vm.warp(block.timestamp + 2 days);
        router.applyUniversalRouter();
        assertEq(router.universalRouter(), next);
    }

    function test_sweep_reverts_while_unpaused() public {
        vm.expectRevert(HodlRouter.NoSweepWhileLive.selector);
        router.sweep(address(0), owner);
    }

    function test_receive_rejects_strangers() public {
        vm.prank(alice);
        (bool ok,) = address(router).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_buy_wraps_eth_when_pool_is_weth() public {
        HodlRouter.PoolKeyHint memory wethHint = HodlRouter.PoolKeyHint({
            currency0: address(weth) < address(meme) ? address(weth) : address(meme),
            currency1: address(weth) < address(meme) ? address(meme) : address(weth),
            fee: 0,
            tickSpacing: 200,
            hooks: router.PONS_HOOK()
        });
        _fundOut(address(meme), 2 ether);
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(meme), 1, wethHint, block.timestamp + 60);
        assertEq(address(router).balance, 0);
        assertEq(weth.balanceOf(address(router)), 0);
        assertEq(meme.balanceOf(alice), 1_000_000 ether + 2 ether);
    }

    function test_v3_sell_unwraps_to_eth() public {
        uint256 out = 0.02 ether;
        uint256 fee = (out * 50) / 10_000;
        weth.deposit{value: out}();
        weth.transfer(address(v3), out);
        v3.setOutput(address(weth), out);
        vm.startPrank(alice);
        meme.approve(address(router), 5 ether);
        uint256 before = alice.balance;
        router.sell(address(meme), 5 ether, address(0), 1, v3Hint, block.timestamp + 60);
        vm.stopPrank();
        assertEq(alice.balance, before + out - fee);
        assertEq(address(router).balance, 0);
    }

    function test_swap_router_timelock_and_ownership() public {
        address next = address(0xCAFE);
        router.setSwapRouter02(next);
        vm.expectRevert(HodlRouter.TimelockNotReady.selector);
        router.applySwapRouter02();
        vm.warp(block.timestamp + 2 days);
        router.applySwapRouter02();
        assertEq(router.swapRouter02(), next);

        router.setMaxNotionalUsd(50);
        assertEq(router.maxNotionalUsd(), 50);
        router.transferOwnership(alice);
        assertEq(router.owner(), alice);
        vm.expectRevert(HodlRouter.NotOwner.selector);
        router.pause();
    }

    function test_bad_v3_fee_and_same_token_revert() public {
        HodlRouter.PoolKeyHint memory badFee = v3Hint;
        badFee.fee = 123;
        vm.prank(alice);
        vm.expectRevert(HodlRouter.BadFeeTier.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, badFee, block.timestamp + 60);

        vm.prank(alice);
        vm.expectRevert(HodlRouter.BadPair.selector);
        router.buy{value: 0.01 ether}(address(0), 1, pons, block.timestamp + 60);
    }

    function test_buy_with_weth_and_ur_revert() public {
        weth.deposit{value: 1 ether}();
        weth.transfer(alice, 0.05 ether);
        HodlRouter.PoolKeyHint memory wethHint = HodlRouter.PoolKeyHint({
            currency0: address(weth) < address(meme) ? address(weth) : address(meme),
            currency1: address(weth) < address(meme) ? address(meme) : address(weth),
            fee: 0,
            tickSpacing: 200,
            hooks: router.PONS_HOOK()
        });
        vm.startPrank(alice);
        weth.approve(address(router), 0.02 ether);
        ur.setRevert(true);
        vm.expectRevert(bytes("UR_REVERT"));
        router.buyWithToken(address(weth), 0.02 ether, address(meme), 1, wethHint, block.timestamp + 60);
        vm.stopPrank();
        assertEq(weth.balanceOf(address(router)), 0);
    }
}

contract FeeCollectorTest is Test {
    FeeCollector internal collector;
    MockERC20 internal usdg;
    address internal alice = address(0xA11CE);

    function setUp() public {
        collector = new FeeCollector(address(this));
        usdg = new MockERC20("USDG", "USDG", 6);
        usdg.mint(address(collector), 100e6);
        vm.deal(address(collector), 1 ether);
    }

    function test_owner_can_withdraw_until_module() public {
        collector.withdrawETH(alice, 0.25 ether);
        collector.withdrawToken(address(usdg), alice, 10e6);
        assertEq(alice.balance, 0.25 ether);
        assertEq(usdg.balanceOf(alice), 10e6);
    }

    function test_buyback_is_timelocked() public {
        collector.setBuybackModule(address(0xB0B));
        vm.expectRevert(FeeCollector.TimelockNotReady.selector);
        collector.applyBuybackModule();
        vm.warp(block.timestamp + 2 days);
        collector.applyBuybackModule();
        vm.expectRevert(FeeCollector.ModuleAlreadySet.selector);
        collector.withdrawETH(alice, 1);
    }

    function test_stranger_cannot_withdraw() public {
        vm.prank(alice);
        vm.expectRevert(FeeCollector.NotOwner.selector);
        collector.withdrawETH(alice, 1);
    }
}

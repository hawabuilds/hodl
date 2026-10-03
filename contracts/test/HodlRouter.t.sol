// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HodlRouter} from "../src/HodlRouter.sol";
import {FeeCollector} from "../src/FeeCollector.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {
    MockFeeOnTransferERC20,
    MockFalseERC20,
    MockStickyERC20,
    EthRejecter
} from "./mocks/MockWeirdTokens.sol";
import {RouterFixture, Ownable, Ownable2Step, SafeERC20, SafeCast} from "./utils/RouterFixture.sol";

contract HodlRouterTest is RouterFixture {
    // ---------------------------------------------------------------------
    // Deploy
    // ---------------------------------------------------------------------

    /// External so each `expectRevert` covers exactly one deployment.
    function deployRouter(address[7] calldata a, uint256 cap) external returns (HodlRouter) {
        return new HodlRouter(a[0], a[1], a[2], a[3], a[4], a[5], cap, a[6]);
    }

    function test_constructor_rejects_zero_addresses_and_cap() public {
        address[7] memory good = [
            address(collector),
            address(ur),
            address(v3),
            address(weth),
            address(usdg),
            address(pool),
            owner
        ];
        for (uint256 i; i < 6; i++) {
            address[7] memory bad;
            for (uint256 j; j < 7; j++) {
                bad[j] = good[j];
            }
            bad[i] = address(0);
            vm.expectRevert(HodlRouter.ZeroAddress.selector);
            this.deployRouter(bad, 100);
        }
        address[7] memory noOwner;
        for (uint256 j; j < 6; j++) {
            noOwner[j] = good[j];
        }
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        this.deployRouter(noOwner, 100);
        vm.expectRevert(HodlRouter.ZeroValue.selector);
        this.deployRouter(good, 0);
        assertTrue(address(this.deployRouter(good, 1)) != address(0));
    }

    function test_deploys_paused_with_default_fee() public {
        HodlRouter fresh = new HodlRouter(
            address(collector),
            address(ur),
            address(v3),
            address(weth),
            address(usdg),
            address(pool),
            100,
            owner
        );
        assertTrue(fresh.paused());
        assertEq(fresh.feeBps(), 50);
        assertEq(fresh.maxNotionalUsd(), 100);
        assertEq(fresh.owner(), owner);
    }

    // ---------------------------------------------------------------------
    // Buys
    // ---------------------------------------------------------------------

    function test_buy_native_v4_skims_input_fee() public {
        uint256 value = 0.01 ether;
        uint256 fee = (value * 50) / 10_000;
        _fundOut(address(meme), 5 ether);
        vm.expectEmit(address(router));
        emit HodlRouter.Trade(alice, address(0), address(meme), value, 5 ether, fee, address(0), 0);
        vm.prank(alice);
        router.buy{value: value}(address(meme), 1, pons, deadline);
        assertEq(address(collector).balance, fee);
        assertEq(ur.lastCommands(), hex"10");
        assertEq(ur.lastValue(), value - fee);
        assertEq(ur.lastDeadline(), deadline);
        assertEq(meme.balanceOf(alice), 1_000_000 ether + 5 ether);
        _assertRouterEmpty();
    }

    /// Regression: v1 encoded swap params flat, so the router read currency0
    /// as the struct offset. Only native-ETH pools (currency0 == 0) decoded.
    function test_v4_swap_params_are_struct_encoded() public {
        _fundOut(address(meme), 1 ether);
        vm.startPrank(alice);
        usdg.approve(address(router), 5e6);
        router.buyWithToken(address(usdg), 5e6, address(meme), 7, longUsdg, deadline);
        vm.stopPrank();

        (bytes memory actions, bytes[] memory params) = abi.decode(ur.lastInput(), (bytes, bytes[]));
        assertEq(actions, hex"060b0f", "SWAP_EXACT_IN_SINGLE, SETTLE, TAKE_ALL");
        assertEq(uint256(bytes32(params[0])), 0x20, "leading struct offset");
        HodlRouter.ExactInputSingleParams memory p =
            abi.decode(params[0], (HodlRouter.ExactInputSingleParams));
        assertEq(p.poolKey.currency0, longUsdg.currency0);
        assertEq(p.poolKey.currency1, longUsdg.currency1);
        assertEq(p.poolKey.hooks, router.LONG_HOOK());
        assertEq(p.zeroForOne, longUsdg.currency0 == address(usdg));
        assertEq(p.amountIn, 5e6 - 25_000);
        assertEq(p.amountOutMinimum, 7);
        assertEq(p.hookData.length, 0);
        (address c, uint256 amt, bool payerIsUser) = abi.decode(params[1], (address, uint256, bool));
        assertEq(c, address(usdg));
        assertEq(amt, 5e6 - 25_000);
        assertFalse(payerIsUser);
        (address outC, uint256 outMin) = abi.decode(params[2], (address, uint256));
        assertEq(outC, address(meme));
        assertEq(outMin, 7);
    }

    function test_v4_native_input_uses_settle_all() public {
        _fundOut(address(meme), 1 ether);
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(meme), 1, pons, deadline);
        (bytes memory actions, bytes[] memory params) = abi.decode(ur.lastInput(), (bytes, bytes[]));
        assertEq(actions, hex"060c0f");
        (address c, uint256 amt) = abi.decode(params[1], (address, uint256));
        assertEq(c, address(0));
        assertEq(amt, 0.00995 ether);
    }

    function test_buy_native_on_weth_pool_wraps() public {
        _fundOut(address(meme), 2 ether);
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(meme), 1, ponsWeth, deadline);
        assertEq(weth.balanceOf(address(ur)), 0.01 ether - 0.00005 ether);
        assertEq(meme.balanceOf(alice), 1_000_000 ether + 2 ether);
        _assertRouterEmpty();
    }

    function test_buyWithToken_usdg_long() public {
        uint256 amountIn = 20 * 1e6;
        uint256 fee = (amountIn * 50) / 10_000;
        _fundOut(address(meme), 3 ether);
        vm.startPrank(alice);
        usdg.approve(address(router), amountIn);
        router.buyWithToken(address(usdg), amountIn, address(meme), 1, longUsdg, deadline);
        vm.stopPrank();
        assertEq(usdg.balanceOf(address(collector)), fee);
        assertEq(usdg.balanceOf(address(ur)), amountIn - fee);
        assertEq(meme.balanceOf(alice), 1_000_000 ether + 3 ether);
        _assertRouterEmpty();
    }

    function test_usdg_one_dollar_fee_is_5000_not_18_decimals() public {
        _fundOut(address(meme), 1 ether);
        vm.startPrank(alice);
        usdg.approve(address(router), 1_000_000);
        router.buyWithToken(address(usdg), 1_000_000, address(meme), 1, longUsdg, deadline);
        vm.stopPrank();
        assertEq(usdg.balanceOf(address(collector)), 5_000);
        _assertRouterEmpty();
    }

    function test_buyWithToken_weth_on_weth_pool_fee_paid_in_eth() public {
        _fundOut(address(meme), 2 ether);
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        weth.deposit{value: 0.02 ether}();
        weth.approve(address(router), 0.02 ether);
        router.buyWithToken(address(weth), 0.02 ether, address(meme), 1, ponsWeth, deadline);
        vm.stopPrank();
        assertEq(address(collector).balance, 0.0001 ether);
        assertEq(weth.balanceOf(address(ur)), 0.0199 ether);
        _assertRouterEmpty();
    }

    function test_buyWithToken_weth_on_native_pool_unwraps() public {
        _fundOut(address(meme), 2 ether);
        vm.startPrank(alice);
        weth.deposit{value: 0.02 ether}();
        weth.approve(address(router), 0.02 ether);
        router.buyWithToken(address(weth), 0.02 ether, address(meme), 1, pons, deadline);
        vm.stopPrank();
        assertEq(ur.lastValue(), 0.0199 ether);
        assertEq(meme.balanceOf(alice), 1_000_000 ether + 2 ether);
        _assertRouterEmpty();
    }

    function test_buyWithToken_rejects_non_quote_input() public {
        vm.prank(alice);
        vm.expectRevert(HodlRouter.BadPair.selector);
        router.buyWithToken(address(meme), 1 ether, address(usdg), 1, longUsdg, deadline);
    }

    function test_v3_buy_with_eth_and_usdg() public {
        _fundOut(address(meme), 4 ether);
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(meme), 1, v3Hint, deadline);
        assertEq(meme.balanceOf(alice), 1_000_000 ether + 4 ether);

        _fundOut(address(meme), 4 ether);
        vm.startPrank(alice);
        usdg.approve(address(router), 10e6);
        router.buyWithToken(address(usdg), 10e6, address(meme), 1, v3Hint, deadline);
        vm.stopPrank();
        assertEq(meme.balanceOf(alice), 1_000_000 ether + 8 ether);
        assertEq(usdg.allowance(address(router), address(v3)), 0, "approval reset");
        _assertRouterEmpty();
    }

    // ---------------------------------------------------------------------
    // Sells
    // ---------------------------------------------------------------------

    function test_sell_native_pool_to_eth_skims_output_fee() public {
        uint256 out = 0.02 ether;
        uint256 fee = (out * 50) / 10_000;
        _fundOut(address(0), out);
        vm.startPrank(alice);
        meme.approve(address(router), 10 ether);
        uint256 before = alice.balance;
        router.sell(address(meme), 10 ether, address(0), 1, pons, deadline);
        vm.stopPrank();
        assertEq(alice.balance, before + out - fee);
        assertEq(address(collector).balance, fee);
        assertEq(meme.balanceOf(address(ur)), 10 ether);
        _assertRouterEmpty();
    }

    function test_sell_weth_pool_to_eth_unwraps() public {
        uint256 out = 0.02 ether;
        _fundOut(address(weth), out);
        vm.startPrank(alice);
        meme.approve(address(router), 10 ether);
        uint256 before = alice.balance;
        router.sell(address(meme), 10 ether, address(0), 1, ponsWeth, deadline);
        vm.stopPrank();
        assertEq(alice.balance, before + out - 0.0001 ether);
        _assertRouterEmpty();
    }

    function test_sell_native_pool_to_weth_wraps() public {
        uint256 out = 0.02 ether;
        _fundOut(address(0), out);
        vm.startPrank(alice);
        meme.approve(address(router), 10 ether);
        router.sell(address(meme), 10 ether, address(weth), 1, pons, deadline);
        vm.stopPrank();
        assertEq(weth.balanceOf(alice), out - 0.0001 ether);
        assertEq(address(collector).balance, 0.0001 ether);
        _assertRouterEmpty();
    }

    function test_sell_weth_pool_to_weth() public {
        _fundOut(address(weth), 0.02 ether);
        vm.startPrank(alice);
        meme.approve(address(router), 10 ether);
        router.sell(address(meme), 10 ether, address(weth), 1, ponsWeth, deadline);
        vm.stopPrank();
        assertEq(weth.balanceOf(alice), 0.0199 ether);
        _assertRouterEmpty();
    }

    function test_sell_to_usdg() public {
        uint256 out = 15 * 1e6;
        uint256 fee = (out * 50) / 10_000;
        _fundOut(address(usdg), out);
        vm.startPrank(alice);
        meme.approve(address(router), 10 ether);
        uint256 before = usdg.balanceOf(alice);
        router.sell(address(meme), 10 ether, address(usdg), 1, longUsdg, deadline);
        vm.stopPrank();
        assertEq(usdg.balanceOf(alice), before + out - fee);
        assertEq(usdg.balanceOf(address(collector)), fee);
        _assertRouterEmpty();
    }

    function test_v3_sell_unwraps_to_eth() public {
        _fundOut(address(weth), 0.02 ether);
        vm.startPrank(alice);
        meme.approve(address(router), 5 ether);
        uint256 before = alice.balance;
        router.sell(address(meme), 5 ether, address(0), 1, v3Hint, deadline);
        vm.stopPrank();
        assertEq(alice.balance, before + 0.0199 ether);
        assertEq(meme.allowance(address(router), address(v3)), 0, "approval reset");
        _assertRouterEmpty();
    }

    function test_sell_rejects_non_quote_output() public {
        vm.prank(alice);
        vm.expectRevert(HodlRouter.BadPair.selector);
        router.sell(address(usdg), 1e6, address(meme), 1, longUsdg, deadline);
    }

    // ---------------------------------------------------------------------
    // Slippage — the minimum is what the caller actually receives
    // ---------------------------------------------------------------------

    function test_buy_slippage_breach_reverts() public {
        _fundOut(address(meme), 1 ether);
        vm.prank(alice);
        vm.expectRevert(HodlRouter.InsufficientOut.selector);
        router.buy{value: 0.01 ether}(address(meme), uint128(1 ether + 1), pons, deadline);
    }

    function test_sell_min_is_checked_after_fee() public {
        uint256 gross = 10e6;
        uint256 net = gross - (gross * 50) / 10_000;

        // v1 checked the gross amount: min == gross passed and the seller got less.
        _fundOut(address(usdg), gross);
        vm.startPrank(alice);
        meme.approve(address(router), type(uint256).max);
        vm.expectRevert(HodlRouter.InsufficientOut.selector);
        router.sell(address(meme), 1 ether, address(usdg), uint128(gross), longUsdg, deadline);
        vm.expectRevert(HodlRouter.InsufficientOut.selector);
        router.sell(address(meme), 1 ether, address(usdg), uint128(net + 1), longUsdg, deadline);

        uint256 before = usdg.balanceOf(alice);
        router.sell(address(meme), 1 ether, address(usdg), uint128(net), longUsdg, deadline);
        vm.stopPrank();
        assertEq(usdg.balanceOf(alice) - before, net);
    }

    function test_deadline_reverts() public {
        vm.prank(alice);
        vm.expectRevert(HodlRouter.DeadlineExpired.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, pons, block.timestamp - 1);
    }

    // ---------------------------------------------------------------------
    // Fee-on-transfer tokens
    // ---------------------------------------------------------------------

    function test_fot_buy_delivers_post_tax_amount_and_checks_min_on_it() public {
        MockFeeOnTransferERC20 tax = new MockFeeOnTransferERC20(100); // 1%
        HodlRouter.PoolKeyHint memory h = _hint(address(0), address(tax), router.PONS_HOOK());
        tax.mint(address(ur), 100 ether);
        ur.setOutput(address(tax), 100 ether);

        // Venue pays 100, router receives 99, alice receives 98.01.
        uint256 expected = 98.01 ether;
        vm.prank(alice);
        vm.expectRevert(HodlRouter.InsufficientOut.selector);
        router.buy{value: 0.01 ether}(address(tax), uint128(expected + 1), h, deadline);

        vm.expectEmit(address(router));
        emit HodlRouter.Trade(
            alice, address(0), address(tax), 0.01 ether, expected, 0.00005 ether, address(0), 0
        );
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(tax), uint128(expected), h, deadline);
        assertEq(tax.balanceOf(alice), expected);
        assertEq(tax.balanceOf(address(router)), 0);
        _assertRouterEmpty();
    }

    function test_fot_sell_reverts_with_named_error() public {
        MockFeeOnTransferERC20 tax = new MockFeeOnTransferERC20(100);
        HodlRouter.PoolKeyHint memory h = _hint(address(0), address(tax), router.PONS_HOOK());
        tax.mint(alice, 10 ether);
        _fundOut(address(0), 0.02 ether);
        vm.startPrank(alice);
        tax.approve(address(router), 10 ether);
        vm.expectRevert(HodlRouter.FeeOnTransferToken.selector);
        router.sell(address(tax), 10 ether, address(0), 1, h, deadline);
        vm.stopPrank();
        assertEq(tax.balanceOf(alice), 10 ether, "nothing moved");
    }

    // ---------------------------------------------------------------------
    // Hint validation
    // ---------------------------------------------------------------------

    function test_bad_hook_reverts() public {
        HodlRouter.PoolKeyHint memory evil = pons;
        evil.hooks = address(0xDEAD);
        vm.prank(alice);
        vm.expectRevert(HodlRouter.BadHook.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, evil, deadline);
    }

    function test_currency_order_reverts() public {
        HodlRouter.PoolKeyHint memory bad = pons;
        (bad.currency0, bad.currency1) = (bad.currency1, bad.currency0);
        vm.prank(alice);
        vm.expectRevert(HodlRouter.BadPool.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, bad, deadline);
    }

    function test_pool_params_must_match_hook() public {
        HodlRouter.PoolKeyHint memory bad = pons;
        bad.fee = 3000;
        vm.startPrank(alice);
        vm.expectRevert(HodlRouter.BadPool.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, bad, deadline);
        bad = pons;
        bad.tickSpacing = 8;
        vm.expectRevert(HodlRouter.BadPool.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, bad, deadline);
        bad = longUsdg;
        bad.fee = 0;
        vm.expectRevert(HodlRouter.BadPool.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, bad, deadline);
        bad = longUsdg;
        bad.tickSpacing = 200;
        vm.expectRevert(HodlRouter.BadPool.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, bad, deadline);
        vm.stopPrank();
    }

    function test_pool_without_quote_side_reverts() public {
        MockERC20 other = new MockERC20("O", "O", 18);
        HodlRouter.PoolKeyHint memory h = _hint(address(other), address(meme), router.PONS_HOOK());
        vm.prank(alice);
        vm.expectRevert(HodlRouter.BadPair.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, h, deadline);
    }

    function test_pool_must_contain_both_trade_tokens() public {
        // USDG pool, but paying ETH.
        vm.prank(alice);
        vm.expectRevert(HodlRouter.BadPair.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, longUsdg, deadline);
        // Right quote, wrong token.
        vm.prank(alice);
        vm.expectRevert(HodlRouter.BadPair.selector);
        router.buy{value: 0.01 ether}(address(usdg), 1, pons, deadline);
    }

    function test_bad_v3_fee_and_same_token_revert() public {
        HodlRouter.PoolKeyHint memory badFee = v3Hint;
        badFee.fee = 123;
        vm.startPrank(alice);
        vm.expectRevert(HodlRouter.BadFeeTier.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, badFee, deadline);
        vm.expectRevert(HodlRouter.BadPair.selector);
        router.buy{value: 0.01 ether}(address(0), 1, pons, deadline);
        vm.expectRevert(HodlRouter.BadPair.selector);
        router.buy{value: 0.01 ether}(address(weth), 1, ponsWeth, deadline);
        vm.stopPrank();
    }

    function test_all_v3_fee_tiers_accepted() public {
        uint24[4] memory tiers = [uint24(100), 500, 3000, 10000];
        for (uint256 i; i < 4; i++) {
            HodlRouter.PoolKeyHint memory h = v3Hint;
            h.fee = tiers[i];
            _fundOut(address(meme), 1 ether);
            vm.prank(alice);
            router.buy{value: 0.01 ether}(address(meme), 1, h, deadline);
        }
        assertEq(meme.balanceOf(alice), 1_000_000 ether + 4 ether);
    }

    // ---------------------------------------------------------------------
    // Size limits
    // ---------------------------------------------------------------------

    function test_zero_amount_reverts() public {
        vm.startPrank(alice);
        vm.expectRevert(HodlRouter.NothingSupplied.selector);
        router.buy{value: 0}(address(meme), 1, pons, deadline);
        vm.expectRevert(HodlRouter.NothingSupplied.selector);
        router.buyWithToken(address(usdg), 0, address(meme), 1, longUsdg, deadline);
        vm.expectRevert(HodlRouter.NothingSupplied.selector);
        router.sell(address(meme), 0, address(usdg), 1, longUsdg, deadline);
        vm.stopPrank();
    }

    function test_dust_and_cap_usdg_edges() public {
        vm.startPrank(alice);
        usdg.approve(address(router), type(uint256).max);
        vm.expectRevert(HodlRouter.Dust.selector);
        router.buyWithToken(address(usdg), 999_999, address(meme), 1, longUsdg, deadline);
        vm.expectRevert(HodlRouter.Cap.selector);
        router.buyWithToken(address(usdg), 100e6 + 1, address(meme), 1, longUsdg, deadline);
        vm.stopPrank();
    }

    function test_dust_and_cap_eth_edges() public {
        uint256 minEth = _ethFor(1e6);
        uint256 maxEth = _ethFor(100e6 + 1) - 1;
        vm.startPrank(alice);
        vm.expectRevert(HodlRouter.Dust.selector);
        router.buy{value: minEth - 1}(address(meme), 1, pons, deadline);
        vm.expectRevert(HodlRouter.Cap.selector);
        router.buy{value: maxEth + 1}(address(meme), 1, pons, deadline);
        vm.stopPrank();
        _fundOut(address(meme), 1 ether);
        vm.prank(alice);
        router.buy{value: minEth}(address(meme), 1, pons, deadline);
        _fundOut(address(meme), 1 ether);
        vm.prank(alice);
        router.buy{value: maxEth}(address(meme), 1, pons, deadline);
    }

    function test_sell_output_dust_and_cap() public {
        vm.startPrank(alice);
        meme.approve(address(router), type(uint256).max);
        _fundOut(address(usdg), 999_999);
        vm.expectRevert(HodlRouter.Dust.selector);
        router.sell(address(meme), 1 ether, address(usdg), 1, longUsdg, deadline);
        _fundOut(address(usdg), 100e6 + 1);
        vm.expectRevert(HodlRouter.Cap.selector);
        router.sell(address(meme), 1 ether, address(usdg), 1, longUsdg, deadline);
        vm.stopPrank();
    }

    function test_cap_follows_queued_change() public {
        _setCap(1);
        vm.startPrank(alice);
        usdg.approve(address(router), 2_000_000);
        vm.expectRevert(HodlRouter.Cap.selector);
        router.buyWithToken(address(usdg), 2_000_000, address(meme), 1, longUsdg, deadline);
        vm.stopPrank();
    }

    function test_fee_zero_trade_is_free() public {
        _setFee(0);
        _fundOut(address(meme), 10 ether);
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(meme), 1, pons, deadline);
        assertEq(address(collector).balance, 0);
        _assertRouterEmpty();
    }

    // ---------------------------------------------------------------------
    // TWAP price
    // ---------------------------------------------------------------------

    function test_quote_uses_twap_near_2500() public view {
        uint256 q = router.quoteUsdg(1 ether);
        assertApproxEqRel(q, 2500e6, 0.001e18);
    }

    function test_quote_rounds_negative_mean_tick_down() public {
        uint256 exact = router.quoteUsdg(1 ether);
        pool.setSkew(-1); // mean tick -198080 - 1/600 → floors to -198081
        uint256 rounded = router.quoteUsdg(1 ether);
        pool.setTick(-198081);
        pool.setSkew(0);
        assertEq(rounded, router.quoteUsdg(1 ether));
        assertLt(rounded, exact);
    }

    function test_quote_positive_tick_and_out_of_range() public {
        pool.setTick(1000);
        // 1.0001^1000 ≈ 1.10517
        assertApproxEqRel(router.quoteUsdg(1e18), 1.10517e18, 0.0001e18);
        pool.setTick(887273);
        vm.expectRevert(HodlRouter.BadPool.selector);
        router.quoteUsdg(1);
        pool.setTick(-887273);
        vm.expectRevert(HodlRouter.BadPool.selector);
        router.quoteUsdg(1);
    }

    /// Checks the TickMath port against Uniswap's MIN/MAX_SQRT_PRICE and tick 0,
    /// and runs every bit of |tick| through it.
    function test_sqrt_price_matches_uniswap_bounds() public {
        uint256 minSqrt = 4295128739;
        uint256 maxSqrt = 1461446703485210103287273052203988822378723970342;

        pool.setTick(-887272);
        // x = 2^160: ((x * p) >> 96) * p >> 96 == p² >> 32
        assertEq(router.quoteUsdg(1 << 160), (minSqrt * minSqrt) >> 32);

        pool.setTick(887272);
        assertEq(router.quoteUsdg(1), ((maxSqrt >> 96) * maxSqrt) >> 96);

        pool.setTick(0);
        assertEq(router.quoteUsdg(1 ether), 1 ether, "tick 0 is price 1");

        // 524287 sets every bit below 0x80000.
        // 1e40 * 1.0001^-524287 = 170468168640242425.22… (60-digit Decimal).
        pool.setTick(-524287);
        assertApproxEqAbs(router.quoteUsdg(1e40), 170468168640242425, 1);
    }

    function test_oracle_failure_blocks_eth_trades() public {
        pool.setRevertObserve(true);
        vm.prank(alice);
        vm.expectRevert(bytes("OLD"));
        router.buy{value: 0.01 ether}(address(meme), 1, pons, deadline);
    }

    function test_same_block_spot_push_does_not_move_limit() public {
        uint256 before = router.quoteUsdg(1 ether);
        // A spot push changes only the newest observation by one second's worth.
        pool.setSkew(int56(int256(1000)) * 1); // +1000 tick-seconds over 600s ≈ +1 tick
        assertApproxEqRel(router.quoteUsdg(1 ether), before, 0.0003e18);
    }

    // ---------------------------------------------------------------------
    // Venue failures and odd tokens
    // ---------------------------------------------------------------------

    function test_ur_revert_is_propagated() public {
        ur.setRevert(true);
        vm.startPrank(alice);
        weth.deposit{value: 0.02 ether}();
        weth.approve(address(router), 0.02 ether);
        vm.expectRevert(bytes("UR_REVERT"));
        router.buyWithToken(address(weth), 0.02 ether, address(meme), 1, ponsWeth, deadline);
        vm.stopPrank();
        _assertRouterEmpty();
    }

    function test_empty_venue_revert_maps_to_insufficient_out() public {
        ur.setRevertEmpty(true);
        vm.prank(alice);
        vm.expectRevert(HodlRouter.InsufficientOut.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, pons, deadline);
    }

    function test_v3_revert_is_propagated() public {
        v3.setRevert(true);
        vm.prank(alice);
        vm.expectRevert(bytes("V3_REVERT"));
        router.buy{value: 0.01 ether}(address(meme), 1, v3Hint, deadline);
    }

    function test_amount_above_uint128_reverts_safecast() public {
        uint256 huge = uint256(type(uint128).max) + 1;
        meme.mint(alice, huge);
        vm.startPrank(alice);
        meme.approve(address(router), huge);
        vm.expectRevert(
            abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, 128, huge)
        );
        router.sell(address(meme), huge, address(usdg), 1, longUsdg, deadline);
        vm.stopPrank();
    }

    function test_token_returning_false_reverts() public {
        MockFalseERC20 f = new MockFalseERC20();
        HodlRouter.PoolKeyHint memory h = _hint(address(0), address(f), router.PONS_HOOK());
        f.mint(address(ur), 1 ether);
        ur.setOutput(address(f), 0); // mock UR's own transfer also returns false; pays nothing
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(f))
        );
        router.buy{value: 0.01 ether}(address(f), 0, h, deadline);
    }

    function test_token_without_code_reverts() public {
        // sha256 precompile answers balanceOf with 32 bytes but has no code.
        address noCode = address(2);
        HodlRouter.PoolKeyHint memory h = v3Hint;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, noCode));
        router.sell(noCode, 1 ether, address(0), 1, h, deadline);
    }

    function test_eoa_token_balance_query_reverts() public {
        vm.prank(alice);
        vm.expectRevert(HodlRouter.BalanceQueryFailed.selector);
        router.buy{value: 0.01 ether}(address(0xE0A), 1, v3Hint, deadline);
    }

    function test_seller_that_rejects_eth_reverts() public {
        EthRejecter rej = new EthRejecter();
        meme.mint(address(rej), 1 ether);
        vm.prank(address(rej));
        meme.approve(address(router), 1 ether);
        _fundOut(address(0), 0.02 ether);
        vm.prank(address(rej));
        vm.expectRevert(HodlRouter.EthTransferFailed.selector);
        router.sell(address(meme), 1 ether, address(0), 1, pons, deadline);
    }

    function test_leftover_from_venue_reverts_each_asset() public {
        // ETH left behind
        _fundOut(address(meme), 1 ether);
        vm.deal(address(ur), 1 ether);
        ur.setExtra(address(0), 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HodlRouter.Leftover.selector, address(0)));
        router.buy{value: 0.01 ether}(address(meme), 1, pons, deadline);

        // WETH left behind
        _fundOut(address(weth), 1);
        _fundOut(address(meme), 1 ether);
        ur.setExtra(address(weth), 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HodlRouter.Leftover.selector, address(weth)));
        router.buy{value: 0.01 ether}(address(meme), 1, pons, deadline);

        // USDG left behind
        usdg.mint(address(ur), 1);
        ur.setExtra(address(usdg), 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HodlRouter.Leftover.selector, address(usdg)));
        router.buy{value: 0.01 ether}(address(meme), 1, pons, deadline);

        // tokenIn left behind
        _fundOut(address(usdg), 10e6);
        ur.setExtra(address(meme), 1);
        vm.startPrank(alice);
        meme.approve(address(router), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(HodlRouter.Leftover.selector, address(meme)));
        router.sell(address(meme), 1 ether, address(usdg), 1, longUsdg, deadline);
        vm.stopPrank();
    }

    function test_leftover_token_out_reverts() public {
        MockStickyERC20 sticky = new MockStickyERC20();
        HodlRouter.PoolKeyHint memory h = _hint(address(0), address(sticky), router.PONS_HOOK());
        // Reads of the router's balance: snapshot 0, before swap 0, after swap 5,
        // final check 5. transfer() to alice moves nothing, so 5 stays behind.
        ur.setOutput(address(meme), 0);
        vm.mockCalls(
            address(sticky),
            abi.encodeWithSignature("balanceOf(address)", address(router)),
            _seq(0, 0, 5, 5)
        );
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HodlRouter.Leftover.selector, address(sticky)));
        router.buy{value: 0.01 ether}(address(sticky), 0, h, deadline);
    }

    function _seq(uint256 a, uint256 b, uint256 c, uint256 d)
        private
        pure
        returns (bytes[] memory r)
    {
        r = new bytes[](4);
        r[0] = abi.encode(a);
        r[1] = abi.encode(b);
        r[2] = abi.encode(c);
        r[3] = abi.encode(d);
    }

    // ---------------------------------------------------------------------
    // Pause, receive, sweep
    // ---------------------------------------------------------------------

    function test_pause_blocks_all_trades_and_is_instant() public {
        router.pause();
        vm.startPrank(alice);
        vm.expectRevert(HodlRouter.PausedError.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, pons, deadline);
        vm.expectRevert(HodlRouter.PausedError.selector);
        router.buyWithToken(address(usdg), 1e6, address(meme), 1, longUsdg, deadline);
        vm.expectRevert(HodlRouter.PausedError.selector);
        router.sell(address(meme), 1 ether, address(usdg), 1, longUsdg, deadline);
        vm.stopPrank();
        router.unpause();
        assertFalse(router.paused());
    }

    function test_receive_rejects_gifts_outside_trades() public {
        vm.prank(alice);
        (bool ok,) = address(router).call{value: 1 ether}("");
        assertFalse(ok);
        vm.prank(address(weth));
        vm.deal(address(weth), 1 ether);
        (ok,) = address(router).call{value: 1 ether}("");
        assertFalse(ok, "even WETH outside a trade");
    }

    function test_sweep_rules() public {
        vm.expectRevert(HodlRouter.NoSweepWhileLive.selector);
        router.sweep(address(0), owner);
        router.pause();
        vm.expectRevert(HodlRouter.ZeroAddress.selector);
        router.sweep(address(0), address(0));
        vm.prank(alice);
        vm.expectPartialRevert(UNAUTH);
        router.sweep(address(0), alice);

        usdg.mint(address(router), 7e6);
        vm.deal(address(router), 1 ether);
        uint256 ethBefore = owner.balance;
        vm.expectEmit(address(router));
        emit HodlRouter.Sweep(address(usdg), owner, 7e6);
        router.sweep(address(usdg), owner);
        router.sweep(address(0), owner);
        assertEq(usdg.balanceOf(owner), 7e6);
        assertEq(owner.balance, ethBefore + 1 ether);
    }
}

contract FeeCollectorTest is RouterFixture {
    function setUp() public override {
        super.setUp();
        usdg.mint(address(collector), 100e6);
        vm.deal(address(collector), 1 ether);
    }

    function test_constructor_rejects_zero_owner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new FeeCollector(address(0));
    }

    function test_owner_withdraws_to_self() public {
        uint256 ethBefore = owner.balance;
        vm.expectEmit(address(collector));
        emit FeeCollector.Withdraw(address(0), owner, 0.25 ether);
        collector.withdrawETH(0.25 ether);
        collector.withdrawToken(address(usdg), 10e6);
        assertEq(owner.balance, ethBefore + 0.25 ether);
        assertEq(usdg.balanceOf(owner), 10e6);
    }

    function test_stranger_cannot_withdraw() public {
        vm.startPrank(alice);
        vm.expectPartialRevert(UNAUTH);
        collector.withdrawETH(1);
        vm.expectPartialRevert(UNAUTH);
        collector.withdrawToken(address(usdg), 1);
        vm.stopPrank();
    }

    function test_withdraw_failures() public {
        vm.expectRevert(FeeCollector.EthTransferFailed.selector);
        collector.withdrawETH(2 ether);
        vm.expectRevert(
            abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(0xE0A))
        );
        collector.withdrawToken(address(0xE0A), 1);
        MockFalseERC20 f = new MockFalseERC20();
        vm.expectRevert(
            abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(f))
        );
        collector.withdrawToken(address(f), 1);
    }

    function test_renounce_is_disabled() public {
        vm.expectRevert(FeeCollector.RenounceDisabled.selector);
        collector.renounceOwnership();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        collector.renounceOwnership();
        assertEq(collector.owner(), owner);
    }

    function test_funds_can_never_be_stuck_after_ownership_moves() public {
        collector.transferOwnership(alice);
        // Old owner still withdraws until alice accepts.
        collector.withdrawETH(0.1 ether);
        vm.prank(alice);
        collector.acceptOwnership();
        vm.expectPartialRevert(UNAUTH);
        collector.withdrawETH(1);
        vm.prank(alice);
        collector.withdrawETH(0.9 ether);
        assertEq(alice.balance, 100 ether + 0.9 ether);
        assertEq(address(collector).balance, 0);
    }

    function test_two_step_ownership() public {
        vm.expectEmit(address(collector));
        emit Ownable2Step.OwnershipTransferStarted(owner, alice);
        collector.transferOwnership(alice);
        assertEq(collector.owner(), owner);
        assertEq(collector.pendingOwner(), alice);

        vm.prank(address(0xBAD));
        vm.expectPartialRevert(UNAUTH);
        collector.acceptOwnership();

        collector.transferOwnership(address(0)); // cancel
        vm.prank(alice);
        vm.expectPartialRevert(UNAUTH);
        collector.acceptOwnership();

        collector.transferOwnership(alice);
        vm.expectEmit(address(collector));
        emit Ownable.OwnershipTransferred(owner, alice);
        vm.prank(alice);
        collector.acceptOwnership();
        assertEq(collector.owner(), alice);
        assertEq(collector.pendingOwner(), address(0));

        vm.expectPartialRevert(UNAUTH);
        collector.transferOwnership(owner);
    }

    function test_accepts_eth_from_anyone() public {
        vm.prank(alice);
        (bool ok,) = address(collector).call{value: 1 ether}("");
        assertTrue(ok);
    }
}

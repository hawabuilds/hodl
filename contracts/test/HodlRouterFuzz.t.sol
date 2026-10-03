// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HodlRouter} from "../src/HodlRouter.sol";
import {RouterFixture} from "./utils/RouterFixture.sol";

/// @notice Fee accounting: fee + swap amount == input, for every fee 0–100 bps,
///         at the $1 floor, the $100 cap, and everywhere in between.
contract HodlRouterFuzzTest is RouterFixture {
    uint256 internal minEth;
    uint256 internal maxEth;

    function setUp() public override {
        super.setUp();
        minEth = _ethFor(1e6);
        maxEth = _ethFor(100e6 + 1) - 1;
        vm.deal(alice, 1_000 ether);
    }

    function _usdgBuy(uint256 amount) internal {
        _fundOut(address(meme), 1 ether);
        uint256 c0 = usdg.balanceOf(address(collector));
        uint256 u0 = usdg.balanceOf(address(ur));
        uint256 a0 = usdg.balanceOf(alice);
        vm.startPrank(alice);
        usdg.approve(address(router), amount);
        router.buyWithToken(address(usdg), amount, address(meme), 1, longUsdg, deadline);
        vm.stopPrank();
        uint256 fee = usdg.balanceOf(address(collector)) - c0;
        uint256 swapped = usdg.balanceOf(address(ur)) - u0;
        assertEq(fee + swapped, amount, "fee + swap != input");
        assertEq(a0 - usdg.balanceOf(alice), amount, "pulled != input");
        assertEq(fee, (amount * router.feeBps()) / 10_000, "fee formula");
        _assertRouterEmpty();
    }

    function _ethBuy(uint256 amount) internal {
        _fundOut(address(meme), 1 ether);
        uint256 c0 = address(collector).balance;
        vm.prank(alice);
        router.buy{value: amount}(address(meme), 1, pons, deadline);
        uint256 fee = address(collector).balance - c0;
        assertEq(fee + ur.lastValue(), amount, "fee + swap != input");
        assertEq(fee, (amount * router.feeBps()) / 10_000, "fee formula");
        _assertRouterEmpty();
    }

    /// Every fee 0..100 at both USDG edges and both ETH edges.
    function test_every_fee_at_both_edges() public {
        for (uint16 bps; bps <= 100; bps++) {
            _setFee(bps);
            _usdgBuy(1e6);
            _usdgBuy(100e6);
            _ethBuy(minEth);
            _ethBuy(maxEth);
        }
    }

    function testFuzz_usdg_fee_plus_swap_equals_input(uint16 bps, uint256 amount) public {
        _setFee(uint16(bound(bps, 0, 100)));
        _usdgBuy(bound(amount, 1e6, 100e6));
    }

    function testFuzz_eth_fee_plus_swap_equals_input(uint16 bps, uint256 amount) public {
        _setFee(uint16(bound(bps, 0, 100)));
        _ethBuy(bound(amount, minEth, maxEth));
    }

    /// Sells: fee + seller payout == swap output; seller always gets >= min.
    function testFuzz_sell_seller_gets_min_after_fee(uint16 bps, uint256 gross, uint128 minOut)
        public
    {
        _setFee(uint16(bound(bps, 0, 100)));
        gross = bound(gross, 1e6, 100e6);
        minOut = uint128(bound(minOut, 0, gross));
        _fundOut(address(usdg), gross);
        uint256 c0 = usdg.balanceOf(address(collector));
        uint256 a0 = usdg.balanceOf(alice);
        uint256 net = gross - (gross * router.feeBps()) / 10_000;

        vm.startPrank(alice);
        meme.approve(address(router), 1 ether);
        if (net < minOut) {
            vm.expectRevert(HodlRouter.InsufficientOut.selector);
            router.sell(address(meme), 1 ether, address(usdg), minOut, longUsdg, deadline);
            vm.stopPrank();
            return;
        }
        router.sell(address(meme), 1 ether, address(usdg), minOut, longUsdg, deadline);
        vm.stopPrank();

        uint256 received = usdg.balanceOf(alice) - a0;
        uint256 fee = usdg.balanceOf(address(collector)) - c0;
        assertGe(received, minOut, "seller below min");
        assertEq(received + fee, gross, "fee + payout != output");
        _assertRouterEmpty();
    }

    function testFuzz_sell_to_eth_seller_gets_min_after_fee(
        uint16 bps,
        uint256 gross,
        uint128 minOut
    ) public {
        _setFee(uint16(bound(bps, 0, 100)));
        gross = bound(gross, minEth, maxEth);
        minOut = uint128(bound(minOut, 0, gross));
        _fundOut(address(0), gross);
        uint256 net = gross - (gross * router.feeBps()) / 10_000;
        uint256 a0 = alice.balance;

        vm.startPrank(alice);
        meme.approve(address(router), 1 ether);
        if (net < minOut) vm.expectRevert(HodlRouter.InsufficientOut.selector);
        router.sell(address(meme), 1 ether, address(0), minOut, pons, deadline);
        vm.stopPrank();
        if (net >= minOut) {
            assertGe(alice.balance - a0, minOut);
            assertEq(alice.balance - a0, net);
        }
        _assertRouterEmpty();
    }
}

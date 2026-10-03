// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HodlRouter} from "../src/HodlRouter.sol";
import {MaliciousHook} from "./mocks/MockVenues.sol";
import {ForceSend} from "./mocks/MockWeirdTokens.sol";
import {RouterFixture, ReentrancyGuardTransient} from "./utils/RouterFixture.sol";

/// @notice Donations must never block trading (v1 High finding: any non-zero
///         router balance made `_assertEmpty` revert every later trade), and
///         donated funds must never be spent by, or paid out to, a trader.
contract HodlRouterAttackTest is RouterFixture {
    address internal attacker = address(0xBAD);
    MaliciousHook internal hook;

    uint256 constant D_ETH = 5 ether;
    uint256 constant D_WETH = 3 ether;
    uint256 constant D_USDG = 80e6;
    uint256 constant D_MEME = 40 ether;

    function setUp() public override {
        super.setUp();
        hook = new MaliciousHook(address(router));
        vm.deal(attacker, 20 ether);
        usdg.mint(attacker, 10e6);
        meme.mint(attacker, 10 ether);
    }

    function _forceEth(uint256 amount) internal {
        new ForceSend{value: amount}(payable(address(router)));
    }

    function _donateAll() internal {
        vm.startPrank(attacker);
        weth.deposit{value: D_WETH}();
        weth.transfer(address(router), D_WETH);
        usdg.transfer(address(router), 10e6);
        meme.transfer(address(router), 10 ether);
        vm.stopPrank();
        usdg.mint(address(router), D_USDG - 10e6);
        meme.mint(address(router), D_MEME - 10 ether);
        _forceEth(D_ETH);
    }

    function _assertDonationsUntouched() internal view {
        assertEq(address(router).balance, D_ETH, "ETH moved");
        assertEq(weth.balanceOf(address(router)), D_WETH, "WETH moved");
        assertEq(usdg.balanceOf(address(router)), D_USDG, "USDG moved");
        assertEq(meme.balanceOf(address(router)), D_MEME, "MEME moved");
    }

    // ---------------------------------------------------------------------
    // Donations do not block the next trade
    // ---------------------------------------------------------------------

    function test_forced_eth_does_not_block_trading() public {
        _forceEth(1 ether);
        assertEq(address(router).balance, 1 ether);
        _fundOut(address(meme), 2 ether);
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(meme), 1, pons, deadline);
        assertEq(meme.balanceOf(alice), 1_000_000 ether + 2 ether);
        assertEq(address(router).balance, 1 ether, "forced ETH neither spent nor grown");
    }

    function test_usdg_donation_does_not_block_trading() public {
        usdg.mint(address(router), 1);
        _fundOut(address(meme), 2 ether);
        vm.startPrank(alice);
        usdg.approve(address(router), 5e6);
        router.buyWithToken(address(usdg), 5e6, address(meme), 1, longUsdg, deadline);
        vm.stopPrank();
        assertEq(usdg.balanceOf(address(router)), 1);
    }

    function test_weth_donation_does_not_block_or_leak_on_eth_sell() public {
        weth.deposit{value: 1 ether}();
        weth.transfer(address(router), 1 ether);
        _fundOut(address(weth), 0.02 ether);
        vm.startPrank(alice);
        meme.approve(address(router), 1 ether);
        uint256 before = alice.balance;
        router.sell(address(meme), 1 ether, address(0), 1, ponsWeth, deadline);
        vm.stopPrank();
        // Only the swap's own WETH is unwrapped and paid out.
        assertEq(alice.balance - before, 0.0199 ether);
        assertEq(weth.balanceOf(address(router)), 1 ether);
    }

    function test_output_token_donation_does_not_block_or_leak() public {
        meme.mint(address(router), 7 ether);
        _fundOut(address(meme), 2 ether);
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(meme), 1, pons, deadline);
        assertEq(meme.balanceOf(alice), 1_000_000 ether + 2 ether, "got only the swap output");
        assertEq(meme.balanceOf(address(router)), 7 ether);
    }

    function test_every_trade_shape_works_with_all_donations_present() public {
        _donateAll();

        _fundOut(address(meme), 2 ether);
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(meme), 1, pons, deadline);
        _assertDonationsUntouched();

        _fundOut(address(meme), 2 ether);
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(meme), 1, ponsWeth, deadline);
        _assertDonationsUntouched();

        _fundOut(address(meme), 2 ether);
        vm.startPrank(alice);
        usdg.approve(address(router), 5e6);
        router.buyWithToken(address(usdg), 5e6, address(meme), 1, longUsdg, deadline);
        weth.deposit{value: 0.01 ether}();
        weth.approve(address(router), 0.01 ether);
        vm.stopPrank();
        _assertDonationsUntouched();

        _fundOut(address(meme), 2 ether);
        vm.prank(alice);
        router.buyWithToken(address(weth), 0.01 ether, address(meme), 1, pons, deadline);
        _assertDonationsUntouched();

        _fundOut(address(0), 0.02 ether);
        vm.startPrank(alice);
        meme.approve(address(router), type(uint256).max);
        router.sell(address(meme), 1 ether, address(0), 1, pons, deadline);
        vm.stopPrank();
        _assertDonationsUntouched();

        _fundOut(address(weth), 0.02 ether);
        vm.prank(alice);
        router.sell(address(meme), 1 ether, address(0), 1, ponsWeth, deadline);
        _assertDonationsUntouched();

        _fundOut(address(0), 0.02 ether);
        vm.prank(alice);
        router.sell(address(meme), 1 ether, address(weth), 1, pons, deadline);
        _assertDonationsUntouched();

        _fundOut(address(usdg), 10e6);
        vm.prank(alice);
        router.sell(address(meme), 1 ether, address(usdg), 1, longUsdg, deadline);
        _assertDonationsUntouched();

        _fundOut(address(meme), 2 ether);
        vm.prank(alice);
        router.buy{value: 0.01 ether}(address(meme), 1, v3Hint, deadline);
        _assertDonationsUntouched();

        _fundOut(address(weth), 0.02 ether);
        vm.prank(alice);
        router.sell(address(meme), 1 ether, address(0), 1, v3Hint, deadline);
        _assertDonationsUntouched();
    }

    // ---------------------------------------------------------------------
    // Donated funds cannot be extracted
    // ---------------------------------------------------------------------

    function test_every_public_path_fails_to_extract_donations() public {
        _donateAll();
        HodlRouter.PoolKeyHint memory evil = pons;
        evil.hooks = address(hook);

        vm.startPrank(attacker);
        vm.expectRevert(HodlRouter.NothingSupplied.selector);
        router.buy{value: 0}(address(meme), 1, pons, deadline);
        vm.expectRevert(HodlRouter.BadHook.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, evil, deadline);
        vm.expectRevert(HodlRouter.NothingSupplied.selector);
        router.buyWithToken(address(usdg), 0, address(meme), 1, longUsdg, deadline);
        meme.approve(address(router), 1 ether);
        vm.expectRevert(HodlRouter.BadHook.selector);
        router.sell(address(meme), 1 ether, address(0), 1, evil, deadline);
        _assertDonationsUntouched();

        vm.expectPartialRevert(UNAUTH);
        router.sweep(address(0), attacker);
        vm.expectPartialRevert(UNAUTH);
        router.pause();
        vm.expectPartialRevert(UNAUTH);
        router.unpause();
        vm.expectPartialRevert(UNAUTH);
        router.queueFeeBps(0);
        vm.expectPartialRevert(UNAUTH);
        router.queueMaxNotionalUsd(1_000_000);
        vm.expectPartialRevert(UNAUTH);
        router.queueUniversalRouter(attacker);
        vm.expectPartialRevert(UNAUTH);
        router.queueSwapRouter02(attacker);
        vm.expectPartialRevert(UNAUTH);
        router.executeChange(HodlRouter.Param.UniversalRouter);
        vm.expectPartialRevert(UNAUTH);
        router.cancelChange(HodlRouter.Param.UniversalRouter);
        vm.expectPartialRevert(UNAUTH);
        router.transferOwnership(attacker);
        vm.expectPartialRevert(UNAUTH);
        router.acceptOwnership();

        (bool ok,) = address(router).call{value: 1 ether}("");
        assertFalse(ok, "receive accepted a gift");
        (bool hooked,) = address(hook).call("");
        hooked;
        vm.stopPrank();
        _assertDonationsUntouched();

        // Only a paused owner can recover them.
        vm.expectRevert(HodlRouter.NoSweepWhileLive.selector);
        router.sweep(address(0), owner);
        router.pause();
        uint256 ethBefore = owner.balance;
        router.sweep(address(0), owner);
        router.sweep(address(weth), owner);
        router.sweep(address(usdg), owner);
        router.sweep(address(meme), owner);
        assertEq(owner.balance, ethBefore + D_ETH);
        assertEq(weth.balanceOf(owner), D_WETH);
        assertEq(usdg.balanceOf(owner), D_USDG);
        assertEq(meme.balanceOf(owner), D_MEME);
        _assertRouterEmpty();
    }

    function test_reentry_from_venue_is_blocked() public {
        // A venue that calls back into the router mid-trade, through each entry point.
        ReenteringVenue rv = new ReenteringVenue(router, pons, address(usdg));
        router.queueUniversalRouter(address(rv));
        vm.warp(block.timestamp + 2 days);
        router.executeChange(HodlRouter.Param.UniversalRouter);
        uint256 dl = block.timestamp + 60;
        for (uint8 mode; mode < 3; mode++) {
            rv.setMode(mode);
            vm.prank(alice);
            vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
            router.buy{value: 0.01 ether}(address(meme), 1, pons, dl);
        }
    }
}

contract ReenteringVenue {
    HodlRouter internal immutable router;
    address internal immutable usdg;
    HodlRouter.PoolKeyHint internal hint;
    uint8 public mode;

    constructor(HodlRouter router_, HodlRouter.PoolKeyHint memory hint_, address usdg_) {
        router = router_;
        hint = hint_;
        usdg = usdg_;
    }

    function setMode(uint8 m) external {
        mode = m;
    }

    function execute(bytes calldata, bytes[] calldata, uint256) external payable {
        if (mode == 0) router.buy{value: msg.value}(hint.currency1, 0, hint, block.timestamp);
        else if (mode == 1) router.buyWithToken(usdg, 1e6, hint.currency1, 0, hint, block.timestamp);
        else router.sell(hint.currency1, 1, address(0), 0, hint, block.timestamp);
    }
}

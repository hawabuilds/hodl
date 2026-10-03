// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HodlRouter} from "../src/HodlRouter.sol";
import {RouterFixture, Ownable, Ownable2Step} from "./utils/RouterFixture.sol";

/// @notice Two-step ownership and the 2-day delay on fee, cap and venue changes.
contract HodlRouterAdminTest is RouterFixture {
    uint256 constant DELAY = 2 days;

    // ---------------------------------------------------------------------
    // Ownership
    // ---------------------------------------------------------------------

    function test_two_step_ownership() public {
        vm.expectEmit(address(router));
        emit Ownable2Step.OwnershipTransferStarted(owner, alice);
        router.transferOwnership(alice);
        assertEq(router.owner(), owner, "owner unchanged until accept");
        assertEq(router.pendingOwner(), alice);

        // Pending owner has no powers yet; old owner keeps them.
        vm.prank(alice);
        vm.expectPartialRevert(UNAUTH);
        router.pause();
        router.pause();

        vm.prank(address(0xBAD));
        vm.expectPartialRevert(UNAUTH);
        router.acceptOwnership();

        vm.expectEmit(address(router));
        emit Ownable.OwnershipTransferred(owner, alice);
        vm.prank(alice);
        router.acceptOwnership();
        assertEq(router.owner(), alice);
        assertEq(router.pendingOwner(), address(0));

        vm.expectPartialRevert(UNAUTH);
        router.unpause();
        vm.prank(alice);
        router.unpause();

        // Accepting twice is impossible.
        vm.prank(alice);
        vm.expectPartialRevert(UNAUTH);
        router.acceptOwnership();
    }

    function test_transfer_to_zero_cancels_pending() public {
        router.transferOwnership(alice);
        router.transferOwnership(address(0));
        vm.prank(alice);
        vm.expectPartialRevert(UNAUTH);
        router.acceptOwnership();
        assertEq(router.owner(), owner);
    }

    function test_new_pending_owner_replaces_old() public {
        router.transferOwnership(alice);
        router.transferOwnership(address(0xB0B));
        vm.prank(alice);
        vm.expectPartialRevert(UNAUTH);
        router.acceptOwnership();
        vm.prank(address(0xB0B));
        router.acceptOwnership();
        assertEq(router.owner(), address(0xB0B));
    }

    // ---------------------------------------------------------------------
    // Timelock — each parameter
    // ---------------------------------------------------------------------

    function test_fee_change_is_delayed() public {
        uint256 eta = block.timestamp + DELAY;
        vm.expectEmit(address(router));
        emit HodlRouter.ChangeQueued(HodlRouter.Param.FeeBps, 10, eta);
        router.queueFeeBps(10);
        (uint256 value, uint256 queuedEta) = router.pendingChange(HodlRouter.Param.FeeBps);
        assertEq(value, 10);
        assertEq(queuedEta, eta);
        assertEq(router.feeBps(), 50, "no instant effect");

        vm.warp(eta - 1);
        vm.expectRevert(HodlRouter.TimelockNotReady.selector);
        router.executeChange(HodlRouter.Param.FeeBps);

        vm.warp(eta);
        vm.expectEmit(address(router));
        emit HodlRouter.ChangeExecuted(HodlRouter.Param.FeeBps, 50, 10);
        router.executeChange(HodlRouter.Param.FeeBps);
        assertEq(router.feeBps(), 10);
        (, queuedEta) = router.pendingChange(HodlRouter.Param.FeeBps);
        assertEq(queuedEta, 0, "cleared");
    }

    function test_fee_bound_checked_at_queue() public {
        vm.expectRevert(HodlRouter.FeeTooHigh.selector);
        router.queueFeeBps(101);
        router.queueFeeBps(100);
    }

    function test_cap_change_is_delayed() public {
        vm.expectRevert(HodlRouter.ZeroValue.selector);
        router.queueMaxNotionalUsd(0);
        router.queueMaxNotionalUsd(1000);
        vm.expectRevert(HodlRouter.TimelockNotReady.selector);
        router.executeChange(HodlRouter.Param.MaxNotionalUsd);
        assertEq(router.maxNotionalUsd(), 100);
        vm.warp(block.timestamp + DELAY);
        vm.expectEmit(address(router));
        emit HodlRouter.ChangeExecuted(HodlRouter.Param.MaxNotionalUsd, 100, 1000);
        router.executeChange(HodlRouter.Param.MaxNotionalUsd);
        assertEq(router.maxNotionalUsd(), 1000);
    }

    function test_universal_router_change_is_delayed() public {
        address next = address(0xBEEF);
        vm.expectRevert(HodlRouter.ZeroAddress.selector);
        router.queueUniversalRouter(address(0));
        router.queueUniversalRouter(next);
        vm.expectRevert(HodlRouter.TimelockNotReady.selector);
        router.executeChange(HodlRouter.Param.UniversalRouter);
        vm.warp(block.timestamp + DELAY);
        vm.expectEmit(address(router));
        emit HodlRouter.ChangeExecuted(
            HodlRouter.Param.UniversalRouter, uint160(address(ur)), uint160(next)
        );
        router.executeChange(HodlRouter.Param.UniversalRouter);
        assertEq(router.universalRouter(), next);
    }

    function test_swap_router_change_is_delayed() public {
        address next = address(0xCAFE);
        vm.expectRevert(HodlRouter.ZeroAddress.selector);
        router.queueSwapRouter02(address(0));
        router.queueSwapRouter02(next);
        vm.expectRevert(HodlRouter.TimelockNotReady.selector);
        router.executeChange(HodlRouter.Param.SwapRouter02);
        vm.warp(block.timestamp + DELAY);
        router.executeChange(HodlRouter.Param.SwapRouter02);
        assertEq(router.swapRouter02(), next);
    }

    // ---------------------------------------------------------------------
    // Timelock — cannot be bypassed
    // ---------------------------------------------------------------------

    function test_execute_without_queue_reverts() public {
        for (uint8 i; i < 4; i++) {
            vm.expectRevert(HodlRouter.NothingQueued.selector);
            router.executeChange(HodlRouter.Param(i));
        }
    }

    function test_requeue_restarts_the_clock() public {
        // Queue something harmless early, then swap in a different value just
        // before it matures: the new value must wait the full delay again.
        router.queueFeeBps(10);
        vm.warp(block.timestamp + DELAY - 1);
        router.queueFeeBps(100);
        vm.warp(block.timestamp + 1);
        vm.expectRevert(HodlRouter.TimelockNotReady.selector);
        router.executeChange(HodlRouter.Param.FeeBps);
        vm.warp(block.timestamp + DELAY - 1);
        router.executeChange(HodlRouter.Param.FeeBps);
        assertEq(router.feeBps(), 100);
    }

    function test_cancel_clears_change() public {
        router.queueUniversalRouter(address(0xBEEF));
        vm.expectEmit(address(router));
        emit HodlRouter.ChangeCancelled(HodlRouter.Param.UniversalRouter, uint160(address(0xBEEF)));
        router.cancelChange(HodlRouter.Param.UniversalRouter);
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(HodlRouter.NothingQueued.selector);
        router.executeChange(HodlRouter.Param.UniversalRouter);
        vm.expectRevert(HodlRouter.NothingQueued.selector);
        router.cancelChange(HodlRouter.Param.UniversalRouter);
        assertEq(router.universalRouter(), address(ur));
    }

    function test_changes_are_independent() public {
        router.queueFeeBps(0);
        router.queueMaxNotionalUsd(5);
        vm.warp(block.timestamp + DELAY);
        router.executeChange(HodlRouter.Param.FeeBps);
        (uint256 v, uint256 eta) = router.pendingChange(HodlRouter.Param.MaxNotionalUsd);
        assertEq(v, 5);
        assertGt(eta, 0);
        assertEq(router.maxNotionalUsd(), 100);
    }

    function test_executed_change_cannot_be_replayed() public {
        router.queueFeeBps(0);
        vm.warp(block.timestamp + DELAY);
        router.executeChange(HodlRouter.Param.FeeBps);
        vm.expectRevert(HodlRouter.NothingQueued.selector);
        router.executeChange(HodlRouter.Param.FeeBps);
    }

    function test_strangers_and_pending_owner_cannot_touch_timelock() public {
        router.transferOwnership(alice);
        router.queueFeeBps(0);
        vm.warp(block.timestamp + DELAY);
        address[2] memory who = [address(0xBAD), alice];
        for (uint256 i; i < 2; i++) {
            vm.startPrank(who[i]);
            vm.expectPartialRevert(UNAUTH);
            router.queueFeeBps(0);
            vm.expectPartialRevert(UNAUTH);
            router.queueMaxNotionalUsd(1);
            vm.expectPartialRevert(UNAUTH);
            router.queueUniversalRouter(who[i]);
            vm.expectPartialRevert(UNAUTH);
            router.queueSwapRouter02(who[i]);
            vm.expectPartialRevert(UNAUTH);
            router.executeChange(HodlRouter.Param.FeeBps);
            vm.expectPartialRevert(UNAUTH);
            router.cancelChange(HodlRouter.Param.FeeBps);
            vm.stopPrank();
        }
    }

    function test_pause_is_instant_even_with_changes_queued() public {
        router.queueFeeBps(0);
        router.pause();
        assertTrue(router.paused());
        // A queued change still matures while paused.
        vm.warp(block.timestamp + DELAY);
        router.executeChange(HodlRouter.Param.FeeBps);
        assertEq(router.feeBps(), 0);
    }

    function test_fee_and_paused_pack_with_pending_owner() public {
        router.transferOwnership(alice);
        // slot 0 = Ownable._owner; slot 1 = _pendingOwner | feeBps << 160 | paused << 176
        uint256 slot0 = uint256(vm.load(address(router), bytes32(0)));
        uint256 slot1 = uint256(vm.load(address(router), bytes32(uint256(1))));
        assertEq(address(uint160(slot0)), owner);
        assertEq(address(uint160(slot1)), alice);
        assertEq(uint16(slot1 >> 160), router.feeBps());
        assertEq(uint8(slot1 >> 176), router.paused() ? 1 : 0);
        router.pause();
        slot1 = uint256(vm.load(address(router), bytes32(uint256(1))));
        assertEq(uint8(slot1 >> 176), 1);
    }

    function test_renounce_is_disabled() public {
        vm.expectRevert(HodlRouter.RenounceDisabled.selector);
        router.renounceOwnership();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        router.renounceOwnership();
        assertEq(router.owner(), owner);
    }

    function test_unauthorized_error_names_the_caller() public {
        router.transferOwnership(alice);
        vm.prank(address(0xBAD));
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(0xBAD))
        );
        router.acceptOwnership();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        router.queueFeeBps(0);
    }
}

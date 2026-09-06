// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {HodlRouter} from "../src/HodlRouter.sol";
import {FeeCollector} from "../src/FeeCollector.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockWETH} from "./mocks/MockWETH.sol";
import {
    MockUniversalRouter,
    MockSwapRouter02,
    MockWethUsdgPool,
    MaliciousHook
} from "./mocks/MockVenues.sol";

/// @notice Funds HodlRouter directly, then tries every public/external path
///         including a crafted PoolKey and a malicious hook. Every attempt
///         must fail. Donated balances must stay put until a paused owner sweep.
contract HodlRouterAttackTest is Test {
    receive() external payable {}

    HodlRouter internal router;
    FeeCollector internal collector;
    MockWETH internal weth;
    MockERC20 internal usdg;
    MockERC20 internal meme;
    MockUniversalRouter internal ur;
    MockSwapRouter02 internal v3;
    MockWethUsdgPool internal pool;
    MaliciousHook internal hook;

    address internal attacker = address(0xBAD);
    address internal owner = address(this);

    HodlRouter.PoolKeyHint internal goodPons;
    HodlRouter.PoolKeyHint internal evilHook;
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
        hook = new MaliciousHook(address(router));
        router.unpause();

        address c0 = address(0) < address(meme) ? address(0) : address(meme);
        address c1 = address(0) < address(meme) ? address(meme) : address(0);
        goodPons = HodlRouter.PoolKeyHint(c0, c1, 0, 200, router.PONS_HOOK());
        evilHook = HodlRouter.PoolKeyHint(c0, c1, 0, 200, address(hook));
        v3Hint = HodlRouter.PoolKeyHint({
            currency0: address(weth) < address(meme) ? address(weth) : address(meme),
            currency1: address(weth) < address(meme) ? address(meme) : address(weth),
            fee: 3000,
            tickSpacing: 0,
            hooks: address(0)
        });

        vm.deal(address(router), 5 ether);
        usdg.mint(address(router), 80 * 1e6);
        meme.mint(address(router), 40 ether);
        vm.deal(attacker, 10 ether);
        usdg.mint(attacker, 10 * 1e6);
        meme.mint(attacker, 10 ether);
    }

    function _assertUntouched() internal view {
        assertEq(address(router).balance, 5 ether, "ETH stolen");
        assertEq(usdg.balanceOf(address(router)), 80 * 1e6, "USDG stolen");
        assertEq(meme.balanceOf(address(router)), 40 ether, "meme stolen");
    }

    function test_every_public_path_fails_to_extract_direct_funding() public {
        vm.startPrank(attacker);

        vm.expectRevert(HodlRouter.NothingSupplied.selector);
        router.buy{value: 0}(address(meme), 1, goodPons, block.timestamp + 60);
        _assertUntouched();

        vm.expectRevert(HodlRouter.BadHook.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, evilHook, block.timestamp + 60);
        _assertUntouched();

        HodlRouter.PoolKeyHint memory unknown = goodPons;
        unknown.hooks = address(0xB0B);
        vm.expectRevert(HodlRouter.BadHook.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, unknown, block.timestamp + 60);
        _assertUntouched();

        vm.expectRevert(HodlRouter.NothingSupplied.selector);
        router.buyWithToken(address(usdg), 0, address(meme), 1, goodPons, block.timestamp + 60);
        _assertUntouched();

        usdg.approve(address(router), 5e6);
        HodlRouter.PoolKeyHint memory longEvil = HodlRouter.PoolKeyHint({
            currency0: address(usdg) < address(meme) ? address(usdg) : address(meme),
            currency1: address(usdg) < address(meme) ? address(meme) : address(usdg),
            fee: 0x800000,
            tickSpacing: 8,
            hooks: address(hook)
        });
        vm.expectRevert(HodlRouter.BadHook.selector);
        router.buyWithToken(address(usdg), 5e6, address(meme), 1, longEvil, block.timestamp + 60);
        _assertUntouched();

        vm.expectRevert(HodlRouter.NothingSupplied.selector);
        router.sell(address(meme), 0, address(0), 1, goodPons, block.timestamp + 60);
        _assertUntouched();

        meme.approve(address(router), 1 ether);
        vm.expectRevert(HodlRouter.BadHook.selector);
        router.sell(address(meme), 1 ether, address(0), 1, evilHook, block.timestamp + 60);
        _assertUntouched();

        vm.expectRevert(HodlRouter.NotOwner.selector);
        router.sweep(address(0), attacker);
        vm.expectRevert(HodlRouter.NotOwner.selector);
        router.sweep(address(usdg), attacker);
        vm.expectRevert(HodlRouter.NotOwner.selector);
        router.sweep(address(meme), attacker);
        _assertUntouched();

        vm.expectRevert(HodlRouter.NotOwner.selector);
        router.pause();
        vm.expectRevert(HodlRouter.NotOwner.selector);
        router.unpause();
        vm.expectRevert(HodlRouter.NotOwner.selector);
        router.setFeeBps(0);
        vm.expectRevert(HodlRouter.NotOwner.selector);
        router.setMaxNotionalUsd(1_000_000);
        vm.expectRevert(HodlRouter.NotOwner.selector);
        router.setUniversalRouter(attacker);
        vm.expectRevert(HodlRouter.NotOwner.selector);
        router.applyUniversalRouter();
        vm.expectRevert(HodlRouter.NotOwner.selector);
        router.setSwapRouter02(attacker);
        vm.expectRevert(HodlRouter.NotOwner.selector);
        router.applySwapRouter02();
        vm.expectRevert(HodlRouter.NotOwner.selector);
        router.transferOwnership(attacker);
        _assertUntouched();

        (bool ok,) = address(router).call{value: 1 ether}("");
        assertFalse(ok, "receive accepted a gift");
        _assertUntouched();

        (bool hooked,) = address(hook).call("");
        hooked;
        _assertUntouched();

        vm.stopPrank();

        vm.expectRevert(HodlRouter.NoSweepWhileLive.selector);
        router.sweep(address(0), owner);
        _assertUntouched();

        router.pause();
        uint256 ownerEth = owner.balance;
        router.sweep(address(0), owner);
        router.sweep(address(usdg), owner);
        router.sweep(address(meme), owner);
        assertEq(address(router).balance, 0);
        assertEq(usdg.balanceOf(address(router)), 0);
        assertEq(meme.balanceOf(address(router)), 0);
        assertEq(owner.balance, ownerEth + 5 ether);
        assertEq(usdg.balanceOf(owner), 80 * 1e6);
        assertEq(meme.balanceOf(owner), 40 ether);
    }

    function test_successful_swap_cannot_spend_donated_balances() public {
        meme.mint(address(ur), 2 ether);
        ur.setOutput(address(meme), 2 ether);
        vm.prank(attacker);
        vm.expectRevert(HodlRouter.Leftover.selector);
        router.buy{value: 0.01 ether}(address(meme), 1, goodPons, block.timestamp + 60);
        _assertUntouched();
    }
}

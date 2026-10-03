// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {HodlRouter} from "../../src/HodlRouter.sol";
import {FeeCollector} from "../../src/FeeCollector.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockWETH} from "../mocks/MockWETH.sol";
import {MockUniversalRouter, MockSwapRouter02, MockWethUsdgPool} from "../mocks/MockVenues.sol";

/// @dev Router + collector on mock venues. Owner is this contract. Unpaused.
abstract contract RouterFixture is Test {
    /// OpenZeppelin Ownable: caller is not the owner / not the pending owner.
    bytes4 internal immutable UNAUTH = Ownable.OwnableUnauthorizedAccount.selector;

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

    /// Pons, native ETH / MEME
    HodlRouter.PoolKeyHint internal pons;
    /// Pons, WETH / MEME
    HodlRouter.PoolKeyHint internal ponsWeth;
    /// Long, USDG / MEME
    HodlRouter.PoolKeyHint internal longUsdg;
    /// V3 1%
    HodlRouter.PoolKeyHint internal v3Hint;

    uint256 internal deadline;

    function setUp() public virtual {
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

        pons = _hint(address(0), address(meme), router.PONS_HOOK());
        ponsWeth = _hint(address(weth), address(meme), router.PONS_HOOK());
        longUsdg = _hint(address(usdg), address(meme), router.LONG_HOOK());
        v3Hint = _hint(address(weth), address(meme), address(0));
        v3Hint.fee = 3000;
        v3Hint.tickSpacing = 0;

        vm.deal(alice, 100 ether);
        usdg.mint(alice, 1_000_000 * 1e6);
        meme.mint(alice, 1_000_000 ether);
        router.unpause();
        deadline = block.timestamp + 60;
    }

    receive() external payable virtual {}

    function _hint(address a, address b, address hooks)
        internal
        view
        returns (HodlRouter.PoolKeyHint memory h)
    {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        h.currency0 = c0;
        h.currency1 = c1;
        h.hooks = hooks;
        if (hooks == router.PONS_HOOK()) {
            h.fee = 0;
            h.tickSpacing = 200;
        } else if (hooks == router.LONG_HOOK()) {
            h.fee = 0x800000;
            h.tickSpacing = 8;
        }
    }

    /// Next venue call pays `amount` of `token` (address(0) = ETH).
    function _fundOut(address token, uint256 amount) internal {
        if (token == address(0)) {
            vm.deal(address(ur), address(ur).balance + amount);
            ur.setOutput(address(0), amount);
            vm.deal(address(v3), address(v3).balance + amount);
            v3.setOutput(address(0), amount);
        } else if (token == address(weth)) {
            vm.deal(address(this), address(this).balance + 2 * amount);
            weth.deposit{value: 2 * amount}();
            weth.transfer(address(ur), amount);
            weth.transfer(address(v3), amount);
            ur.setOutput(token, amount);
            v3.setOutput(token, amount);
        } else {
            MockERC20(token).mint(address(ur), amount);
            ur.setOutput(token, amount);
            MockERC20(token).mint(address(v3), amount);
            v3.setOutput(token, amount);
        }
    }

    function _setFee(uint16 bps) internal {
        router.queueFeeBps(bps);
        vm.warp(block.timestamp + router.TIMELOCK());
        router.executeChange(HodlRouter.Param.FeeBps);
        deadline = block.timestamp + 60;
    }

    function _setCap(uint256 usd) internal {
        router.queueMaxNotionalUsd(usd);
        vm.warp(block.timestamp + router.TIMELOCK());
        router.executeChange(HodlRouter.Param.MaxNotionalUsd);
        deadline = block.timestamp + 60;
    }

    /// Smallest wei whose TWAP value is at least `usdgRaw`.
    function _ethFor(uint256 usdgRaw) internal view returns (uint256 lo) {
        lo = 1;
        uint256 hi = 1e30;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (router.quoteUsdg(mid) >= usdgRaw) hi = mid;
            else lo = mid + 1;
        }
    }

    function _assertRouterEmpty() internal view {
        assertEq(address(router).balance, 0, "router ETH");
        assertEq(weth.balanceOf(address(router)), 0, "router WETH");
        assertEq(usdg.balanceOf(address(router)), 0, "router USDG");
        assertEq(meme.balanceOf(address(router)), 0, "router MEME");
    }
}

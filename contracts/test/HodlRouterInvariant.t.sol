// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HodlRouter} from "../src/HodlRouter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockWETH} from "./mocks/MockWETH.sol";
import {MockUniversalRouter, MockSwapRouter02} from "./mocks/MockVenues.sol";
import {ForceSend} from "./mocks/MockWeirdTokens.sol";
import {RouterFixture} from "./utils/RouterFixture.sol";

/// @dev Random trades and random donations. Tracks what was donated.
contract RouterHandler is Test {
    HodlRouter internal router;
    MockWETH internal weth;
    MockERC20 internal usdg;
    MockERC20 internal meme;
    MockUniversalRouter internal ur;
    MockSwapRouter02 internal v3;
    HodlRouter.PoolKeyHint internal pons;
    HodlRouter.PoolKeyHint internal ponsWeth;
    HodlRouter.PoolKeyHint internal longUsdg;
    HodlRouter.PoolKeyHint internal v3Hint;
    uint256 internal minEth;
    uint256 internal maxEth;

    uint256 public donatedEth;
    uint256 public donatedWeth;
    uint256 public donatedUsdg;
    uint256 public donatedMeme;
    uint256 public trades;

    constructor(
        HodlRouter router_,
        MockWETH weth_,
        MockERC20 usdg_,
        MockERC20 meme_,
        MockUniversalRouter ur_,
        MockSwapRouter02 v3_,
        HodlRouter.PoolKeyHint[4] memory hints,
        uint256 minEth_,
        uint256 maxEth_
    ) {
        router = router_;
        weth = weth_;
        usdg = usdg_;
        meme = meme_;
        ur = ur_;
        v3 = v3_;
        pons = hints[0];
        ponsWeth = hints[1];
        longUsdg = hints[2];
        v3Hint = hints[3];
        minEth = minEth_;
        maxEth = maxEth_;
    }

    receive() external payable {}

    function _payOut(address token, uint256 amount) internal {
        if (token == address(0)) {
            vm.deal(address(ur), address(ur).balance + amount);
            ur.setOutput(address(0), amount);
        } else if (token == address(weth)) {
            vm.deal(address(this), address(this).balance + amount * 2);
            weth.deposit{value: amount * 2}();
            weth.transfer(address(ur), amount);
            weth.transfer(address(v3), amount);
            ur.setOutput(token, amount);
            v3.setOutput(token, amount);
        } else {
            MockERC20(token).mint(address(ur), amount);
            MockERC20(token).mint(address(v3), amount);
            ur.setOutput(token, amount);
            v3.setOutput(token, amount);
        }
    }

    function buyEth(uint256 amount, uint256 out, bool wethPool, bool useV3) external {
        amount = bound(amount, minEth, maxEth);
        out = bound(out, 1, 1e24);
        vm.deal(address(this), address(this).balance + amount);
        _payOut(address(meme), out);
        HodlRouter.PoolKeyHint memory h = useV3 ? v3Hint : (wethPool ? ponsWeth : pons);
        router.buy{value: amount}(address(meme), 1, h, block.timestamp);
        trades++;
    }

    function buyUsdg(uint256 amount, uint256 out) external {
        amount = bound(amount, 1e6, 100e6);
        out = bound(out, 1, 1e24);
        usdg.mint(address(this), amount);
        usdg.approve(address(router), amount);
        _payOut(address(meme), out);
        router.buyWithToken(address(usdg), amount, address(meme), 1, longUsdg, block.timestamp);
        trades++;
    }

    function sellToEth(uint256 amount, uint256 out, uint8 shape) external {
        amount = bound(amount, 1, 1e24);
        out = bound(out, minEth, maxEth);
        meme.mint(address(this), amount);
        meme.approve(address(router), amount);
        shape = shape % 4;
        if (shape == 0) {
            _payOut(address(0), out);
            router.sell(address(meme), amount, address(0), 0, pons, block.timestamp);
        } else if (shape == 1) {
            _payOut(address(weth), out);
            router.sell(address(meme), amount, address(0), 0, ponsWeth, block.timestamp);
        } else if (shape == 2) {
            _payOut(address(0), out);
            router.sell(address(meme), amount, address(weth), 0, pons, block.timestamp);
        } else {
            _payOut(address(weth), out);
            router.sell(address(meme), amount, address(0), 0, v3Hint, block.timestamp);
        }
        trades++;
    }

    function sellToUsdg(uint256 amount, uint256 out) external {
        amount = bound(amount, 1, 1e24);
        out = bound(out, 1e6, 100e6);
        meme.mint(address(this), amount);
        meme.approve(address(router), amount);
        _payOut(address(usdg), out);
        router.sell(address(meme), amount, address(usdg), 0, longUsdg, block.timestamp);
        trades++;
    }

    function donate(uint8 asset, uint256 amount) external {
        amount = bound(amount, 1, 1e22);
        asset = asset % 4;
        if (asset == 0) {
            vm.deal(address(this), address(this).balance + amount);
            new ForceSend{value: amount}(payable(address(router)));
            donatedEth += amount;
        } else if (asset == 1) {
            vm.deal(address(this), address(this).balance + amount);
            weth.deposit{value: amount}();
            weth.transfer(address(router), amount);
            donatedWeth += amount;
        } else if (asset == 2) {
            usdg.mint(address(router), amount);
            donatedUsdg += amount;
        } else {
            meme.mint(address(router), amount);
            donatedMeme += amount;
        }
    }
}

/// @notice The router never holds user funds after a trade: its balances are
///         always exactly what was donated to it, whatever trades ran.
contract HodlRouterInvariantTest is RouterFixture {
    RouterHandler internal handler;

    function setUp() public override {
        super.setUp();
        HodlRouter.PoolKeyHint[4] memory hints = [pons, ponsWeth, longUsdg, v3Hint];
        handler = new RouterHandler(
            router, weth, usdg, meme, ur, v3, hints, _ethFor(1e6), _ethFor(100e6 + 1) - 1
        );
        targetContract(address(handler));
        // A few fixed callers. Random senders each cost an RPC account lookup
        // when the suite runs with --fork-url; they don't matter here because
        // the handler itself is the trader.
        targetSender(address(0x5E1));
        targetSender(address(0x5E2));
        targetSender(address(0x5E3));
    }

    function invariant_router_holds_only_donations() public view {
        assertEq(address(router).balance, handler.donatedEth(), "ETH");
        assertEq(weth.balanceOf(address(router)), handler.donatedWeth(), "WETH");
        assertEq(usdg.balanceOf(address(router)), handler.donatedUsdg(), "USDG");
        assertEq(meme.balanceOf(address(router)), handler.donatedMeme(), "MEME");
    }

    /// The transient lock is never left set: outside a trade, receive() (which
    /// only opens while the lock is held) still rejects ETH.
    function invariant_lock_released() public {
        vm.deal(address(this), 1);
        (bool ok,) = address(router).call{value: 1}("");
        assertFalse(ok, "lock left set");
    }

    function afterInvariant() external view {
        // Make sure the run actually traded, not just donated.
        assertGt(handler.trades(), 0, "no trades executed");
    }
}

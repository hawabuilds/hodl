// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "./MockERC20.sol";

/// @dev Pays a pre-set output to the caller. Does not execute real UR commands.
contract MockUniversalRouter {
    address public outToken;
    uint256 public outAmount;
    bool public revertNext;
    bool public revertEmpty;
    bytes public lastCommands;
    bytes public lastInput;
    uint256 public lastDeadline;
    uint256 public lastValue;
    address public extraToken;
    uint256 public extraAmount;

    receive() external payable {}

    /// @dev Also pay `amount` of `token` (address(0) = ETH) to the caller, to
    ///      simulate a venue that leaves something behind in the router.
    function setExtra(address token, uint256 amount) external {
        extraToken = token;
        extraAmount = amount;
    }

    function setOutput(address token, uint256 amount) external {
        outToken = token;
        outAmount = amount;
    }

    function setRevert(bool v) external {
        revertNext = v;
    }

    function setRevertEmpty(bool v) external {
        revertEmpty = v;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)
        external
        payable
    {
        lastCommands = commands;
        lastInput = inputs[0];
        lastDeadline = deadline;
        lastValue = msg.value;
        if (revertNext) revert("UR_REVERT");
        if (revertEmpty) revert();
        if (outToken == address(0)) {
            (bool ok,) = payable(msg.sender).call{value: outAmount}("");
            require(ok, "ETH");
        } else {
            MockERC20(outToken).transfer(msg.sender, outAmount);
        }
        if (extraAmount > 0) {
            if (extraToken == address(0)) {
                (bool ok,) = payable(msg.sender).call{value: extraAmount}("");
                require(ok, "ETH");
            } else {
                MockERC20(extraToken).transfer(msg.sender, extraAmount);
            }
        }
    }
}

contract MockSwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    address public outToken;
    uint256 public outAmount;
    bool public revertNext;

    receive() external payable {}

    function setOutput(address token, uint256 amount) external {
        outToken = token;
        outAmount = amount;
    }

    function setRevert(bool v) external {
        revertNext = v;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256)
    {
        if (revertNext) revert("V3_REVERT");
        if (msg.value == 0 && params.tokenIn != address(0)) {
            MockERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        }
        address pay = outToken;
        if (pay == address(0)) {
            (bool ok,) = payable(params.recipient).call{value: outAmount}("");
            require(ok, "ETH");
        } else {
            MockERC20(pay).transfer(params.recipient, outAmount);
        }
        return outAmount;
    }
}

/// @dev WETH/USDG 0.01% oracle stand-in. Holds one tick for the whole window,
///      so the TWAP equals that tick. Default tick ≈ $2500 per ETH.
contract MockWethUsdgPool {
    int24 public tick = -198080;
    int56 public skew;
    bool public revertObserve;

    /// @dev Added to the latest cumulative so the mean tick is not exact.
    function setSkew(int56 next) external {
        skew = next;
    }

    function setTick(int24 next) external {
        tick = next;
    }

    function setRevertObserve(bool v) external {
        revertObserve = v;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory cumulatives, uint160[] memory perLiquidity)
    {
        require(!revertObserve, "OLD");
        cumulatives = new int56[](secondsAgos.length);
        perLiquidity = new uint160[](secondsAgos.length);
        for (uint256 i; i < secondsAgos.length; i++) {
            cumulatives[i] = int56(tick) * int56(int256(1_000_000 - uint256(secondsAgos[i])));
            if (secondsAgos[i] == 0) cumulatives[i] += skew;
        }
    }
}

/// @dev Must never be accepted as PoolKey.hooks.
contract MaliciousHook {
    address public target;

    constructor(address target_) {
        target = target_;
    }

    receive() external payable {}

    fallback() external payable {
        (bool ok,) = target.call(
            abi.encodeWithSignature("sweep(address,address)", address(0), address(this))
        );
        ok;
        (bool ok2,) = target.call{value: 0}(
            abi.encodeWithSignature(
                "buy(address,uint128,(address,address,uint24,int24,address),uint256)",
                address(this),
                uint128(0),
                address(0),
                address(0),
                uint24(0),
                int24(0),
                address(this),
                block.timestamp + 100
            )
        );
        ok2;
    }
}

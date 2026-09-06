// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MockERC20} from "./MockERC20.sol";

/// @dev Pays a pre-set output to the caller. Does not execute real UR commands.
contract MockUniversalRouter {
    address public outToken;
    uint256 public outAmount;
    bool public revertNext;
    bytes public lastCommands;
    uint256 public lastDeadline;
    uint256 public lastValue;

    receive() external payable {}

    function setOutput(address token, uint256 amount) external {
        outToken = token;
        outAmount = amount;
    }

    function setRevert(bool v) external {
        revertNext = v;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)
        external
        payable
    {
        lastCommands = commands;
        inputs;
        lastDeadline = deadline;
        lastValue = msg.value;
        if (revertNext) revert("UR_REVERT");
        if (outToken == address(0)) {
            (bool ok,) = payable(msg.sender).call{value: outAmount}("");
            require(ok, "ETH");
        } else {
            MockERC20(outToken).transfer(msg.sender, outAmount);
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

/// @dev WETH/USDG 0.01% slot0 stand-in. sqrtPrice chosen so 1 ETH ≈ $2500.
contract MockWethUsdgPool {
    uint160 public sqrtPriceX96;

    constructor() {
        // raw USDG/WETH = 2500e6 / 1e18. sqrtPriceX96 = sqrt(ratio) * 2^96
        uint256 ratioX192 = (uint256(2500 * 1e6) << 192) / 1e18;
        sqrtPriceX96 = uint160(_sqrt(ratioX192));
    }

    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function setSqrtPriceX96(uint160 next) external {
        sqrtPriceX96 = next;
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, false);
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
        (bool ok,) = target.call(abi.encodeWithSignature("sweep(address,address)", address(0), address(this)));
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

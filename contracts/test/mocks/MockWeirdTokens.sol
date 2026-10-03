// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "./MockERC20.sol";

/// @dev Burns `taxBps` of every transfer. Sender pays `amount`, receiver gets less.
contract MockFeeOnTransferERC20 is MockERC20 {
    uint256 public immutable taxBps;

    constructor(uint256 taxBps_) MockERC20("TAX", "TAX", 18) {
        taxBps = taxBps_;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _taxedMove(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        override
        returns (bool)
    {
        _spend(from, amount);
        _taxedMove(from, to, amount);
        return true;
    }

    function _taxedMove(address from, address to, uint256 amount) private {
        uint256 tax = (amount * taxBps) / 10_000;
        require(balanceOf[from] >= amount, "BAL");
        balanceOf[from] -= amount;
        balanceOf[to] += amount - tax;
        totalSupply -= tax;
    }
}

/// @dev Returns false instead of reverting on transfer.
contract MockFalseERC20 is MockERC20 {
    constructor() MockERC20("FALSE", "FALSE", 18) {}

    function transfer(address, uint256) external pure override returns (bool) {
        return false;
    }
}

/// @dev transfer() reports success but moves nothing.
contract MockStickyERC20 is MockERC20 {
    constructor() MockERC20("STICKY", "STICKY", 18) {}

    function transfer(address, uint256) external pure override returns (bool) {
        return true;
    }
}

/// @dev Sends its ETH to `target` on construction, bypassing receive().
contract ForceSend {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}

/// @dev Has no receive(); any plain ETH transfer to it fails.
contract EthRejecter {}

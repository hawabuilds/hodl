// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title FeeCollector
/// @notice Holds HODL swap fees away from HodlRouter. An exploit in the
///         router must not reach accumulated ETH/USDG.
/// @dev Buyback module is unset at deploy. `setBuybackModule` is timelocked.
contract FeeCollector {
    uint256 public constant TIMELOCK = 2 days;

    address public owner;
    address public buybackModule;

    address public pendingBuybackModule;
    uint256 public pendingBuybackEta;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event BuybackProposed(address indexed module, uint256 eta);
    event BuybackModuleSet(address indexed module);
    event Withdraw(address indexed token, address indexed to, uint256 amount);

    error NotOwner();
    error ZeroAddress();
    error ModuleAlreadySet();
    error TimelockPending();
    error TimelockNotReady();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    receive() external payable {}

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    /// @notice Starts the timelock. Leave unset until a buyback module exists.
    function setBuybackModule(address module) external onlyOwner {
        if (module == address(0)) revert ZeroAddress();
        pendingBuybackModule = module;
        pendingBuybackEta = block.timestamp + TIMELOCK;
        emit BuybackProposed(module, pendingBuybackEta);
    }

    function applyBuybackModule() external onlyOwner {
        if (pendingBuybackEta == 0) revert TimelockPending();
        if (block.timestamp < pendingBuybackEta) revert TimelockNotReady();
        address module = pendingBuybackModule;
        buybackModule = module;
        pendingBuybackModule = address(0);
        pendingBuybackEta = 0;
        emit BuybackModuleSet(module);
    }

    function withdrawETH(address to, uint256 amount) external onlyOwner {
        if (buybackModule != address(0)) revert ModuleAlreadySet();
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = payable(to).call{value: amount}("");
        require(ok, "ETH_XFER");
        emit Withdraw(address(0), to, amount);
    }

    function withdrawToken(address token, address to, uint256 amount) external onlyOwner {
        if (buybackModule != address(0)) revert ModuleAlreadySet();
        if (to == address(0) || token == address(0)) revert ZeroAddress();
        _safeTransfer(token, to, amount);
        emit Withdraw(token, to, amount);
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TOKEN_XFER");
    }
}

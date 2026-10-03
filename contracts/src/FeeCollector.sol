// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title FeeCollector (v2)
/// @notice Holds HODL swap fees away from HodlRouter. An exploit in the
///         router must not reach accumulated ETH/USDG.
/// @dev v1 had a timelocked buyback module that, once set, blocked every
///      withdrawal while the module had no way to pull funds, so fees could be
///      stuck for good. No module exists yet, so v2 drops it: the owner can
///      always withdraw, and only to the owner. A buyback contract later
///      becomes the owner (two-step) or receives withdrawals from it.
///      Ownership: OpenZeppelin Ownable2Step, with renounce disabled so the
///      fees can never be left without anyone able to withdraw them.
contract FeeCollector is Ownable2Step {
    using SafeERC20 for IERC20;

    event Withdraw(address indexed token, address indexed to, uint256 amount);

    error EthTransferFailed();
    error RenounceDisabled();

    /// @param owner_ Initial owner (zero reverts `OwnableInvalidOwner`).
    constructor(address owner_) Ownable(owner_) {}

    /// @notice Accepts ETH fees from the router (and anyone else).
    receive() external payable {}

    /// @notice Disabled: without an owner the fees could never be withdrawn.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /// @notice Send `amount` ETH to the owner.
    /// @param amount Wei to send.
    function withdrawETH(uint256 amount) external onlyOwner {
        emit Withdraw(address(0), msg.sender, amount);
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    /// @notice Send `amount` of `token` to the owner.
    /// @param token ERC-20 to send. A token that returns false, reverts or has
    ///        no code reverts `SafeERC20FailedOperation`.
    /// @param amount Raw amount to send.
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        emit Withdraw(token, msg.sender, amount);
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/// @notice TEST ONLY — Simulates a fake airdrop that charges an ETH fee
/// @dev Intended for honeypot / scam-detection testing on local or testnets
contract PhantomFeeAirdrop is ERC20 {
    address public immutable owner;
    uint256 public constant CLAIM_FEE = 0.01 ether;

    error FeeTooLow();
    error TransfersDisabled();
    error NotOwner();

    constructor() ERC20("Phantom Fee Airdrop", "PHANTOM") {
        owner = msg.sender;
        _mint(msg.sender, 1_000_000 ether);
    }

    /// @notice Fake airdrop claim that requires ETH
    function claimAirdrop() external payable {
        if (msg.value < CLAIM_FEE) revert FeeTooLow();
        _mint(msg.sender, 1_000 ether);
    }

    /// @notice Owner withdraws accumulated ETH (simulated loss)
    function withdrawFees() external {
        if (msg.sender != owner) revert NotOwner();
        (bool ok, ) = owner.call{value: address(this).balance}("");
        require(ok, "ETH transfer failed");
    }

    /// @notice Blocks all transfers (tokens cannot be sold or moved)
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256
    ) internal pure override {
        // Allow minting and burning only
        if (from == address(0) || to == address(0)) return;
        revert TransfersDisabled();
    }

    receive() external payable {}
}

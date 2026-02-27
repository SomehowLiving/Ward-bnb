// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/// @notice Fake airdrop that blocks all transfers (classic honeypot)
contract HoneypotToken is ERC20 {
    address public immutable owner;
    
    constructor() ERC20("Fake Airdrop", "FAKE") {
        owner = msg.sender;
        _mint(msg.sender, 1_000_000 * 10 ** 18);
    }
    
    /// @notice Anyone can "claim" tokens (but can't sell them)
    function claimAirdrop() external {
        _mint(msg.sender, 1000 * 10 ** 18);
    }
    
    /// @notice Blocks all transfers (honeypot logic)
    function _beforeTokenTransfer(
    address from,
    address to,
    uint256
    ) internal pure override {
        // Allows minting (from == 0) and burning (to == 0)
        if (from == address(0) || to == address(0)) {
            return;
        }
        revert("HONEYPOT: Cannot transfer");
    }
}
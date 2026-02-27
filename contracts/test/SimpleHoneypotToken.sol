// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/**
 * @title SimpleHoneypotToken
 * @notice Ultra-minimal ERC20 token designed to test WalletGuard's execution isolation
 * 
 * @dev This contract demonstrates a classic honeypot pattern:
 * 
 * WHAT IT ALLOWS:
 * - Anyone to call `claimAirdrop()` and receive 1000 FAKE tokens (free minting to msg.sender)
 * - Initial deployer to receive 1,000,000 FAKE tokens in constructor
 * - Burning tokens (transfer to zero address) is blocked by honeypot logic
 * 
 * WHAT IT DISALLOW (Honeypot Logic):
 * - ALL token transfers between non-zero addresses are permanently blocked
 * - `_update()` reverts with "HONEYPOT: Cannot transfer" for any transfer attempt
 * - Tokens cannot be traded, sold, or sent to other wallets
 * - Approvals are meaningless since transfers will always revert
 * 
 * SECURITY IMPLICATIONS:
 * - Tokens received via airdrop are **worthless** and **untransferable**
 * - Perfect for testing WalletGuard's ability to contain toxic assets
 * - Simulates real-world honeypot scams that trap value in user wallets
 * 
 * TESTING PURPOSE:
 * - Deploy this token
 * - Claim airdrop from WalletGuard pocket
 * - Verify tokens are isolated in pocket (can't sweep to main wallet)
 * - Burn pocket to permanently destroy toxic tokens
 */
contract SimpleHoneypotToken is ERC20 {
    constructor() ERC20("Honeypot Token", "HTOKEN") {
        _mint(msg.sender, 1_000_000 * 10 ** 18);
    }
    
    /// @notice Anyone can claim 1000 worthless tokens (honeypot bait)
    function claimAirdrop() external {
        _mint(msg.sender, 1000 * 10 ** 18);
    }
    
    /// @notice Blocks ALL transfers between addresses (honeypot trap)
    function _update(address from, address to, uint256 value) internal override {
        // Allow minting only (from == 0)
        if (from == address(0)) {
            super._update(from, to, value);
            return;
        }
        revert("HONEYPOT: Cannot transfer");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/**
 * @title ClaimSellBlockedToken
 * @notice Sophisticated honeypot that only blocks selling AFTER claiming
 * 
 * WHAT IT ALLOWS:
 * - Anyone to claim 1,000 tokens once via `claimAirdrop()`
 * - Minting and burning (standard ERC20 behavior)
 * - Owner transfers (owner is exempt from all restrictions)
 * - Transfers between regular wallets (can send to friends)
 * 
 * WHAT IT DISALLOW (Smart Restriction):
 * - **Sells to DEX pair are permanently disabled** after claiming
 * - If you claim from wallet X, X can NEVER sell tokens to the DEX
 * - Transfers to DEX pair (`to == dexPair`) from claimed wallets revert
 * - This makes tokens **unsellable** while appearing functional
 * 
 * HONEYPOT MECHANISM:
 * 1. Victim sees "free airdrop" of 1,000 tokens
 * 2. Claims tokens successfully (claimAirdrop() works)
 * 3. Tries to sell on DEX - **reverts with "SELL DISABLED: claimed wallet"**
 * 4. Tokens are now worthless but appear in wallet
 * 
 * GAS EFFICIENCY:
 * - Minimal state (one bool per wallet)
 * - Single SLOAD in transfer check
 * - Perfect for Ward's testing (low gas, predictable behavior)
 */

// DEX_PAIR=0x0000000000000000000000000000000000000001

/// @notice Airdrop honeypot: claiming permanently disables selling
contract ClaimSellBlockedToken is ERC20 {
    address public immutable owner;
    address public dexPair;

    mapping(address => bool) public claimed;

    constructor(address _dexPair)
        ERC20("Claim Sell Blocked Token", "CSBT")
    {
        owner = msg.sender;
        dexPair = _dexPair;

        // Initial supply for liquidity
        _mint(msg.sender, 1_000_000 ether);
    }

    /// @notice Fake airdrop
    function claimAirdrop() external {
        require(!claimed[msg.sender], "Already claimed");
        claimed[msg.sender] = true;
        _mint(msg.sender, 1_000 ether);
    }

    /// @notice Owner can update pair if needed
    function setDexPair(address _pair) external {
        require(msg.sender == owner, "Not owner");
        dexPair = _pair;
    }

    /// @notice Core honeypot logic
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256
    ) internal view override {
        if (from == address(0) || to == address(0)) return;

        // Owner always allowed
        if (from == owner) return;

        // Block sells from claimed wallets
        if (to == dexPair && claimed[from]) {
            revert("SELL DISABLED: claimed wallet");
        }
    }
}

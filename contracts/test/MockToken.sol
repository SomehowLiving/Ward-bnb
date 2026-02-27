// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/// @notice Simple mock token for testing Ward's isolation
contract MockToken is ERC20 {
    constructor() ERC20("Mock USDC", "MUSDC") {
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }
}
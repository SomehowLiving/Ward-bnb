// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Pocket.sol";
import "./PocketFactory.sol";

contract PocketController {
    /// -----------------------------------------------------------------------
    /// Configuration
    /// -----------------------------------------------------------------------

    address public immutable factory;
    address public treasury;

    uint256 public constant GAS_RESERVE = 0.005 ether;

    /// fee in basis points
    function feeBps(uint8 tier) public pure returns (uint256) {
        if (tier == 2) return 200; // 2%
        if (tier == 4) return 300; // 3%
        if (tier == 3) return 800; // 8%
        return 0;
    }

    /// -----------------------------------------------------------------------
    /// State
    /// -----------------------------------------------------------------------

    mapping(address => bool) public validPocket;
    mapping(address => address) public pocketOwner;

    /// -----------------------------------------------------------------------
    /// Errors
    /// -----------------------------------------------------------------------

    error InvalidPocket();
    error NotPocketOwner();
    error InsufficientControllerBalance();

    /// -----------------------------------------------------------------------
    /// Constructor
    /// -----------------------------------------------------------------------

    constructor(address _factory, address _treasury) {
        factory = _factory;
        treasury = _treasury;
    }

    /// -----------------------------------------------------------------------
    /// Pocket creation (lazy)
    /// -----------------------------------------------------------------------

    function createPocket(
        address user,
        uint256 salt
    ) external returns (address pocket) {
        if (address(this).balance < GAS_RESERVE) {
            revert InsufficientControllerBalance();
        }

        pocket = PocketFactory(factory).deployPocket(
            address(this),
            user,
            salt
        );

        validPocket[pocket] = true;
        pocketOwner[pocket] = user;

        (bool ok, ) = pocket.call{value: GAS_RESERVE}("");
        require(ok, "ETH_FUND_FAIL");
    }

    /// -----------------------------------------------------------------------
    /// Burn pocket (irreversible)
    /// -----------------------------------------------------------------------

    function burnPocket(
        address payable pocket,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external {
        if (!validPocket[pocket]) revert InvalidPocket();
        Pocket(pocket).burn(nonce, expiry, signature);
        validPocket[pocket] = false;
    }
    /// -----------------------------------------------------------------------
    /// Execution routing
    /// -----------------------------------------------------------------------

    function executeFromPocket(
        address payable pocket,
        address target,
        bytes calldata data,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external {
        if (!validPocket[pocket]) revert InvalidPocket();

        Pocket(pocket).exec(
            target,
            data,
            nonce,
            expiry,
            signature
        );
    }

    /// -----------------------------------------------------------------------
    /// Sweep with on-chain fee enforcement
    /// -----------------------------------------------------------------------

    function sweep(
        address payable pocket,
        address token,
        address receiver,
        uint256 amount,
        uint8 tier
    ) external {
        if (!validPocket[pocket]) revert InvalidPocket();
        if (pocketOwner[pocket] != receiver) revert NotPocketOwner();

        uint256 fee = (amount * feeBps(tier)) / 10_000;

        if (fee > 0) {
            Pocket(pocket).sweepERC20(token, treasury, fee);
        }

        Pocket(pocket).sweepERC20(
            token,
            receiver,
            amount - fee
        );
    }

    receive() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
// import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Pocket
/// @notice Single-use execution sandbox for risky on-chain interactions
/// @dev Authority is granted only via EIP-712 signatures
contract Pocket is EIP712 {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;


    /// -----------------------------------------------------------------------
    /// Constants
    /// -----------------------------------------------------------------------

    bytes32 private constant EXEC_TYPEHASH =
        keccak256(
            "Exec(address pocket,address target,bytes32 dataHash,uint256 nonce,uint256 expiry)"
        );

    bytes32 private constant BURN_TYPEHASH =
        keccak256(
            "Burn(address pocket,uint256 nonce,uint256 expiry)"
        );

    /// -----------------------------------------------------------------------
    /// Immutable configuration
    /// -----------------------------------------------------------------------

    address public immutable controller;
    address public immutable owner;

    /// -----------------------------------------------------------------------
    /// State
    /// -----------------------------------------------------------------------

    bool public used;
    bool public burned;

    mapping(uint256 => bool) public usedNonces;

    /// -----------------------------------------------------------------------
    /// Errors
    /// -----------------------------------------------------------------------

    error NotController();
    error PocketAlreadyUsed();
    error PocketBurned();
    error NonceUsed();
    error SignatureExpired();
    error InvalidSigner();
    error ExecutionFailed();

    /// -----------------------------------------------------------------------
    /// Constructor
    /// -----------------------------------------------------------------------

    constructor(address _controller, address _owner)
        EIP712("Ward Pocket", "1")
    {
        controller = _controller;
        owner = _owner;
    }

    /// -----------------------------------------------------------------------
    /// Single-use execution
    /// -----------------------------------------------------------------------

    function exec(
        address target,
        bytes calldata data,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external {
        if (msg.sender != controller) revert NotController();
        if (burned) revert PocketBurned();
        if (used) revert PocketAlreadyUsed();
        if (usedNonces[nonce]) revert NonceUsed();
        if (block.timestamp > expiry) revert SignatureExpired();

        bytes32 structHash = keccak256(
            abi.encode(
                EXEC_TYPEHASH,
                address(this),
                target,
                keccak256(data),
                nonce,
                expiry
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(signature);

        if (signer != owner) revert InvalidSigner();

        usedNonces[nonce] = true;
        used = true;

        (bool ok, ) = target.call(data);
        if (!ok) revert ExecutionFailed();
    }

    /// -----------------------------------------------------------------------
    /// Sweep ERC20 tokens (controller only)
    /// -----------------------------------------------------------------------

    function sweepERC20(
        address token,
        address to,
        uint256 amount
    ) external {
        if (msg.sender != controller) revert NotController();
        if (burned) revert PocketBurned();

        // IERC20(token).transfer(to, amount);
        IERC20(token).safeTransfer(to, amount);

    }

    /// -----------------------------------------------------------------------
    /// Burn pocket (irreversible)
    /// -----------------------------------------------------------------------

    function burn(
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external {
        if (msg.sender != controller) revert NotController();
        if (burned) revert PocketBurned();
        if (usedNonces[nonce]) revert NonceUsed();
        if (block.timestamp > expiry) revert SignatureExpired();

        bytes32 structHash = keccak256(
            abi.encode(
                BURN_TYPEHASH,
                address(this),
                nonce,
                expiry
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(signature);

        if (signer != owner) revert InvalidSigner();

        burned = true;
        selfdestruct(payable(controller));
    }

    /// -----------------------------------------------------------------------
    /// Receive ETH
    /// -----------------------------------------------------------------------

    receive() external payable {}
}

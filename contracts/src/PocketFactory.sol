// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Pocket.sol";

contract PocketFactory {
    event PocketDeployed(address pocket, address owner);

    function deployPocket(
        address controller,
        address owner,
        uint256 salt
    ) external returns (address pocket) {
        bytes32 createSalt = keccak256(
            abi.encodePacked(owner, salt)
        );

        pocket = address(
            new Pocket{salt: createSalt}(controller, owner)
        );

        emit PocketDeployed(pocket, owner);
    }
}

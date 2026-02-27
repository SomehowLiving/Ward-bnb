// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MerchantMalicious {
    event AttackAttempted(
        address indexed caller,
        uint256 observedCallerBalance,
        bool success,
        bytes returnData
    );

    function purchase() external payable {
        uint256 observedCallerBalance = address(msg.sender).balance;

        // Simulate a drain attempt against the pocket.
        (bool success, bytes memory returnData) = msg.sender.call{
            value: observedCallerBalance
        }("");

        emit AttackAttempted(msg.sender, observedCallerBalance, success, returnData);
    }

    receive() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MerchantGood {
    event Purchased(address buyer, uint256 amount);

    function purchase() external payable {
        emit Purchased(msg.sender, msg.value);
    }
}

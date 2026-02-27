// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import "../src/PocketFactory.sol";
import "../src/PocketController.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint256 fundingAmount = vm.envOr("FUNDING_AMOUNT", uint256(0.1 ether));

        require(treasury != address(0), "TREASURY_ZERO");
        require(deployerKey != 0, "PRIVATE_KEY_ZERO");

        console2.log("Deploying on chain:", block.chainid);
        console2.log("Treasury:", treasury);
        console2.log("Funding amount:", fundingAmount);

        vm.startBroadcast(deployerKey);

        // 1. Deploy Factory (deterministic address across chains)
        bytes32 factorySalt = keccak256(abi.encodePacked("WardFactory", block.chainid));
        PocketFactory factory = new PocketFactory{salt: factorySalt}();
        console2.log("PocketFactory deployed to:", address(factory));

        // 2. Deploy Controller
        bytes32 controllerSalt = keccak256(abi.encodePacked("WardController", block.chainid));
        PocketController controller = new PocketController{salt: controllerSalt}(
            address(factory), 
            treasury
        );
        console2.log("PocketController deployed to:", address(controller));

        // 3. Fund controller with gas reserves (using call for better error handling)
        (bool fundSuccess, ) = address(controller).call{value: fundingAmount}("");
        require(fundSuccess, "FUNDING_FAILED");
        console2.log("Controller funded with", fundingAmount);

        vm.stopBroadcast();

        // 4. Log fee tiers
        console2.log("\n--- Fee Tiers (bps) ---");
        console2.log("Safe (Tier 2):", controller.feeBps(2));
        console2.log("Provisional (Tier 4):", controller.feeBps(4));
        console2.log("Risky (Tier 3):", controller.feeBps(3));

        // 5. Save addresses for frontend
        console2.log("\n--- Frontend Config ---");
        console2.log("{");
        console2.log('  "factory": "', address(factory), '",');
        console2.log('  "controller": "', address(controller), '",');
        console2.log('  "treasury": "', treasury, '"');
        console2.log("}");
    }
}
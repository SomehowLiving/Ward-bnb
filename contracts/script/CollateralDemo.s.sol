// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import "../src/PocketFactory.sol";
import "../src/PocketController.sol";
import "../src/Pocket.sol";
import "../src/CollateralVault.sol";
import "../src/MerchantGood.sol";
import "../src/MerchantMalicious.sol";

contract DeployCollateralDemo is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint256 fundingAmount = vm.envOr("FUNDING_AMOUNT", uint256(1 ether));
        address blockMerchantAddr = vm.envOr("BLOCK_MERCHANT", address(0));

        require(deployerKey != 0, "PRIVATE_KEY_ZERO");
        require(treasury != address(0), "TREASURY_ZERO");

        vm.startBroadcast(deployerKey);

        PocketFactory factory = new PocketFactory();
        PocketController controller = new PocketController(address(factory), treasury);
        CollateralVault vault = new CollateralVault(address(controller));
        MerchantGood goodMerchant = new MerchantGood();
        MerchantMalicious maliciousMerchant = new MerchantMalicious();

        (bool ok, ) = address(controller).call{value: fundingAmount}("");
        require(ok, "CONTROLLER_FUND_FAIL");

        if (blockMerchantAddr != address(0)) {
            vault.blockMerchant(blockMerchantAddr);
        }

        vm.stopBroadcast();

        console2.log("PocketFactory:", address(factory));
        console2.log("PocketController:", address(controller));
        console2.log("CollateralVault:", address(vault));
        console2.log("CollateralVault owner:", vault.owner());
        console2.log("MerchantGood:", address(goodMerchant));
        console2.log("MerchantMalicious:", address(maliciousMerchant));
        console2.log("Controller funded with:", fundingAmount);
        if (blockMerchantAddr != address(0)) {
            console2.log("Blocked merchant at deploy:", blockMerchantAddr);
        }
    }
}

contract RunCollateralDemo is Script {
    bytes32 private constant EXEC_TYPEHASH =
        keccak256(
            "Exec(address pocket,address target,bytes32 dataHash,uint256 nonce,uint256 expiry)"
        );

    function run() external {
        uint256 borrowerKey = vm.envUint("BORROWER_PRIVATE_KEY");
        PocketController controller =
            PocketController(payable(vm.envAddress("POCKET_CONTROLLER")));
        CollateralVault vault =
            CollateralVault(payable(vm.envAddress("COLLATERAL_VAULT")));
        MerchantGood goodMerchant = MerchantGood(vm.envAddress("MERCHANT_GOOD"));
        MerchantMalicious maliciousMerchant =
            MerchantMalicious(payable(vm.envAddress("MERCHANT_MALICIOUS")));

        address borrower = vm.addr(borrowerKey);

        vm.startBroadcast(borrowerKey);

        vault.deposit{value: 5 ether}();
        console2.log("Borrower deposited 5 ETH/BNB as collateral");
        console2.log("Available credit:", vault.availableCredit(borrower));

        (bytes32 reqGood, address pocketGood) = vault.requestCredit(
            address(goodMerchant),
            1 ether,
            3,
            1 days,
            11
        );
        console2.log("Good requestId:");
        console2.logBytes32(reqGood);
        console2.log("Good pocket:", pocketGood);

        (bytes32 reqBad, address pocketBad) = vault.requestCredit(
            address(maliciousMerchant),
            1 ether,
            3,
            1 days,
            12
        );
        console2.log("Bad requestId:");
        console2.logBytes32(reqBad);
        console2.log("Bad pocket:", pocketBad);

        uint256 vaultBalanceBeforeAttack = address(vault).balance;
        _executeDemoPurchase(
            controller,
            borrowerKey,
            pocketGood,
            address(goodMerchant),
            abi.encodeWithSelector(MerchantGood.purchase.selector),
            1
        );
        _executeDemoPurchase(
            controller,
            borrowerKey,
            pocketBad,
            address(maliciousMerchant),
            abi.encodeWithSelector(MerchantMalicious.purchase.selector),
            2
        );

        uint256 vaultBalanceAfterAttack = address(vault).balance;

        console2.log("Vault balance before malicious call:", vaultBalanceBeforeAttack);
        console2.log("Vault balance after malicious call:", vaultBalanceAfterAttack);

        uint256 installment = uint256(1 ether) / 3;
        vault.repayInstallment{value: installment}(reqGood);
        vault.repayInstallment{value: installment}(reqGood);
        vault.repayInstallment{value: uint256(1 ether) - (2 * installment)}(reqGood);
        console2.log("Repaid first credit position");

        (bytes32 reqLiquidate, ) = vault.requestCredit(
            address(goodMerchant),
            0.5 ether,
            1,
            1,
            13
        );
        console2.log("Liquidation requestId:");
        console2.logBytes32(reqLiquidate);

        vm.stopBroadcast();

        // Needs a separate tx/block so dueDate is passed.
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 2);

        vm.startBroadcast(borrowerKey);
        vault.liquidate(reqLiquidate);
        vm.stopBroadcast();

        console2.log("Liquidated defaulted position");
        console2.log("Final available credit:", vault.availableCredit(borrower));
        (, uint256 borrowed) = vault.positions(borrower);
        console2.log("Borrowed outstanding:", borrowed);
        console2.logBytes32(reqBad);
        console2.log("Second (malicious) position remains open until repaid or liquidated");
    }

    function _executeDemoPurchase(
        PocketController controller,
        uint256 borrowerKey,
        address pocket,
        address target,
        bytes memory data,
        uint256 nonce
    ) internal {
        uint256 expiry = block.timestamp + 1 days;
        bytes memory signature =
            _signExec(borrowerKey, pocket, target, data, nonce, expiry);

        controller.executeFromPocket(
            payable(pocket),
            target,
            data,
            nonce,
            expiry,
            signature
        );
    }

    function _signExec(
        uint256 signerPk,
        address pocket,
        address target,
        bytes memory data,
        uint256 nonce,
        uint256 expiry
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(EXEC_TYPEHASH, pocket, target, keccak256(data), nonce, expiry)
        );

        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("Ward Pocket")),
                keccak256(bytes("1")),
                block.chainid,
                pocket
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }
}

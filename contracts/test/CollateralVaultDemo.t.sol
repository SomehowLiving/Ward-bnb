// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import "../src/PocketFactory.sol";
import "../src/PocketController.sol";
import "../src/CollateralVault.sol";
import "../src/MerchantGood.sol";
import "../src/MerchantMalicious.sol";
import "../src/Pocket.sol";

contract MerchantVaultDrainer {
    address payable internal immutable vault;

    constructor(address payable _vault) {
        vault = _vault;
    }

    function purchase() external payable {
        (bool ok, ) = vault.call{value: address(this).balance}("");
        ok;
    }
}

contract CollateralVaultDemoTest is Test {
    uint256 internal borrowerPk;
    address internal borrower;
    address internal treasury;

    PocketFactory internal factory;
    PocketController internal controller;
    CollateralVault internal vault;
    MerchantGood internal goodMerchant;
    MerchantMalicious internal maliciousMerchant;
    MerchantVaultDrainer internal vaultDrainer;

    bytes32 private constant EXEC_TYPEHASH =
        keccak256(
            "Exec(address pocket,address target,bytes32 dataHash,uint256 nonce,uint256 expiry)"
        );
    bytes32 private constant BURN_TYPEHASH =
        keccak256(
            "Burn(address pocket,uint256 nonce,uint256 expiry)"
        );

    function setUp() public {
        borrowerPk = 0xA11CE;
        borrower = vm.addr(borrowerPk);
        treasury = address(0xBEEF);

        factory = new PocketFactory();
        controller = new PocketController(address(factory), treasury);
        vault = new CollateralVault(address(controller));
        goodMerchant = new MerchantGood();
        maliciousMerchant = new MerchantMalicious();
        vaultDrainer = new MerchantVaultDrainer(payable(address(vault)));

        vm.deal(address(controller), 1 ether);
        vm.deal(borrower, 10 ether);
    }

    function testSmartCollateralFlow() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();
        assertEq(vault.availableCredit(borrower), 3.5 ether);

        vm.prank(borrower);
        (bytes32 reqGood, address pocketGood) =
            vault.requestCredit(address(goodMerchant), 1 ether, 3 days, 1);

        vm.prank(borrower);
        (bytes32 reqBad, address pocketBad) =
            vault.requestCredit(address(maliciousMerchant), 1 ether, 3 days, 2);

        assertEq(pocketGood.balance, 1 ether + controller.GAS_RESERVE());
        assertEq(pocketBad.balance, 1 ether + controller.GAS_RESERVE());

        uint256 vaultBeforeAttack = address(vault).balance;

        _executeFromPocket(
            pocketGood,
            address(goodMerchant),
            abi.encodeWithSelector(MerchantGood.purchase.selector),
            101
        );

        _executeFromPocket(
            pocketBad,
            address(maliciousMerchant),
            abi.encodeWithSelector(MerchantMalicious.purchase.selector),
            102
        );

        uint256 vaultAfterAttack = address(vault).balance;
        assertEq(vaultAfterAttack, vaultBeforeAttack, "vault balance changed after attack attempt");

        vm.prank(borrower);
        vault.repay{value: 1 ether}(reqGood);

        (uint256 deposited, uint256 borrowed) = vault.positions(borrower);
        assertEq(deposited, 5 ether);
        assertEq(borrowed, 1 ether, "borrowed should reflect only unrepaid request");

        vm.prank(borrower);
        (bytes32 reqDefault, ) = vault.requestCredit(address(goodMerchant), 0.5 ether, 1, 3);

        vm.warp(block.timestamp + 2);
        vault.liquidate(reqDefault);

        (, uint256 borrowedAfterLiquidation) = vault.positions(borrower);
        assertEq(borrowedAfterLiquidation, 1 ether, "liquidation should reduce borrowed balance");

        // Keep request ids used to satisfy lints and document intended demo behavior.
        assertTrue(reqBad != bytes32(0));
    }

    function testIsolationEnforcementSingleUseRevertsSecondExec() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        (, address pocketGood) = vault.requestCredit(address(goodMerchant), 1 ether, 3 days, 10);

        _executeFromPocket(
            pocketGood,
            address(goodMerchant),
            abi.encodeWithSelector(MerchantGood.purchase.selector),
            101
        );

        vm.expectRevert(Pocket.PocketAlreadyUsed.selector);
        _executeFromPocket(
            pocketGood,
            address(goodMerchant),
            abi.encodeWithSelector(MerchantGood.purchase.selector),
            999
        );
    }

    function testIsolationEnforcementWrongSignerFails() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        (, address pocketGood) = vault.requestCredit(address(goodMerchant), 1 ether, 3 days, 11);

        bytes memory data = abi.encodeWithSelector(MerchantGood.purchase.selector);
        uint256 nonce = 202;
        uint256 expiry = block.timestamp + 1 days;
        bytes memory badSig = _signExecWithPk(pocketGood, address(goodMerchant), data, nonce, expiry, 0xB0B);

        vm.expectRevert(Pocket.InvalidSigner.selector);
        controller.executeFromPocket(
            payable(pocketGood),
            address(goodMerchant),
            data,
            nonce,
            expiry,
            badSig
        );
    }

    function testCreditBoundaryCannotBorrowAboveLtv() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        vm.expectRevert(CollateralVault.InsufficientCredit.selector);
        vault.requestCredit(address(goodMerchant), 4 ether, 3 days, 12);
    }

    function testCreditBoundaryBorrowUntilLimitThenFail() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.startPrank(borrower);
        vault.requestCredit(address(goodMerchant), 1 ether, 3 days, 13);
        vault.requestCredit(address(goodMerchant), 1 ether, 3 days, 14);
        vault.requestCredit(address(goodMerchant), 1.5 ether, 3 days, 15);
        assertEq(vault.availableCredit(borrower), 0);

        vm.expectRevert(CollateralVault.InsufficientCredit.selector);
        vault.requestCredit(address(goodMerchant), 1, 3 days, 16);
        vm.stopPrank();
    }

    function testVaultSafetyMerchantCannotDrainVault() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        (, address pocket) = vault.requestCredit(address(vaultDrainer), 1 ether, 3 days, 17);

        uint256 vaultBefore = address(vault).balance;
        _executeFromPocket(
            pocket,
            address(vaultDrainer),
            abi.encodeWithSelector(MerchantVaultDrainer.purchase.selector),
            303
        );
        uint256 vaultAfter = address(vault).balance;
        assertEq(vaultAfter, vaultBefore, "vault balance changed");
    }

    function testLiquidationEdgeCannotLiquidateBeforeDueDate() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        (bytes32 req, ) = vault.requestCredit(address(goodMerchant), 1 ether, 3 days, 18);

        vm.expectRevert(CollateralVault.NotDefaulted.selector);
        vault.liquidate(req);
    }

    function testLiquidationEdgeCannotLiquidateRepaidRequest() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        (bytes32 req, ) = vault.requestCredit(address(goodMerchant), 1 ether, 3 days, 19);

        vm.prank(borrower);
        vault.repay{value: 1 ether}(req);

        vm.expectRevert(CollateralVault.AlreadyRepaid.selector);
        vault.liquidate(req);
    }

    function testAccountingConsistencyAcrossFlows() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        (bytes32 reqA, ) = vault.requestCredit(address(goodMerchant), 1 ether, 3 days, 20);
        vm.prank(borrower);
        vault.requestCredit(address(goodMerchant), 0.5 ether, 3 days, 21);

        vm.prank(borrower);
        vault.repay{value: 1 ether}(reqA);

        uint256 expectedVaultBalance = 5 ether - 1 ether - 0.5 ether + 1 ether;
        assertEq(address(vault).balance, expectedVaultBalance);
    }

    function testPocketBurnAfterRepayInvalidatesPocketAndBlocksExec() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        (bytes32 req, address pocket) = vault.requestCredit(address(goodMerchant), 1 ether, 3 days, 22);

        vm.prank(borrower);
        vault.repay{value: 1 ether}(req);

        uint256 burnNonce = 404;
        uint256 burnExpiry = block.timestamp + 1 days;
        bytes memory burnSig = _signBurn(pocket, burnNonce, burnExpiry, borrowerPk);

        controller.burnPocket(payable(pocket), burnNonce, burnExpiry, burnSig);
        assertFalse(controller.validPocket(pocket));

        bytes memory execData = abi.encodeWithSelector(MerchantGood.purchase.selector);
        bytes memory execSig =
            _signExecWithPk(pocket, address(goodMerchant), execData, 405, block.timestamp + 1 days, borrowerPk);

        vm.expectRevert(PocketController.InvalidPocket.selector);
        controller.executeFromPocket(
            payable(pocket),
            address(goodMerchant),
            execData,
            405,
            block.timestamp + 1 days,
            execSig
        );
    }

    function testNonceReuseRevertsWithNonceUsed() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        (, address pocket) = vault.requestCredit(address(goodMerchant), 1 ether, 3 days, 23);

        _executeFromPocket(
            pocket,
            address(goodMerchant),
            abi.encodeWithSelector(MerchantGood.purchase.selector),
            505
        );

        uint256 burnExpiry = block.timestamp + 1 days;
        bytes memory burnSig = _signBurn(pocket, 505, burnExpiry, borrowerPk);

        vm.expectRevert(Pocket.NonceUsed.selector);
        controller.burnPocket(payable(pocket), 505, burnExpiry, burnSig);
    }

    function testGasReserveIntegrityControllerPaysOnlyReservePerPocket() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        uint256 controllerBefore = address(controller).balance;
        uint256 reserve = controller.GAS_RESERVE();

        vm.startPrank(borrower);
        vault.requestCredit(address(goodMerchant), 1 ether, 3 days, 24);
        vault.requestCredit(address(goodMerchant), 0.5 ether, 3 days, 25);
        vm.stopPrank();

        uint256 controllerAfter = address(controller).balance;
        assertEq(controllerBefore - controllerAfter, reserve * 2);
    }

    function testEdgeZeroDepositReverts() public {
        vm.prank(borrower);
        vm.expectRevert(CollateralVault.ZeroDeposit.selector);
        vault.deposit{value: 0}();
    }

    function _executeFromPocket(
        address pocket,
        address target,
        bytes memory data,
        uint256 nonce
    ) internal {
        uint256 expiry = block.timestamp + 1 days;
        bytes memory sig = _signExec(pocket, target, data, nonce, expiry);

        controller.executeFromPocket(
            payable(pocket),
            target,
            data,
            nonce,
            expiry,
            sig
        );
    }

    function _signExec(
        address pocket,
        address target,
        bytes memory data,
        uint256 nonce,
        uint256 expiry
    ) internal view returns (bytes memory) {
        return _signExecWithPk(pocket, target, data, nonce, expiry, borrowerPk);
    }

    function _signExecWithPk(
        address pocket,
        address target,
        bytes memory data,
        uint256 nonce,
        uint256 expiry,
        uint256 signerPk
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

    function _signBurn(
        address pocket,
        uint256 nonce,
        uint256 expiry,
        uint256 signerPk
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(BURN_TYPEHASH, pocket, nonce, expiry)
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

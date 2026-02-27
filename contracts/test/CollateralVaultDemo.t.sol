// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import "../src/PocketFactory.sol";
import "../src/PocketController.sol";
import "../src/CollateralVault.sol";
import "../src/MerchantGood.sol";
import "../src/Pocket.sol";

contract CollateralVaultDemoTest is Test {
    uint256 internal borrowerPk;
    address internal borrower;

    PocketFactory internal factory;
    PocketController internal controller;
    CollateralVault internal vault;
    MerchantGood internal goodMerchant;

    bytes32 private constant EXEC_TYPEHASH =
        keccak256(
            "Exec(address pocket,address target,bytes32 dataHash,uint256 nonce,uint256 expiry)"
        );

    function setUp() public {
        borrowerPk = 0xA11CE;
        borrower = vm.addr(borrowerPk);

        factory = new PocketFactory();
        controller = new PocketController(address(factory), address(0xBEEF));
        vault = new CollateralVault(address(controller));
        goodMerchant = new MerchantGood();

        vm.deal(address(controller), 1 ether);
        vm.deal(borrower, 20 ether);
    }

    function testMultipleInstallmentRepayment() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        (bytes32 req, ) = vault.requestCredit(address(goodMerchant), 1 ether, 4, 1 days, 1);

        for (uint256 i = 0; i < 4; i++) {
            vm.prank(borrower);
            vault.repayInstallment{value: 0.25 ether}(req);
            if (i < 3) {
                vm.warp(block.timestamp + 1 hours);
            }
        }

        (
            uint256 principal,
            uint256 remaining,
            uint256 installmentAmount,
            uint256 installmentsPaid,
            uint256 totalInstallments,
            uint256 interval,
            uint256 nextDueDate,
            bool defaulted,
            bool closed,
            address pocket
        ) = vault.creditPositions(req);
        assertEq(principal, 1 ether);
        assertEq(remaining, 0);
        assertEq(installmentAmount, 0.25 ether);
        assertEq(installmentsPaid, 4);
        assertEq(totalInstallments, 4);
        assertEq(interval, 1 days);
        assertTrue(nextDueDate > 0);
        assertFalse(defaulted);
        assertTrue(closed);
        assertTrue(pocket != address(0));

        (, uint256 borrowed) = vault.positions(borrower);
        assertEq(borrowed, 0);
    }

    function testLastInstallmentRoundingRemainder() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        (bytes32 req, ) = vault.requestCredit(address(goodMerchant), 1 ether + 1, 3, 1 days, 2);

        uint256 installment = uint256(1 ether + 1) / 3;
        vm.prank(borrower);
        vault.repayInstallment{value: installment}(req);

        vm.prank(borrower);
        vault.repayInstallment{value: installment}(req);

        uint256 remainder = (1 ether + 1) - (installment * 2);
        vm.prank(borrower);
        vault.repayInstallment{value: remainder}(req);

        (, uint256 remaining,,,,,,, bool closed,) = vault.creditPositions(req);
        assertEq(remaining, 0);
        assertTrue(closed);
    }

    function testDefaultAfterMissingInstallment() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        (bytes32 req, ) = vault.requestCredit(address(goodMerchant), 1 ether, 3, 1 days, 3);

        vm.warp(block.timestamp + 2 days);
        vault.liquidate(req);

        (,,,,,,, bool defaulted, bool closed,) = vault.creditPositions(req);
        assertTrue(defaulted);
        assertFalse(closed);

        (, uint256 borrowed) = vault.positions(borrower);
        assertEq(borrowed, 0);
    }

    function testCannotRepayAfterDefault() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        (bytes32 req, ) = vault.requestCredit(address(goodMerchant), 1 ether, 2, 1 days, 4);

        vm.warp(block.timestamp + 2 days);
        vault.liquidate(req);

        vm.prank(borrower);
        vm.expectRevert(CollateralVault.LoanDefaulted.selector);
        vault.repayInstallment{value: 0.5 ether}(req);
    }

    function testBorrowedOnlyDecreasesWhenFullyClosed() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        (bytes32 req, ) = vault.requestCredit(address(goodMerchant), 1 ether, 4, 1 days, 5);

        (, uint256 borrowedBefore) = vault.positions(borrower);
        assertEq(borrowedBefore, 1 ether);

        vm.prank(borrower);
        vault.repayInstallment{value: 0.25 ether}(req);
        vm.prank(borrower);
        vault.repayInstallment{value: 0.25 ether}(req);

        (, uint256 borrowedMid) = vault.positions(borrower);
        assertEq(borrowedMid, 1 ether);

        vm.prank(borrower);
        vault.repayInstallment{value: 0.25 ether}(req);
        vm.prank(borrower);
        vault.repayInstallment{value: 0.25 ether}(req);

        (, uint256 borrowedAfter) = vault.positions(borrower);
        assertEq(borrowedAfter, 0);
    }

    function testLtvBoundaryStillEnforced() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        vm.expectRevert(CollateralVault.InsufficientCredit.selector);
        vault.requestCredit(address(goodMerchant), 4 ether, 2, 1 days, 6);
    }

    function testExecutionIsolationRemainsUnchanged() public {
        vm.prank(borrower);
        vault.deposit{value: 5 ether}();

        vm.prank(borrower);
        (, address pocket) = vault.requestCredit(address(goodMerchant), 1 ether, 2, 1 days, 7);

        _executeFromPocket(
            pocket,
            address(goodMerchant),
            abi.encodeWithSelector(MerchantGood.purchase.selector),
            101
        );

        vm.expectRevert(Pocket.PocketAlreadyUsed.selector);
        _executeFromPocket(
            pocket,
            address(goodMerchant),
            abi.encodeWithSelector(MerchantGood.purchase.selector),
            102
        );
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
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerPk, digest);
        return abi.encodePacked(r, s, v);
    }
}

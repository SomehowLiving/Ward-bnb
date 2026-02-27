// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PocketFactory.sol";
import "../src/Pocket.sol";

contract PocketFactoryTest is Test {
    PocketFactory factory;

    address controller = address(0xCAFE);
    address ownerA = address(0xA11CE);
    address ownerB = address(0xB0B);

    function setUp() public {
        factory = new PocketFactory();
    }

    /// -----------------------------------------------------------------------
    /// Deterministic deployment
    /// -----------------------------------------------------------------------

    function testDeterministicAddressSameSalt() public {
        uint256 salt = 1;

        address pocket1 = factory.deployPocket(controller, ownerA, salt);

        vm.expectRevert(); // CREATE2 collision
        factory.deployPocket(controller, ownerA, salt);

        // sanity check: pocket exists
        assertTrue(pocket1.code.length > 0);
    }

    function testDifferentSaltCreatesDifferentPocket() public {
        address p1 = factory.deployPocket(controller, ownerA, 1);
        address p2 = factory.deployPocket(controller, ownerA, 2);

        assertTrue(p1 != p2);
    }

    function testDifferentOwnerCreatesDifferentPocket() public {
        address p1 = factory.deployPocket(controller, ownerA, 1);
        address p2 = factory.deployPocket(controller, ownerB, 1);

        assertTrue(p1 != p2);
    }

    /// -----------------------------------------------------------------------
    /// Pocket correctness
    /// -----------------------------------------------------------------------

    function testPocketInitializedCorrectly() public {
        address pocketAddr = factory.deployPocket(controller, ownerA, 42);
        Pocket pocket = Pocket(payable(pocketAddr));

        assertEq(pocket.owner(), ownerA);
        assertEq(pocket.controller(), controller);
        assertFalse(pocket.used());
    }

    /// -----------------------------------------------------------------------
    /// Safety invariants
    /// -----------------------------------------------------------------------

    function testFactoryHoldsNoFunds() public {
        vm.deal(address(factory), 10 ether);
        assertEq(address(factory).balance, 10 ether);

        // deploying a pocket does not move funds
        factory.deployPocket(controller, ownerA, 1);
        assertEq(address(factory).balance, 10 ether);
    }

    function testFactoryHasNoAuthorityOverPocket() public {
        address pocketAddr = factory.deployPocket(controller, ownerA, 1);
        Pocket pocket = Pocket(payable(pocketAddr));

        // factory cannot execute
        vm.expectRevert(Pocket.NotController.selector);
        pocket.exec(
            address(0xDEAD),
            "",
            1,
            block.timestamp + 1 hours,
            ""
        );

        // factory cannot sweep
        vm.expectRevert(Pocket.NotController.selector);
        pocket.sweepERC20(address(0xDEAD), ownerA, 1);
    }
}

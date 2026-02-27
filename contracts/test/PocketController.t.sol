// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/Pocket.sol";
import "../src/PocketController.sol";
import "../src/PocketFactory.sol";

contract MockERC20 {
    string public name = "Mock";
    string public symbol = "MOCK";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockTarget {
    uint256 public value;
    function setValue(uint256 v) external {
        value = v;
    }
}

contract PocketControllerTest is Test {
    /// -----------------------------------------------------------------------
    /// Actors
    /// -----------------------------------------------------------------------

    uint256 userPk;
    address user;

    address treasury;
    address relayer;

    PocketFactory factory;
    PocketController controller;
    MockERC20 token;
    MockTarget target;

    /// -----------------------------------------------------------------------
    /// Setup
    /// -----------------------------------------------------------------------

    function setUp() public {
        userPk = 0xA11CE;
        user = vm.addr(userPk);

        treasury = address(0xBEEF);
        relayer = address(this);

        factory = new PocketFactory();
        controller = new PocketController(address(factory), treasury);

        token = new MockERC20();
        target = new MockTarget();

        // fund controller for pocket creation
        vm.deal(address(controller), 1 ether);
    }

    /// -----------------------------------------------------------------------
    /// Helpers
    /// -----------------------------------------------------------------------

function _signExec(
    address pocket,
    address callTarget,
    bytes memory data,
    uint256 nonce,
    uint256 expiry
) internal view returns (bytes memory) {
    bytes32 typeHash = keccak256(
        "Exec(address pocket,address target,bytes32 dataHash,uint256 nonce,uint256 expiry)"
    );

    bytes32 structHash = keccak256(
        abi.encode(
            typeHash,
            pocket,
            callTarget,
            keccak256(data),
            nonce,
            expiry
        )
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

    bytes32 digest = keccak256(
        abi.encodePacked("\x19\x01", domainSeparator, structHash)
    );

    (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
    return abi.encodePacked(r, s, v);
}


    /// -----------------------------------------------------------------------
    /// Tests — Pocket Creation
    /// -----------------------------------------------------------------------

    function testCreatePocketFundsIt() public {
        address pocket = controller.createPocket(user, 1);

        assertTrue(controller.validPocket(pocket));
        assertEq(controller.pocketOwner(pocket), user);
        assertEq(pocket.balance, controller.GAS_RESERVE());
    }

    function testCannotCreatePocketIfUnderfunded() public {
        vm.deal(address(controller), 0);

        vm.expectRevert(PocketController.InsufficientControllerBalance.selector);
        controller.createPocket(user, 1);
    }

    /// -----------------------------------------------------------------------
    /// Tests — Execution Routing
    /// -----------------------------------------------------------------------

    function testControllerExecutesPocket() public {
        address payable pocket = payable(controller.createPocket(user, 1));

        bytes memory data = abi.encodeWithSelector(
            MockTarget.setValue.selector,
            123
        );

        uint256 nonce = 1;
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _signExec(pocket, address(target), data, nonce, expiry);

        controller.executeFromPocket(
            pocket,
            address(target),
            data,
            nonce,
            expiry,
            sig
        );

        assertEq(target.value(), 123);
    }

    function testCannotExecuteInvalidPocket() public {
        address fakePocket = address(0xBAD);

        vm.expectRevert(PocketController.InvalidPocket.selector);
        controller.executeFromPocket(
            payable(fakePocket),
            address(target),
            "",
            1,
            block.timestamp + 1 hours,
            ""
        );
    }

    /// -----------------------------------------------------------------------
    /// Tests — Sweep & Fee Enforcement
    /// -----------------------------------------------------------------------

    function testTier2SweepCharges2Percent() public {
        address payable pocket = payable(controller.createPocket(user, 1));

        // mint tokens to pocket
        token.mint(pocket, 100 ether);

        controller.sweep(
            pocket,
            address(token),
            user,
            100 ether,
            2 // Tier 2
        );

        assertEq(token.balanceOf(treasury), 2 ether);
        assertEq(token.balanceOf(user), 98 ether);
    }

    function testTier4SweepCharges3Percent() public {
        address payable pocket = payable(controller.createPocket(user, 1));
        token.mint(pocket, 100 ether);

        controller.sweep(
            pocket,
            address(token),
            user,
            100 ether,
            4
        );

        assertEq(token.balanceOf(treasury), 3 ether);
        assertEq(token.balanceOf(user), 97 ether);
    }

    function testTier3SweepCharges8Percent() public {
        address payable pocket = payable(controller.createPocket(user, 1));
        token.mint(pocket, 100 ether);

        controller.sweep(
            pocket,
            address(token),
            user,
            100 ether,
            3
        );

        assertEq(token.balanceOf(treasury), 8 ether);
        assertEq(token.balanceOf(user), 92 ether);
    }

    function testCannotSweepToNonOwner() public {
        address payable pocket = payable(controller.createPocket(user, 1));
        token.mint(pocket, 100 ether);

        vm.expectRevert(PocketController.NotPocketOwner.selector);
        controller.sweep(
            pocket,
            address(token),
            address(0xBADD),
            100 ether,
            2
        );
    }

    function testControllerCannotStealFunds() public {
        address payable pocket = payable(controller.createPocket(user, 1));
        token.mint(pocket, 50 ether);

        // treasury cannot sweep directly
        vm.prank(treasury);
        vm.expectRevert(PocketController.NotPocketOwner.selector);
        controller.sweep(
            pocket,
            address(token),
            treasury,
            50 ether,
            2
        );
    }

    function testSweepZeroAmountNoOp() public {
    address payable pocket = payable(controller.createPocket(user, 1));
    controller.sweep(pocket, address(token), user, 0, 2);

    assertEq(token.balanceOf(user), 0);
    assertEq(token.balanceOf(treasury), 0);
}

function testSweepInvalidPocketFails() public {
    address fake = address(0xBEEF);

    vm.expectRevert(PocketController.InvalidPocket.selector);
    controller.sweep(
        payable(fake),
        address(token),
        user,
        10 ether,
        2
    );
}

function testFeeRoundingDown() public {
    address payable pocket = payable(controller.createPocket(user, 1));
    token.mint(pocket, 101 ether);

    controller.sweep(pocket, address(token), user, 101 ether, 2);

    assertEq(token.balanceOf(treasury), 2.02 ether);
    assertEq(token.balanceOf(user), 98.98 ether);
}


}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./PocketController.sol";

contract CollateralVault {
    struct Position {
        uint256 deposited;
        uint256 borrowed;
    }

    struct CreditPosition {
        uint256 amount;
        uint256 dueDate;
        bool repaid;
        address pocket;
    }

    mapping(address => Position) public positions;
    mapping(bytes32 => CreditPosition) public creditPositions;
    mapping(bytes32 => address) public creditBorrower;
    mapping(address => uint256) public merchantFlagCount;
    mapping(address => mapping(address => bool)) public userHasFlagged;
    mapping(address => bool) public merchantBlocked;

    address public immutable pocketController;
    address public owner;

    uint256 public constant LTV = 70;

    event Deposited(address indexed user, uint256 amount, uint256 totalDeposited);
    event CreditRequested(
        bytes32 indexed requestId,
        address indexed user,
        address indexed merchant,
        address pocket,
        uint256 amount,
        uint256 dueDate
    );
    event Repaid(bytes32 indexed requestId, address indexed user, uint256 amount);
    event Liquidated(bytes32 indexed requestId, address indexed user, uint256 amount);

    error ZeroDeposit();
    error InvalidController();
    error InvalidDuration();
    error InsufficientCredit();
    error CreditAlreadyExists();
    error CreditNotFound();
    error Unauthorized();
    error AlreadyRepaid();
    error IncorrectRepayment();
    error NotDefaulted();
    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _controller) {
        if (_controller == address(0)) revert InvalidController();
        pocketController = _controller;
        owner = msg.sender;
    }

    function flagMerchant(address merchant) external {
        require(merchant != address(0), "Invalid merchant");
        require(!userHasFlagged[msg.sender][merchant], "Already flagged");

        userHasFlagged[msg.sender][merchant] = true;
        merchantFlagCount[merchant] += 1;
    }

    function blockMerchant(address merchant) external onlyOwner {
        require(merchant != address(0), "Invalid merchant");
        merchantBlocked[merchant] = true;
    }

    function unblockMerchant(address merchant) external onlyOwner {
        require(merchant != address(0), "Invalid merchant");
        merchantBlocked[merchant] = false;
    }

    function deposit() external payable {
        if (msg.value == 0) revert ZeroDeposit();

        Position storage position = positions[msg.sender];
        position.deposited += msg.value;

        emit Deposited(msg.sender, msg.value, position.deposited);
    }

    function availableCredit(address user) public view returns (uint256) {
        Position memory position = positions[user];
        uint256 maxBorrow = (position.deposited * LTV) / 100;
        if (maxBorrow <= position.borrowed) {
            return 0;
        }
        return maxBorrow - position.borrowed;
    }

    function requestCredit(
        address merchant,
        uint256 amount,
        uint256 duration,
        uint256 salt
    ) external returns (bytes32 requestId, address pocket) {
        require(!merchantBlocked[merchant], "Merchant blocked");
        if (duration == 0) revert InvalidDuration();
        if (amount > availableCredit(msg.sender)) revert InsufficientCredit();

        requestId = keccak256(
            abi.encode(msg.sender, merchant, amount, duration, salt)
        );

        if (creditPositions[requestId].dueDate != 0) revert CreditAlreadyExists();

        Position storage position = positions[msg.sender];
        position.borrowed += amount;

        pocket = PocketController(payable(pocketController)).createPocket(msg.sender, salt);

        (bool ok, ) = payable(pocket).call{value: amount}("");
        require(ok, "POCKET_FUND_FAIL");

        uint256 dueDate = block.timestamp + duration;
        creditPositions[requestId] = CreditPosition({
            amount: amount,
            dueDate: dueDate,
            repaid: false,
            pocket: pocket
        });
        creditBorrower[requestId] = msg.sender;

        emit CreditRequested(requestId, msg.sender, merchant, pocket, amount, dueDate);

        return (requestId, pocket);
    }

    function repay(bytes32 requestId) external payable {
        CreditPosition storage cp = creditPositions[requestId];
        if (cp.dueDate == 0) revert CreditNotFound();
        if (cp.repaid) revert AlreadyRepaid();

        address borrower = creditBorrower[requestId];
        if (borrower != msg.sender) revert Unauthorized();
        if (msg.value != cp.amount) revert IncorrectRepayment();

        cp.repaid = true;
        positions[borrower].borrowed -= cp.amount;

        emit Repaid(requestId, borrower, cp.amount);
    }

    function liquidate(bytes32 requestId) external {
        CreditPosition storage cp = creditPositions[requestId];
        if (cp.dueDate == 0) revert CreditNotFound();
        if (cp.repaid) revert AlreadyRepaid();
        if (block.timestamp <= cp.dueDate) revert NotDefaulted();

        address borrower = creditBorrower[requestId];
        cp.repaid = true;
        positions[borrower].borrowed -= cp.amount;

        emit Liquidated(requestId, borrower, cp.amount);
    }

    receive() external payable {}
}

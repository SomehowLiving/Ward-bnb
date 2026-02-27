// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./PocketController.sol";

contract CollateralVault {
    struct Position {
        uint256 deposited;
        uint256 borrowed;
    }

    struct CreditPosition {
        uint256 principal;
        uint256 remaining;
        uint256 installmentAmount;
        uint256 installmentsPaid;
        uint256 totalInstallments;
        uint256 interval;
        uint256 nextDueDate;
        bool defaulted;
        bool closed;
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
        uint256 principal,
        uint256 installmentAmount,
        uint256 totalInstallments,
        uint256 interval,
        uint256 nextDueDate
    );
    event InstallmentRepaid(
        bytes32 indexed requestId,
        address indexed user,
        uint256 amount,
        uint256 remaining,
        uint256 installmentsPaid,
        uint256 nextDueDate
    );
    event LoanClosed(bytes32 indexed requestId, address indexed user);
    event LoanLiquidated(bytes32 indexed requestId, address indexed user, uint256 principal);

    error ZeroDeposit();
    error InvalidController();
    error InvalidDuration();
    error InvalidInstallmentCount();
    error InsufficientCredit();
    error CreditAlreadyExists();
    error CreditNotFound();
    error Unauthorized();
    error AlreadyRepaid();
    error IncorrectRepayment();
    error NotDefaulted();
    error NotOwner();
    error LoanDefaulted();
    error LoanClosedError();
    error InstallmentPastDue();
    error AlreadyDefaulted();

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
        uint256 installmentCount,
        uint256 interval,
        uint256 salt
    ) external returns (bytes32 requestId, address pocket) {
        require(!merchantBlocked[merchant], "Merchant blocked");
        if (installmentCount == 0) revert InvalidInstallmentCount();
        if (interval == 0) revert InvalidDuration();
        if (amount > availableCredit(msg.sender)) revert InsufficientCredit();

        requestId = keccak256(
            abi.encode(msg.sender, merchant, amount, installmentCount, interval, salt)
        );

        if (creditBorrower[requestId] != address(0)) revert CreditAlreadyExists();

        Position storage position = positions[msg.sender];
        position.borrowed += amount;

        pocket = PocketController(payable(pocketController)).createPocket(msg.sender, salt);

        (bool ok, ) = payable(pocket).call{value: amount}("");
        require(ok, "POCKET_FUND_FAIL");

        uint256 installmentAmount = amount / installmentCount;
        require(installmentAmount > 0, "Installment too small");
        uint256 nextDueDate = block.timestamp + interval;

        creditPositions[requestId] = CreditPosition({
            principal: amount,
            remaining: amount,
            installmentAmount: installmentAmount,
            installmentsPaid: 0,
            totalInstallments: installmentCount,
            interval: interval,
            nextDueDate: nextDueDate,
            defaulted: false,
            closed: false,
            pocket: pocket
        });
        creditBorrower[requestId] = msg.sender;

        emit CreditRequested(
            requestId,
            msg.sender,
            merchant,
            pocket,
            amount,
            installmentAmount,
            installmentCount,
            interval,
            nextDueDate
        );

        return (requestId, pocket);
    }

    function repayInstallment(bytes32 requestId) external payable {
        CreditPosition storage cp = creditPositions[requestId];
        if (cp.principal == 0) revert CreditNotFound();
        if (cp.defaulted) revert LoanDefaulted();
        if (cp.closed) revert LoanClosedError();
        if (block.timestamp > cp.nextDueDate) revert InstallmentPastDue();

        address borrower = creditBorrower[requestId];
        if (borrower != msg.sender) revert Unauthorized();

        uint256 dueAmount = cp.installmentsPaid + 1 == cp.totalInstallments
            ? cp.remaining
            : cp.installmentAmount;
        if (msg.value != dueAmount) revert IncorrectRepayment();

        cp.remaining -= msg.value;
        cp.installmentsPaid += 1;
        if (cp.remaining > 0) {
            cp.nextDueDate += cp.interval;
        }

        emit InstallmentRepaid(
            requestId,
            borrower,
            msg.value,
            cp.remaining,
            cp.installmentsPaid,
            cp.nextDueDate
        );

        if (cp.remaining == 0) {
            cp.closed = true;
            positions[borrower].borrowed -= cp.principal;
            emit LoanClosed(requestId, borrower);
        }
    }

    function liquidate(bytes32 requestId) external {
        CreditPosition storage cp = creditPositions[requestId];
        if (cp.principal == 0) revert CreditNotFound();
        if (cp.closed) revert LoanClosedError();
        if (cp.defaulted) revert AlreadyDefaulted();
        if (block.timestamp <= cp.nextDueDate) revert NotDefaulted();

        address borrower = creditBorrower[requestId];
        cp.defaulted = true;
        positions[borrower].borrowed -= cp.principal;

        emit LoanLiquidated(requestId, borrower, cp.principal);
    }

    receive() external payable {}
}

# INTERFACES.md — Ward

## Purpose

This document defines the **canonical on-chain and off-chain interfaces** for Ward.

It specifies:

* smart contract interfaces,
* message formats,
* execution intents,
* invariants enforced at each boundary.

This is the **source of truth for engineering**.
If behavior is not expressible via these interfaces, it is out of scope.

---

## 1. Design Principles (Non-Negotiable)

1. **Explicit authority only**
   Every state-changing action must be backed by either:

   * deterministic on-chain rules, or
   * a user-signed EIP-712 intent.

2. **Single-use execution**
   Each pocket executes **at most once**.

3. **Non-custodial relayers**
   Relayers never custody or extract user assets.

4. **Main wallet isolation**
   Main wallet never executes risky logic or grants approvals.

---

## 2. Core On-Chain Contracts

### 2.1 PocketFactory (Deployment Only)

Responsible for deterministic deployment of Pocket contracts.

#### Interface

```solidity
interface IPocketFactory {
    function computePocketAddress(
        address owner,
        uint256 nonce
    ) external view returns (address);

    function deployPocket(
        address owner,
        uint256 nonce
    ) external returns (address pocket);
}
```

#### Notes

* Uses CREATE2
* Stateless beyond deployment
* No asset custody

---

### 2.2 PocketController (Policy + Funds)

Central policy enforcement contract.

#### Responsibilities

* Pocket creation + funding
* Execution routing
* Fee enforcement
* Sweep logic
* Emergency pause

---

#### Interface

```solidity
interface IPocketController {
    /* ========== Pocket Lifecycle ========== */

    function createPocket(
        address owner,
        uint256 nonce
    ) external returns (address pocket);

    function executeFromPocket(
        address pocket,
        address target,
        bytes calldata data,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external;

    /* ========== Asset Management ========== */

    function sweepToken(
        address pocket,
        address token,
        address receiver,
        uint256 amount,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external;

    function abandonPocket(address pocket) external;

    /* ========== Configuration ========== */

    function pause() external;
    function unpause() external;
}
```

---

#### Guarantees

* Controller **never executes target logic itself**
* Controller **never moves funds without rules or signatures**
* Fees are enforced **on-chain**

---

### 2.3 Pocket (Single-Use Smart Wallet)

Isolation boundary and execution sandbox.

---

#### Interface

```solidity
interface IPocket {
    function exec(
        address target,
        bytes calldata data,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external;

    function sweep(
        address token,
        address receiver,
        uint256 amount
    ) external;

    function disable() external;

    function owner() external view returns (address);
    function isUsed() external view returns (bool);
}
```

---

#### Pocket Invariants

* `exec()` callable **once**
* `exec()` requires valid user signature
* No approvals persist after execution
* `disable()` permanently freezes pocket

---

## 3. EIP-712 Signed Message Schemas

### 3.1 Execution Intent (Risky Call)

Authorizes exactly one contract call.

```solidity
struct ExecutionIntent {
    address pocket;
    address target;
    bytes data;
    uint256 nonce;
    uint256 expiry;
}
```

#### Domain Separator

```solidity
EIP712Domain {
  name: "Ward",
  version: "1",
  chainId: <chainId>,
  verifyingContract: <PocketController>
}
```

#### Security Properties

* Nonce prevents replay
* Expiry prevents delayed execution
* Scope limited to exact calldata

---

### 3.2 Withdraw Intent (User-Triggered Sweep)

Used for Tier 3 / Tier 4 withdrawals.

```solidity
struct WithdrawIntent {
    address pocket;
    address token;
    address receiver;
    uint256 amount;
    uint256 nonce;
    uint256 expiry;
}
```

#### Notes

* Required only when sweep is not auto-approved
* Explicit user risk acceptance

---

## 4. Relayer Interface (Off-Chain)

Relayers are **dumb executors**.

### Responsibilities

* Verify EIP-712 signatures
* Submit transactions
* Pay gas
* Monitor success/failure

### Relayer MUST NOT

* Modify intents
* Re-sign user data
* Capture protocol fees
* Hold assets

---

### Relayer Pseudocode

```ts
verifySignature(intent, signature);
checkNonceUnused(intent.nonce);
checkExpiry(intent.expiry);

sendTx(
  PocketController.executeFromPocket(
    intent.pocket,
    intent.target,
    intent.data,
    intent.nonce,
    intent.expiry,
    signature
  )
);
```

---

## 5. Backend Service Interfaces

### 5.1 Risk Classification API

```http
POST /risk/analyze
```

#### Request

```json
{
  "chainId": 1,
  "target": "0xContract",
  "calldata": "0x..."
}
```

#### Response

```json
{
  "tier": 3,
  "confidence": 0.72,
  "signals": [
    "unverified_code",
    "transfer_tax_detected"
  ]
}
```

---

### 5.2 Simulation API

```http
POST /simulate/transfer
POST /simulate/sell
```

#### Guarantees

* Read-only
* No fund movement
* Cached results

---

## 6. Fee Model Interface

### Fee Calculation (On-Chain)

```solidity
function calculateFee(
    uint256 amount,
    uint8 tier
) external pure returns (uint256);
```

| Tier   | Fee |
| ------ | --- |
| Tier 2 | 2%  |
| Tier 4 | 3%  |
| Tier 3 | 8%  |
| Tier 1 | 0%  |

---

## 7. Events (Mandatory for Indexing)

```solidity
event PocketCreated(address indexed pocket, address indexed owner);
event PocketExecuted(address indexed pocket, address target);
event PocketCompromised(address indexed pocket);
event TokenSwept(address indexed pocket, address token, uint256 amount);
event PocketAbandoned(address indexed pocket);
```

---

## 8. Failure & Revert Semantics

### Execution Failures

* Pocket marked used
* No retries on same pocket
* User must use a new pocket

### Sweep Failures

* Assets remain in pocket
* User may retry or abandon

---

## 9. Security-Critical Checks (Checklist)

Every implementation MUST ensure:

* [ ] Nonce uniqueness per pocket
* [ ] Signature recovery correctness
* [ ] Expiry enforcement
* [ ] Single-use exec guard
* [ ] No approvals from main wallet
* [ ] Fee logic on-chain
* [ ] Relayer never touches assets

---

## 10. Versioning & Upgrade Policy

* Contracts versioned explicitly
* Controller upgradeable only via multisig
* Pocket implementation immutable per version
* Breaking changes require new PocketFactory

---

## 11. Relationship to Other Docs

* `README.md` — product overview
* `PRD.md` — product rules & tiers
* `SECURITY.md` — threat model
* `ARCHITECTURE.md` — flows & boundaries
* `INTERFACES.md` — **this document**

---

## 12. Final Invariant 

> **If an interface allows moving user funds without an explicit rule or user signature, it is a bug.**

---

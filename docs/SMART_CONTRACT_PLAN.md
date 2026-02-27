# Smart Contract Development — Engineering Guidelines (MVP)

## Purpose

This document defines the **non-negotiable engineering rules** for Ward’s smart contracts.

It exists to:

* prevent scope creep
* prevent unsafe abstractions
* ensure isolation remains the primary security primitive

If an implementation violates any principle below, **it is incorrect by definition**.

---

## Guiding Principles (Do Not Violate)

1. **Isolation > features**
2. **No custody in the controller**
3. **All user authority = explicit EIP-712 signatures**
4. **A pocket executes at most once**
5. **Controller enforces fees on-chain**
6. **Relayer is never trusted**
7. **Backend decisions are advisory, never authoritative**

---

## Tech Stack (MVP)

* **Solidity** `^0.8.20`
* **Foundry** (tests, scripts, local iteration)
* **OpenZeppelin** (`ECDSA`, `EIP712`, `IERC20`)
* **No upgradeability in MVP**
* **No proxy patterns**

---

## Repository Structure (Contracts Only)

```text
contracts/
 ├─ src/
 │   ├─ Pocket.sol
 │   ├─ PocketController.sol
 │   └─ PocketFactory.sol
 ├─ test/
 │   ├─ Pocket.t.sol
 │   ├─ PocketController.t.sol
 │   └─ PocketFactory.t.sol
 └─ foundry.toml
```

> Interfaces and shared libraries are intentionally omitted in MVP
> to minimize indirection and reduce audit surface.

---

## Implementation Order (Critical)

Contracts must be implemented and validated in **this exact order**:

1. **Pocket**
2. **PocketController**
3. **PocketFactory**

> If `Pocket` is incorrect, the entire system is unsafe.

---

## 1. `Pocket.sol` — Isolation Primitive

### Purpose

`Pocket` is a **single-use isolation wallet** used to execute exactly one risky action.

It is the **core security boundary** of Ward.

---

### State

```solidity
address public immutable controller;
address public immutable owner;

bool public used;
bool public burned;

mapping(uint256 => bool) public usedNonces;
```

---

### Hard Requirements (Must Hold)

* `exec`:

  * callable **only** by `PocketController`
  * requires valid **EIP-712 user signature**
  * enforces `!used` and `!burned`
  * marks pocket as used
* `sweepERC20`:

  * callable **only** by controller
  * moves assets owned by the pocket
* `burn`:

  * irreversible
  * disables all future execution and sweeping

---

### Explicit Non-Goals

* No approvals
* No batching
* No loops
* No delegation
* No ownership transfer
* No backend trust
* No relayer trust

---

### Execution Model (Conceptual)

```text
User signs intent (EIP-712)
        ↓
Relayer submits tx
        ↓
Controller routes call
        ↓
Pocket verifies signature
        ↓
Pocket executes exactly once
```

Authority exists **only** inside the signed intent.

---

### EIP-712 Scope

Each signature is bound to:

* Pocket address
* Target contract
* Call data hash
* Nonce
* Expiry
* Chain ID

> A signature is invalid outside its exact pocket.

---

## 2. `PocketController.sol` — Policy & Routing Layer

### Purpose

The controller enforces **rules**, not trust.

It coordinates pocket lifecycle, funding, and fee enforcement **without custody**.

---

### Responsibilities

* Deterministic pocket creation (via factory)
* Funding pockets with fixed gas reserve
* Routing execution to valid pockets
* Enforcing sweep fee rules on-chain
* Disabling burned pockets

---

### Controller State

```solidity
address public treasury;
uint256 public constant GAS_RESERVE = 0.005 ether;

mapping(address => bool) public validPocket;
mapping(address => address) public pocketOwner;
```

---

### Fee Policy (MVP, Hard-Coded)

```text
Tier 2 (auto-sweep):        2%
Tier 4 (user-confirmed):   3%
Tier 3 (force withdraw):   8%
```

* Controller **never infers tier**
* Tier is decided off-chain and enforced on-chain
* Relayer cannot alter tier

---

### Sweep Authority

Sweep authority derives from:

* pocket ownership
* tier rules
* on-chain fee enforcement

No additional user signature is required post-execution.

---

### Explicit Non-Goals

* No risk analysis
* No simulation
* No calldata inspection
* No value estimation
* No execution without a valid pocket

---

## 3. `PocketFactory.sol` — Deterministic Deployer

### Purpose

`PocketFactory` deploys pockets using `CREATE2`.

It is intentionally **dumb and powerless**.

---

### Responsibilities

* Deploy `Pocket` contracts deterministically
* Emit deployment events

---

### Explicit Non-Goals

* No custody
* No access control
* No upgrades
* No sweeping
* No authority post-deployment

---

## MVP Features (Strict)

### Must Implement

* Single-use pocket execution
* EIP-712 signature validation
* Lazy pocket creation
* Controller-funded gas reserve
* On-chain fee enforcement
* Pocket burner

---

### Explicitly Out of Scope (MVP)

* Upgradeability
* Social recovery
* NFT handling
* Cross-chain
* Batch execution
* ERC-4337
* Token valuation / USD pricing

---

## Security Posture Summary

* Backend is **untrusted and replaceable**
* Relayer is **untrusted and replaceable**
* Authority is granted **only via explicit user signatures**
* Loss is **strictly bounded** to pocket balance

---

## One-Sentence Summary

> Ward replaces trust in user caution with enforced execution isolation, ensuring that even successful attacks cannot propagate beyond a disposable pocket.

---

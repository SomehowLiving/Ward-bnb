# CONTRACTS.md — Ward Smart Contract Architecture

## Purpose of This Document

This document explains **each on-chain contract in Ward**, including:

* What the contract is responsible for
* What it explicitly does *not* do
* How it interacts with:

  * the **backend**
  * the **relayer**
  * the **user wallet**
* The security guarantees each contract enforces

This is the **authoritative reference** for Ward’s on-chain behavior.

---

## High-Level Architecture Recap

Ward separates concerns strictly:

```
User (EOA)
  │  signs intent (EIP-712)
  ▼
Relayer (gas payer, untrusted)
  │  submits tx
  ▼
PocketController (policy + fees)
  │  routes execution
  ▼
Pocket (single-use isolation wallet)
  │  executes exactly once
  ▼
Untrusted contract / token
```

### Key Invariant

> The user’s main wallet never executes risky logic and never grants approvals.

---

## Contract Overview

| Contract           | Role                            | Custody | Authority   |
| ------------------ | ------------------------------- | ------- | ----------- |
| `Pocket`           | Single-use isolation wallet     | Yes     | Minimal     |
| `PocketController` | Policy, funding, fees, routing  | Limited | Constrained |
| `PocketFactory`    | Deterministic pocket deployment | No      | None        |

---

## 1. `Pocket.sol`

### What It Is

`Pocket` is a **single-use smart wallet** that executes **exactly one risky action** on behalf of a user.

It is the **core security boundary** of Ward.

---

### Responsibilities

* Hold temporary assets (ETH / ERC20)
* Execute **one** authorized call
* Verify **EIP-712 user signatures**
* Enforce:

  * single-use execution
  * nonce replay protection
  * expiry deadlines
* Allow controller-only sweeping
* Allow irreversible burn (toxic asset isolation)

---

### What It Explicitly Does NOT Do

* ❌ No approvals
* ❌ No batching
* ❌ No loops
* ❌ No delegation
* ❌ No ownership transfer
* ❌ No backend trust
* ❌ No relayer trust

---

### Core Functions

#### `exec(...)`

Executes the risky call.

**Checks enforced**

* Caller must be `PocketController`
* Pocket must not be `used` or `burned`
* Signature must be valid (EIP-712)
* Nonce unused
* Signature not expired

**Effects**

* Executes exactly one `target.call(data)`
* Marks pocket as `used`
* Cannot be called again

---

#### `sweepERC20(...)`

Moves ERC-20 tokens out of the pocket.

**Rules**

* Controller-only
* Used during post-execution resolution
* Fees already enforced by controller

---

#### `burn(...)`

Irreversibly disables the pocket.

**Use case**

* Toxic tokens
* Malicious NFTs
* Assets that revert on transfer

**Guarantees**

* Pocket becomes inert
* No future execution or sweep possible
* Loss permanently isolated

> Note: Under modern EVM rules (EIP-6780), code may remain, but behavior is permanently disabled.

---

### Interaction With Backend & Relayer

* **Backend**

  * Builds the execution intent (target, calldata, nonce, expiry)
  * Never signs or submits transactions
* **User**

  * Signs EIP-712 message authorizing exactly one action
* **Relayer**

  * Submits the transaction
  * Pays gas
  * Cannot change parameters or steal assets

---

## 2. `PocketController.sol`

### What It Is

`PocketController` is the **policy enforcement layer**.

It coordinates pocket lifecycle, enforces fee rules, and routes execution — **without custody or discretion**.

---

### Responsibilities

* Lazily create pockets via `PocketFactory`
* Fund pockets with fixed gas reserve
* Track valid pockets and ownership
* Route execution to pockets
* Enforce sweep rules and protocol fees
* Disable pockets after burn

---

### What It Explicitly Does NOT Do

* ❌ Does not decide risk tiers
* ❌ Does not inspect calldata
* ❌ Does not simulate execution
* ❌ Does not hold user tokens long-term
* ❌ Does not sign on behalf of users

All risk logic lives **off-chain**.

---

### Core Functions

#### `createPocket(user, salt)`

Creates and funds a pocket **on demand**.

**Guarantees**

* Pocket is deterministic (CREATE2)
* Pocket is always funded at creation
* Pocket ownership recorded

---

#### `executeFromPocket(...)`

Routes execution to a pocket.

**Guarantees**

* Only valid pockets can execute
* Controller itself cannot change execution parameters
* Pocket enforces signature validity

---

#### `sweep(...)`

Moves assets from pocket to user wallet.

**Enforced on-chain**

* Receiver must be pocket owner
* Fee calculated on-chain
* Fee sent to protocol treasury

> Relayer never touches user assets.

---

#### `burnPocket(...)`

Routes a burn request to a pocket and disables it in controller state.

---

### Interaction With Backend & Relayer

* **Backend**

  * Decides tier (1–4)
  * Decides whether sweep is allowed
  * Informs frontend what action is available
* **Relayer**

  * Calls controller functions
  * Gets reimbursed for gas
  * Has no asset custody
* **User**

  * Only signs intents; never interacts directly with controller

---

## 3. `PocketFactory.sol`

### What It Is

`PocketFactory` is a **dumb CREATE2 deployer**.

It exists purely to make pocket addresses:

* deterministic
* predictable
* cheap

---

### Responsibilities

* Deploy `Pocket` contracts with CREATE2
* Emit deployment events

---

### What It Explicitly Does NOT Do

* ❌ No access control
* ❌ No fund custody
* ❌ No execution authority
* ❌ No upgrades
* ❌ No sweeping

After deployment, the factory has **zero power**.

---

### Core Function

#### `deployPocket(controller, owner, salt)`

Deploys a pocket with:

* fixed controller
* fixed owner
* deterministic address

---

### Interaction With Backend & Relayer

* **Backend**

  * Can precompute pocket addresses
  * Does not interact directly
* **Relayer**

  * Calls factory only via controller
* **Security**

  * Factory compromise is harmless

---

## Backend vs On-Chain Responsibilities (Clear Split)

| Concern                | On-Chain | Backend |
| ---------------------- | -------- | ------- |
| Risk detection         | ❌        | ✅       |
| Simulation             | ❌        | ✅       |
| Tier classification    | ❌        | ✅       |
| Signature verification | ✅        | ❌       |
| Execution isolation    | ✅        | ❌       |
| Fee enforcement        | ✅        | ❌       |
| Gas payment            | ❌        | Relayer |
| Asset custody          | Pocket   | ❌       |

---

## Threat Model & Non-Goals

Ward contracts are designed to defend against:

* Malicious contract execution (approval drainers, honeypots)
* Accidental interaction with scam airdrops
* Replay attacks and signature misuse
* Relayer or backend compromise
* User error during high-risk interactions

Ward contracts do NOT attempt to defend against:

* Price volatility or market risk
* Token value misrepresentation
* Post-sweep token behavior in the main wallet
* Compromised user private keys
* Social engineering outside the transaction itself

Security guarantees apply **only during isolated execution**.
Once assets are swept to the main wallet, normal wallet security assumptions apply.

---

## Contract Invariants

The following invariants must hold at all times:

1. A `Pocket` can execute at most one call.
2. A `Pocket` cannot execute after being burned.
3. A `Pocket` cannot grant approvals.
4. A `Pocket` cannot be reused across signatures.
5. The `PocketController` cannot move assets without explicit rules.
6. Relayers cannot move assets or extract fees.
7. Backends cannot move assets or submit transactions without user signatures.
8. Loss from malicious execution is bounded to the pocket’s balance.

Any change violating these invariants is a **security regression**.

---

## Gas & Cost Model

* Pocket deployment: minimal proxy + CREATE2 (cheap on L2s)
* Pocket execution: one external call + signature verification
* Pocket burn: single transaction, no future cost
* User gas cost: **zero** (relayer-paid)
* Relayer cost: reimbursed via controller logic

Ward is designed for L2s and high-throughput chains where
single-use isolation is economically viable.

---

## Upgrade & Governance Policy

Ward contracts are deployed as **non-upgradeable** in v1.

Reasons:

* Minimize trust assumptions
* Avoid proxy-related attack surface
* Ensure user guarantees are immutable

Future versions may introduce:

* New controllers
* New pocket versions
* Optional opt-in upgrades

Existing pockets and signatures will never be force-migrated.

---

## Backend Contractual Assumptions

The backend is assumed to be:

* Untrusted
* Replaceable
* Non-custodial

The backend:

* Cannot execute transactions
* Cannot move funds
* Cannot forge user signatures
* Cannot bypass on-chain rules

All backend decisions (risk tier, simulation results) are advisory.
Final authority always lies with the user signature and on-chain enforcement.

---

## Security Guarantees (What Cannot Happen)

* Main wallet cannot be drained
* Approvals cannot be escalated
* Signatures cannot be replayed
* Relayer cannot steal funds
* Backend cannot move funds
* Pocket cannot be reused
* Loss cannot exceed pocket cap

---

## Final Summary

> Ward’s contracts enforce **execution isolation by construction**.
> All risky logic is executed inside disposable pockets, while authority, fees, and lifecycle rules are enforced on-chain without trusting the backend or relayer.

> Ward replaces trust in user caution with enforced execution isolation, ensuring that even successful attacks cannot propagate beyond a disposable pocket.

This contract architecture is:

* minimal
* auditable
* non-custodial
* ecosystem-agnostic

---
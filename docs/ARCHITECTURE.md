# ARCHITECTURE.md — Ward

## Purpose of this Document

This document describes **how Ward works end-to-end**, at both:

* **High level** (mental model, components, trust boundaries)
* **Low level** (exact flows, contracts, signatures, and state transitions)

It answers:

* *Who does what?*
* *When does authority move?*
* *Where is risk contained?*
* *What cannot happen by design?*

---

## 1. System Overview (One-Paragraph Summary)

Ward is an execution-isolation layer for EVM wallets.
Risky on-chain interactions are executed inside **single-use smart-wallet pockets** that are created on demand, funded with a capped amount, and authorized via explicit user signatures.

The main wallet never executes risky logic, never grants approvals, and never holds temporary permissions. Loss, if any, is confined to the pocket.

---

## 2. Architectural Mental Model

```
User (EOA)
  │
  │  signs intent (off-chain)
  ▼
Pocket (single-use smart wallet)
  │
  │  executes risky call (on-chain)
  ▼
Untrusted Contract / Token / dApp
```

Key invariant:

> **The main wallet never touches the untrusted world.**

---

## 3. System Components

### 3.1 Frontend (Browser Extension / Web UI)

**Responsibilities**

* Connect user wallet (read-only)
* Intercept user-initiated interactions (claim buttons, calldata) and request backend risk classification
* Display risk classification and explanations
* Request user signatures (EIP-712)
* Display pocket status and outcomes

**Non-Responsibilities**

* Never sends transactions on behalf of user
* Never holds private keys
* Never decides final fund movement

---

### 3.2 Backend Services (Off-Chain)

#### 3.2.1 Risk Engine

* Static contract analysis
* Known scam / blacklist lookup
* Confidence estimation
* Tier classification (1–4)

Outputs are **advisory**, not authoritative.

#### 3.2.2 Simulation Engine

* `eth_call` transfer simulations
* `estimateGas` checks
* Forked-chain DEX sell simulations
* Global caching + rate limiting

Simulations **never move funds**.

---

### 3.3 Relayer

**Responsibilities**

* Accept signed intents
* Verify signatures, nonce, expiry
* Submit transactions
* Pay gas
* Receive gas reimbursement

**Constraints**

* Relayer cannot trigger execution or sweeps without a valid user or policy-authorized signature
* No fee extraction
* Replaceable and non-authoritative

---

### 3.4 Smart Contracts (On-Chain)

#### PocketFactory

* Deterministic pocket deployment (CREATE2)
* No long-term custody
* Minimal persistent state

#### PocketController

* Policy enforcement
* Pocket funding at creation
* On-chain fee calculation
* Sweep execution
* Emergency pause

#### Pocket (Smart Wallet)

* Single-use execution sandbox
* Signature verification
* Strict call scope
* Asset holding + transfer

---

## 4. Trust & Authority Boundaries

| Layer            | Trust Level          | Can move funds?      |
| ---------------- | -------------------- | -------------------- |
| Main Wallet      | Fully trusted        | ❌                    |
| Frontend         | Untrusted            | ❌                    |
| Backend          | Semi-trusted         | ❌                    |
| Relayer          | Minimally trusted    | ❌                    |
| PocketController | Trusted, constrained | ✅ (only via explicit rules or valid user signature)       |
| Pocket           | Trusted, minimal     | ✅ (own balance only) |

---

## 5. High-Level Execution Flow

### Step 0 — Idle State

* No pockets exist
* Controller holds user’s ETH deposit
* No approvals exist anywhere

---

### Step 1 — Risky Interaction Detected

Frontend detects:

* target contract
* calldata
* chain

Sends metadata to backend.

---

### Step 2 — Risk Classification (Off-Chain)

Backend returns:

* tier (1–4)
* explanation
* automation eligibility

No state changes occur.

---

### Step 3 — User Authorization (Critical Boundary)

User signs an **EIP-712 intent** authorizing:

* pocket (to be created)
* target contract
* calldata
* nonce
* expiry

This is:

* off-chain
* gasless
* non-transferable
* non-replayable

This is the **only moment authority is granted**.

---

### Step 4 — Pocket Creation (Lazy)

Relayer calls `PocketController.createPocket(...)`

Controller:

* deploys pocket via CREATE2
* funds pocket with fixed gas reserve
* records pocket ownership

Pocket is now **armed**.

---

### Step 5 — Execution

Relayer calls:

```
PocketController.executeFromPocket(
  pocket,
  target,
  calldata,
  signature
)
```

Controller forwards to pocket.

Pocket:

* verifies signature
* verifies nonce & expiry
* executes exactly one call

---

### Step 6 — Post-Execution Resolution

Three possible outcomes:

1. **Pocket drained** → mark compromised, stop
2. **Token received (unsafe)** → hold, await user decision
3. **Token received (explicitly safe)** → auto-sweep

---

## 6. Low-Level Contract Flow

### 6.1 PocketController.createPocket

**Inputs**

* user address
* nonce / epoch

**Actions**

* deploy pocket via CREATE2
* fund pocket with fixed ETH
* set owner
* emit `PocketCreated`

**Guarantees**

* pocket cannot exist unfunded
* pocket cannot be reused

---

### 6.2 Pocket.exec

**Inputs**

* target
* calldata
* nonce
* expiry
* signature

**Checks**

* signer == owner
* nonce unused
* not expired
* pocket not disabled

**Effects**

* `target.call(calldata)`
* mark pocket as used

No loops. No approvals.

---

### 6.3 PocketController.sweep

**Inputs**

* pocket
* token
* receiver
* signature (if user-triggered)

**Checks**

* tier allows sweep
* signature valid (if required)
* fee rules apply

**Effects**

* fee transferred to treasury
* remainder transferred to receiver

---

## 7. Asset Lifecycle

```
Controller ETH
   │
   ▼
Pocket (funded, capped)
   │
   ├─ drained → lost
   │
   ├─ holds toxic asset → abandoned
   │
   └─ holds safe asset → swept → main wallet
```

No reverse flows.

---

## 8. Pocket State Machine

```
NON-EXISTENT
     │
     ▼
CREATED (funded)
     │
     ▼
EXECUTED
     │
     ├─ COMPROMISED (drained)
     │
     ├─ HOLDING (toxic/unknown)
     │
     └─ SWEPT (safe)
     ▼
DISABLED / DESTROYED
```

Each pocket passes through this exactly once.

---

## 9. Fee & Gas Architecture

* **Fees**: calculated on-chain by controller
* **Treasury**: receives protocol fees
* **Relayer**: reimbursed gas separately
* **User**: never pays gas for risky interactions

Relayer never touches user assets.

---

## 10. Failure Scenarios & Handling

### Backend Failure

* Execution still possible
* User can retry with another relayer

### Relayer Failure

* User resubmits intent
* No loss of funds

### Pocket Compromise

* Loss capped
* Main wallet unaffected

### Controller Emergency

* Pause execution
* No retroactive damage possible

---

## 11. What the Architecture Explicitly Prevents

* Main wallet drains
* Approval escalation
* Permission reuse
* Backend fund theft
* Relayer fee theft
* Silent asset movement

---

## 12. What the Architecture Explicitly Allows

* Bounded loss
* User-accepted risk
* Honest failure
* Transparent containment

---

## 13. Invariants (Must Never Break)

1. Main wallet never executes risky calls
2. Main wallet never grants approvals
3. Pocket executes at most once
4. Asset movement requires explicit rule or signature
5. Relayers never custody funds

Any change violating these is a **security regression**.

---

## 14. Relationship to Other Docs

* `README.md` — what Ward is
* `SECURITY.md` — threat model and guarantees
* `PRD.md` — product rules and tiers
* `ARCHITECTURE.md` — **this document**

---

## 15. One-Sentence Architecture Summary

> Ward replaces trust in user behavior with enforced execution isolation, ensuring that even successful attacks cannot propagate beyond a disposable pocket.

---

# Ward Collateral — Product Requirements Document (PRD)

---

## 1. Product Summary

**Ward Collateral** is a non-custodial smart collateral protocol that protects users from both price risk and execution risk by allocating credit through **isolated, disposable smart-wallet “pockets.”**

Instead of allowing full collateral vaults to interact directly with merchant or DeFi contracts, Ward executes all external interactions inside bounded, single-use execution environments.

Even if a merchant contract is malicious, losses are limited to a predefined exposure pocket — never the vault.

---

## 2. Problem Statement

Web3 credit systems today protect against **price volatility**, but not against **execution risk**.

Users lose funds due to:

* Malicious merchant contracts
* Infinite approval exploits
* Reentrancy attacks
* Contract-level drain logic
* Buggy BNPL integrations
* Flash-loan manipulation attacks

Existing DeFi lending systems are primarily **price-risk aware**, not execution-risk aware.

They assume:

* The protocol interacted with is safe.
* The merchant contract is not malicious.
* Approvals are benign.

This assumption fails frequently.

**Collateral safety is incomplete if execution risk is unbounded.**

---

## 3. Core Insight

> Smart collateral must protect against both price volatility and execution risk.

Ward Collateral introduces:

* Non-custodial vault-backed credit
* Fixed LTV credit allocation
* Transaction-level execution isolation
* Deterministic on-chain default logic

Every external interaction is executed from a disposable pocket funded with capped exposure.

Compromise is contained by architecture.

---

## 4. Goals & Non-Goals

### Product Goals

* Provide non-custodial smart collateral vault
* Enforce programmable LTV-based credit allocation
* Protect vault from malicious merchant interaction
* Provide deterministic on-chain default logic
* Preserve Ward execution isolation primitive
* Remain EVM-compatible

### Non-Goals (v1)

* Dynamic oracle-based pricing
* Advanced credit scoring
* Multi-asset collateral support
* Cross-chain credit
* Complex installment streaming logic
* DAO governance

---

## 5. Target Users

### Primary

* Users seeking BNPL-style crypto credit
* DeFi users borrowing against collateral
* Early adopters of on-chain commerce

### Secondary

* Wallet providers integrating safe credit rails
* Payment protocols integrating non-custodial guarantees

---

## 6. Core Product Concept

### Key Objects

| Object            | Description                                            |
| ----------------- | ------------------------------------------------------ |
| Main Wallet       | User’s EOA. Signs credit and execution intents.        |
| CollateralVault   | Holds long-term collateral and enforces credit policy. |
| Pocket            | Disposable single-use execution sandbox.               |
| PocketFactory     | Deterministic CREATE2 deployment of pockets.           |
| PocketController  | Routes execution and funds gas reserve.                |
| Merchant Contract | External BNPL or commerce contract.                    |
| Relayer           | Submits gas-paid transactions.                         |

---

## 7. High-Level User Flow

### Collateral Setup (One-time)

1. User connects wallet
2. User deposits BNB into CollateralVault
3. Vault computes credit capacity (LTV = 70%)
4. Dashboard shows available credit

---

### Credit Request Flow

1. User selects merchant
2. User requests credit allocation
3. Vault locks exposure amount
4. Vault creates pocket
5. Vault funds pocket with capped exposure
6. User signs execution intent
7. Relayer executes from pocket
8. Merchant receives payment

---

### Post-Execution

* If merchant safe → purchase succeeds
* If merchant malicious → pocket drained only
* Vault remains untouched
* User must repay before due date

---

## 8. Collateral Funding Model

### Design

* User deposits BNB into CollateralVault
* Credit capacity = deposited × 70%
* Credit allocation locks accounting exposure
* Pocket funded only with capped amount
* Vault never approves pocket
* Vault never interacts with merchant

### Parameters (Hackathon)

| Parameter              | Value       | Rationale                 |
| ---------------------- | ----------- | ------------------------- |
| LTV                    | 70%         | Conservative credit model |
| Pocket exposure buffer | 1.2× credit | Execution risk buffer     |
| Default grace          | 0 days      | Deterministic simplicity  |

---

## 9. Trust & Security Model

### Hard Guarantees

* Vault never executes merchant calls
* Vault never grants approvals to merchant
* Pocket cannot access vault
* Single-use enforcement guaranteed
* LTV strictly enforced
* Default logic deterministic

### Explicit Limitations

* Pocket funds can be lost
* Collateral subject to liquidation on default
* No price oracle protection in v1
* No protection after repayment withdrawal

---

## 10. Credit Model (Authoritative Policy)

### Credit Capacity

```
creditCapacity = deposited × LTV
```

### Allocation

* User requests amount ≤ availableCredit
* Vault locks allocation
* Borrowed balance increases

### Repayment

* User repays full amount before dueDate
* Borrowed decreases
* Credit restored

### Default

If:

```
block.timestamp > dueDate
```

Then:

* Allocation seized
* Borrowed reduced
* Credit capacity reduced

No oracle required.
Fully on-chain.

---

## 11. Smart Contract Responsibilities

### CollateralVault

* Accept deposits
* Track deposited & borrowed
* Compute availableCredit
* Create pockets via controller
* Fund exposure
* Track repayment
* Enforce liquidation

### Pocket

* Verify EIP-712 signatures
* Enforce single execution
* Enforce nonce & expiry
* Execute target.call()

### PocketController

* Deploy pockets
* Fund gas reserve
* Route execution
* Enforce isolation
* No long-term user fund custody

---

## 12. Relayer Responsibilities

* Receive signed intent
* Verify format
* Submit executeFromPocket
* Pay gas
* No custody of assets
* No authority over vault

Relayer is replaceable and non-custodial.

---

## 13. UX Principles

* Credit visibility must be clear
* Exposure must be explicitly shown
* Vault balance must never change during merchant execution
* Default logic must be transparent
* Repayment must be simple

No silent asset movement.
No hidden liquidation triggers.

---

## 14. Metrics (Success Criteria)

### Security

* Zero vault drains
* Loss capped to pocket
* LTV enforcement accuracy
* No execution escalation beyond pocket

### Credit Integrity

* Correct borrowed accounting
* Correct default enforcement
* Accurate credit restoration

### UX

* < 2 confirmations per credit request
* 1 signature for execution

---

## 15. Phased Delivery Plan

### Phase 0 — Hackathon MVP

Goal: Prove execution-isolated smart collateral works.

Scope:

* CollateralVault contract
* Existing Ward core
* Good + malicious merchant demo
* Repayment logic
* Liquidation logic
* Fixed LTV

Deliverable:

Live demo:

* Merchant safe → success
* Merchant malicious → pocket drained
* Vault unchanged

---

### Phase 1 — Production MVP

Add:

* Installment support
* Multi-asset collateral
* Adjustable LTV
* Credit scoring modifier
* Price oracle integration
* Auto-burn pocket after repayment

---

### Phase 2 — Advanced Credit Layer

Add:

* Dynamic risk-adjusted LTV
* Merchant risk scoring
* Automated liquidation bots
* EIP-4337 paymaster integration
* SDK for wallet integration

---

### Phase 3 — Ecosystem Expansion

Add:

* Cross-chain vaults
* Relayer marketplace
* Credit NFT representation
* Institutional integrations

---

## 16. Explicit Out-of-Scope

* Perfect scam detection
* Automated trading
* DAO governance
* Token price guarantees
* Cross-chain liquidation
* Credit insurance markets
* Custodial asset holding

---

## 17. One-Sentence Product Definition

> Ward Collateral is a non-custodial smart collateral protocol that allocates credit through isolated execution pockets, protecting users from both price risk and execution risk by design.

---

## 18. Engineering Order

1. CollateralVault contract
2. Integrate with existing PocketController
3. Implement repayment + liquidation
4. Write malicious merchant test
5. Validate isolation invariants
6. Build demo UI

---

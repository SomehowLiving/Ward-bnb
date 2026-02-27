
# WARD COLLATERAL — ARCHITECTURE UPDATE

## 1. Overview

Ward originally functioned as an **execution isolation engine**, preventing catastrophic wallet drains by routing risky interactions through disposable single-use pockets.

For the Smart Collateral / Web3 Credit track, Ward has been extended into:

> **Ward Collateral — A Non-Custodial Smart Collateral Vault with Execution Isolation**

The system now consists of:

* **CollateralVault (new layer)**
* **Ward Core (unchanged)**

  * Pocket
  * PocketFactory
  * PocketController
* **Merchant Contracts (demo layer)**

We do NOT modify:

* Pocket execution logic
* EIP-712 signature scheme
* Single-use enforcement
* Burn logic
* Isolation guarantees

Ward remains the isolation primitive.
CollateralVault becomes the credit allocation layer.

---

# 2. System Components

## 2.1 CollateralVault (New)

Purpose:

* Holds long-term user collateral
* Computes credit capacity
* Allocates exposure to pockets
* Tracks repayment
* Enforces default logic

It does NOT:

* Interact directly with merchants
* Grant approvals to external contracts
* Expose vault funds to execution layer

---

## 2.2 Ward Pocket (Unchanged)

Single-use disposable smart wallet.

Properties:

* EIP-712 signed execution
* One-time execution
* No inherited approvals
* Cannot access vault
* Self-destructible

Acts as:

> Disposable execution sandbox

---

## 2.3 PocketController (Unchanged)

Responsibilities:

* Deploy pockets
* Route execution
* Manage gas reserve
* Sweep tokens
* Burn pockets

In the new model:
CollateralVault calls PocketController to create pockets.

---

## 2.4 Merchant Contracts (Demo)

1. MerchantGood — legitimate payable purchase
2. MerchantMalicious — attempts to drain pocket

Used to demonstrate:

* Successful execution
* Isolation under attack

---

# 3. High-Level Architecture

```
User
  ↓ deposit
CollateralVault
  ↓ allocate credit
Pocket (single-use)
  ↓ execute
Merchant (trusted or malicious)
```

Trust boundary:

```
User Trust Zone
 ├─ CollateralVault (holds funds)
 └─ Pocket (limited exposure)

Untrusted Zone
 └─ Merchant Contracts
```

Critical property:

> Merchant never interacts with CollateralVault directly.

---

# 4. Core Credit Model

## 4.1 Collateral Deposit

User deposits BNB into Vault:

```
deposit(10 BNB)
```

Vault state:

```
deposited[user] = 10
borrowed[user] = 0
```

---

## 4.2 Credit Capacity Calculation

LTV is fixed at 70%.

```
creditCapacity = deposited × 70%
```

Example:

```
10 BNB × 0.7 = 7 BNB
```

User can borrow up to 7 BNB.

No credit scoring required for hackathon.

---

# 5. Credit Allocation Flow

## Step 1 — User Requests BNPL

```
requestCredit(merchant, 1 BNB, 30 days)
```

Vault checks:

```
availableCredit >= amount
```

---

## Step 2 — Lock Allocation

Vault updates:

```
borrowed[user] += 1
availableCredit = 6
```

---

## Step 3 — Create Pocket

Vault calls:

```
PocketController.createPocket(user, salt)
```

Controller:

* Deploys pocket
* Funds gas reserve

Vault:

* Transfers 1.2 BNB into pocket (credit + buffer)

Important:

> Vault never gives pocket permission to pull funds.
> Only prefunded balance exists.

---

# 6. Execution Phase

User signs EIP-712 intent.

Relayer calls:

```
executeFromPocket(...)
```

Two scenarios:

---

## Case A — Legit Merchant

Pocket sends 1 BNB to merchant.

Remaining:
0.2 BNB in pocket.

Merchant emits event.

Purchase successful.

---

## Case B — Malicious Merchant

Merchant attempts:

* Drain balance
* Reentrancy
* Infinite call

Worst case:
Pocket loses full 1.2 BNB.

Vault remains:
10 BNB intact.

Execution risk contained.

---

# 7. Repayment Flow

User repays:

```
repay(requestId)
```

Vault:

```
require(msg.value == amount)
mark repaid = true
borrowed[user] -= amount
```

Credit restored.

Pocket can be burned.

---

# 8. Default Flow

If:

```
block.timestamp > dueDate
```

Vault triggers:

```
liquidate(requestId)
```

Effects:

* Mark repaid = true
* borrowed reduced
* Locked allocation remains seized

No oracle required.
Fully on-chain.
Track compliant.

---

# 9. Security Properties

| Risk               | Traditional BNPL | Ward Collateral |
| ------------------ | ---------------- | --------------- |
| Price volatility   | Protected        | Protected       |
| Malicious merchant | Full vault risk  | Pocket only     |
| Infinite approval  | Vulnerable       | Single-use      |
| Reentrancy cascade | Possible         | Isolated        |
| User mistake       | Catastrophic     | Capped          |

Ward adds:

> Execution-risk protection to smart collateral.

---

# 10. What Changed From Original Ward

Original Ward:

* User-funded pockets
* Isolated execution

Ward Collateral:

* Vault-funded pockets
* Credit-backed execution
* Default enforcement
* LTV-based allocation

Isolation primitive unchanged.
Funding source changed.
Policy layer added.

---

# 11. Final Demo Flow (For Judges)

### Demo Scenario 1 — Safe Merchant

1. User deposits 10 BNB.
2. Vault shows 7 BNB available credit.
3. User requests 1 BNB BNPL.
4. Vault creates pocket.
5. Pocket executes purchase.
6. Merchant receives funds.
7. User repays.
8. Credit restored.

---

### Demo Scenario 2 — Malicious Merchant

1. Same deposit.
2. User requests 1 BNB.
3. Pocket created + funded.
4. Merchant tries draining.
5. Pocket drained.
6. Vault still holds 10 BNB.
7. Loss capped.
8. Default logic demonstrated.

---

# 12. Why This Satisfies Track

✔ Non-custodial vault
✔ Programmable credit allocation
✔ On-chain default logic
✔ Verifiable collateral backing
✔ No centralized custody
✔ Scalable Web3 credit
✔ Execution risk protection (innovation layer)

---

# 13. Clear One-Line Positioning

> Ward Collateral is a non-custodial smart collateral vault that allocates credit through isolated execution pockets, protecting users from both price risk and execution risk.

---

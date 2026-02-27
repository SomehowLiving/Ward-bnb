# WARD COLLATERAL — FLOW

---

# 🧱 SYSTEM COMPONENTS

### 1️⃣ CollateralVault

Non-custodial smart collateral vault.
Responsibilities:

* Accept BNB deposits
* Calculate credit capacity (fixed 70% LTV)
* Lock credit allocation
* Create and fund Ward pockets
* Track repayment
* Enforce on-chain default logic

Vault never directly interacts with merchants.

---

### 2️⃣ Ward Pocket (Unchanged Core)

Single-use execution sandbox.

Properties:

* EIP-712 signed execution
* One-time call
* No inherited approvals
* No access to vault
* Burnable

Acts as isolated execution boundary.

---

### 3️⃣ Merchant Contracts (Demo)

* **MerchantGood** — legitimate payable contract
* **MerchantMalicious** — attempts to drain pocket

Used to demonstrate execution isolation.

---

# 🔁 FULL END-TO-END FLOW

---

# PHASE 1 — User Funds Smart Collateral Vault

### Step 1: Deposit

User deposits 10 BNB:

```
deposit{value: 10 BNB}()
```

Vault state:

```
deposited[user] = 10
borrowed[user] = 0
```

Funds are stored inside Vault.

User retains custody via smart contract (non-custodial).

---

### Step 2: Credit Capacity Calculation

Vault computes:

```
LTV = 70%
creditCapacity = deposited × 0.7
```

Example:

```
10 × 0.7 = 7 BNB
availableCredit = 7
```

No funds moved.
This is purely policy calculation.

---

# PHASE 2 — User Initiates BNPL Purchase

User wants to purchase something worth 1 BNB.

---

### Step 3: Request Credit

User calls:

```
requestCredit(merchant, 1 BNB, duration=30 days)
```

Vault checks:

```
availableCredit >= 1 BNB
```

If true:

* Allocation approved

---

### Step 4: Lock Credit Allocation

Vault updates:

```
borrowed[user] += 1
availableCredit = 6
```

Important clarification:

Vault does NOT move the full 1 BNB out of vault.
It only:

* Marks it as locked exposure
* Funds pocket separately

Vault still holds 10 BNB physically.

---

### Step 5: Create & Fund Execution Pocket

Vault calls:

```
PocketController.createPocket(user, salt)
```

Controller:

* Deploys pocket
* Funds gas reserve

Vault then transfers exposure buffer:

Example:

```
pocketExposure = 1.2 BNB
```

Pocket now holds 1.2 BNB.

Vault still holds 10 BNB total.

But:
1 BNB is marked as locked credit exposure.

Critical property:

> Pocket has ZERO access to vault funds.
> Vault never approves pocket.

Isolation preserved.

---

# PHASE 3 — Merchant Interaction

---

### Step 6: Execute Payment via Pocket

User signs EIP-712 intent:

```
"Execute call to MerchantXYZ"
```

Relayer calls:

```
executeFromPocket(...)
```

Execution happens inside pocket.

---

## Case A — Legit Merchant

Merchant receives 1 BNB.

Pocket retains 0.2 BNB buffer.

Transaction successful.

Vault unchanged.

---

## Case B — Malicious Merchant

Merchant attempts:

* Drain entire balance
* Reentrancy
* Low-level exploit
* Infinite approval abuse

Worst-case outcome:

Pocket loses full 1.2 BNB.

Vault remains:

10 BNB untouched.

Loss capped to exposure buffer.

This demonstrates execution isolation.

---

# PHASE 4 — Repayment Logic

After purchase, credit repayment period begins.

Example:
30-day credit.

---

### Step 7: Repayment

User repays:

```
repay{value: 1 BNB}()
```

Vault updates:

```
repaid = true
borrowed[user] -= 1
availableCredit recalculated
```

Credit restored.

Pocket can be burned.

---

# PHASE 5 — Default Scenario

If user does not repay:

Vault checks:

```
block.timestamp > dueDate
```

If true:

```
liquidate(requestId)
```

Effects:

* borrowed reduced
* locked exposure seized
* credit capacity reduced

Vault retains collateral.
User loses locked portion only.

No oracle required.
Fully on-chain default logic.

Track compliant.

---

# WHAT CHANGED FROM ORIGINAL WARD

Original Ward:

* User-funded pockets
* Isolation for scam protection

Ward Collateral:

* Vault-funded pockets
* Credit-backed allocation
* Default enforcement
* LTV-based policy layer

Core isolation unchanged.

Funding and credit policy added.

---

# SECURITY MODEL

| Risk               | Traditional Smart Collateral | Ward Collateral |
| ------------------ | ---------------------------- | --------------- |
| Price volatility   | Protected                    | Protected       |
| Malicious merchant | Vault exposed                | Pocket only     |
| Infinite approvals | Risky                        | Single-use      |
| Reentrancy cascade | Possible                     | Isolated        |
| Execution bug      | System-wide risk             | Localized       |
| User mistake       | Catastrophic                 | Capped          |

Ward adds:

> Execution-risk protection to collateral-backed credit.

---

# FINAL CLEAN NARRATIVE

1. User deposits collateral into non-custodial vault.
2. Vault computes credit capacity via fixed LTV.
3. User requests credit allocation.
4. Vault locks allocation and creates disposable execution pocket.
5. Merchant interaction occurs inside isolated pocket.
6. If merchant malicious → only pocket drained.
7. If repaid → credit restored.
8. If default → locked allocation seized.

This satisfies:

* Non-custodial
* Programmable vault
* On-chain default logic
* Verifiable collateral backing
* Trust-minimized credit
* Execution isolation innovation

---

# Important Correction You Must Remember

Pocket does NOT “have credit”.

Vault has credit policy.
Pocket only has funded exposure.

---


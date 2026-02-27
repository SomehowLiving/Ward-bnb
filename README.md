
# 🛡 Ward Collateral

**Ward Collateral** is a non-custodial smart collateral protocol that enables Web3 credit and BNPL while protecting users from catastrophic execution risk.

Traditional smart collateral systems protect against price volatility.
Ward extends this by introducing **execution isolation**, ensuring that even if a merchant or protocol is malicious, collateral loss is strictly capped by design.

---

## 🎯 The Problem

Crypto BNPL and Web3 credit systems today suffer from structural weaknesses:

### ❌ Centralized Custody

Users must trust platforms holding their assets.

### ❌ Opaque Liquidity

Off-chain underwriting and unclear guarantees.

### ❌ Execution Risk (Unsolved)

If a merchant contract is malicious or buggy, a user’s entire collateral vault can be exposed.

Current smart collateral protects against **price drops**, not **malicious execution**.

As Web3 credit scales, execution risk becomes systemic risk.

---

## 💡 Our Solution

Ward introduces **Execution-Isolated Smart Collateral**.

Instead of allowing the full collateral vault to interact with external contracts:

1. Users lock assets into a programmable on-chain vault.
2. The vault calculates available credit (LTV-based).
3. When credit is requested, the vault creates a **disposable smart-wallet pocket**.
4. Only the allocated credit amount is exposed.
5. The pocket executes exactly one transaction.
6. If compromised, only the pocket is affected — never the vault.

Collateral remains protected by design.

---

# 🏗 Architecture

```text
User
  ↓ deposit
CollateralVault (non-custodial)
  ↓ allocate credit
Ward Pocket (single-use isolation)
  ↓ execute
Merchant (trusted or malicious)
```

---

## 🔐 Core Components

### 1️⃣ CollateralVault

* Stores user deposits (BNB / ERC20)
* Calculates credit capacity (e.g., 70% LTV)
* Locks collateral when credit is issued
* Enforces repayment deadlines
* Handles default liquidation on-chain

---

### 2️⃣ Ward Pocket (Isolation Primitive)

* Disposable smart contract wallet
* Single-use execution
* EIP-712 signature-bound calls
* No approval inheritance
* Self-destructs after execution

---

### 3️⃣ Merchant Contracts (Demo)

* `MerchantGood.sol` – Legitimate payment flow
* `MerchantMalicious.sol` – Attempts to drain funds

Used to demonstrate containment.

---

# 🔁 How It Works

## Step 1 — Deposit Collateral

User deposits BNB into `CollateralVault`.

Vault computes:

```text
creditCapacity = collateral × LTV
```

Example:
Deposit 10 BNB → 70% LTV → 7 BNB credit capacity.

---

## Step 2 — Request BNPL Credit

User requests 1 BNB credit to pay a merchant.

Vault:

* Checks available credit
* Locks 1 BNB allocation
* Deploys disposable pocket
* Funds pocket with 1 BNB

---

## Step 3 — Execute Payment via Pocket

The pocket executes the merchant call.

### Case A — Legit Merchant

Payment succeeds.

### Case B — Malicious Merchant

Merchant attempts drain.

Result:
Only pocket funds are affected.
Vault collateral remains untouched.

---

## Step 4 — Repayment or Default

### If User Repays:

* Borrowed amount is cleared.
* Credit capacity restored.

### If User Defaults:

* Locked collateral portion is seized.
* Default logic is enforced entirely on-chain.

```solidity
if (block.timestamp > dueDate && !repaid) {
    seizeCollateral();
}
```

No centralized intervention required.

---

# 🔒 Security Innovation

| Risk Type              | Traditional Smart Collateral | Ward Collateral |
| ---------------------- | ---------------------------- | --------------- |
| Price Volatility       | ✔                            | ✔               |
| Malicious Merchant     | ❌                            | ✔               |
| Infinite Approval      | ❌                            | ✔               |
| Execution-Level Attack | ❌                            | ✔               |
| Vault Drain Cascade    | ❌                            | ✔               |

Ward protects against both **price risk** and **execution risk**.

---

# 📜 Track Alignment (BNB Hack — Smart Collateral)

We satisfy all challenge requirements:

✔ Non-custodial smart collateral
✔ Programmable vault logic
✔ Verifiable credit guarantees
✔ Clear on-chain default enforcement
✔ Shared trust-minimized collateral layer
✔ No surrender of asset custody

Ward extends traditional collateral with execution isolation — enabling safer Web3 credit.

---

# 🛠 Tech Stack

* Solidity 0.8.x
* BNB Chain / opBNB
* Ward execution isolation primitive
* EIP-712 signatures
* OpenZeppelin contracts

---

# 🎬 Demo Scenario

### Scenario 1 — Legitimate Merchant

1. Deposit 10 BNB.
2. Request 1 BNB credit.
3. Pocket executes payment.
4. Repay successfully.
5. Credit restored.

---

### Scenario 2 — Malicious Merchant

1. Deposit 10 BNB.
2. Request 1 BNB credit.
3. Pocket executes malicious contract.
4. Pocket drained.
5. Vault still holds full collateral.
6. Exposure capped.

This proves execution isolation within a smart collateral system.

---

# 🧩 Future Roadmap

* Dynamic LTV via oracle feeds
* On-chain credit scoring
* Merchant risk profiles
* Multi-asset collateral (ERC20, NFTs)
* Cross-chain credit routing

---

# 🏁 Conclusion

Ward Collateral upgrades smart collateral from price-only protection to execution-safe credit infrastructure.

We don’t assume contracts are safe.
We design systems where failure is bounded.

> **Ward makes Web3 credit safe enough for mainstream adoption.**

---
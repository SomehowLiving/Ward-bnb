the **complete end-to-end BNPL flow** with:

* What the user signs
* What frontend does
* What backend does
* What contracts enforce
* Where isolation happens
* Where BNPL accounting happens

No abstraction. Real execution path.

---

# 🧱 System Layers

**On-chain**

* `CollateralVault` → credit authority
* `PocketController` → execution router
* `Pocket` → isolated single-use wallet

**Off-chain**

* Frontend → builds transactions + signatures
* Backend → relays `executeFromPocket` only

Backend is NOT credit authority.
Vault is.

---

# 🔁 COMPLETE USER FLOW (BNPL)

---

# 0️⃣ Setup

User connects wallet (MetaMask).

Frontend:

* Reads `availableCredit(user)`
* Displays deposit / credit state
* Reads `merchantBlocked(merchant)`
* Reads `merchantFlagCount(merchant)`

No backend required.

---

# 1️⃣ Deposit Collateral

User clicks “Deposit”.

Frontend:

```ts
vault.deposit({ value: amount })
```

User signs transaction.

On-chain:

* `positions[user].deposited += msg.value`

Backend: ❌ not involved.

---

# 2️⃣ Request BNPL Credit

User inputs:

* Amount (e.g. 1 BNB)
* Installment count (e.g. 4)
* Interval (e.g. 7 days)

Frontend validates:

* merchant not blocked
* availableCredit >= amount

Frontend calls:

```ts
vault.requestCredit(
    merchant,
    amount,
    installmentCount,
    interval,
    salt
)
```

User signs transaction.

---

### What Happens On-Chain

Vault:

1. Checks merchant not blocked
2. Checks LTV
3. `positions[user].borrowed += principal`
4. Calls `PocketController.createPocket`
5. Funds pocket with principal
6. Stores BNPL struct
7. Emits `CreditRequested`

---

Frontend receives:

* requestId
* pocket address

Backend: ❌ not involved.

---

# 🔐 Isolation Boundary Starts Here

Loan created.
Pocket funded.
Merchant NOT yet called.

---

# 3️⃣ Purchase Execution (Isolation Layer)

User now clicks “Execute Purchase”.

Frontend builds EIP-712 signature:

```
Exec(
  pocket,
  target = merchant,
  dataHash,
  nonce,
  expiry
)
```

User signs OFF-CHAIN message.

⚠️ This is NOT a transaction.

---

Frontend sends to backend:

```json
{
  pocket,
  target,
  data,
  nonce,
  expiry,
  signature
}
```

---

Backend:

Calls:

```solidity
PocketController.executeFromPocket(
    pocket,
    target,
    data,
    nonce,
    expiry,
    signature
)
```

Backend pays gas.

---

On-chain:

Controller:

* Verifies pocket is valid
* Calls `Pocket.exec(...)`

Pocket:

* Verifies EIP712 signature
* Verifies nonce
* Executes merchant call
* Marks itself used

---

# 💥 If Merchant Is Malicious

Only pocket funds can be drained.

Vault:

* untouched
* collateral untouched
* other pockets untouched

Isolation works.

---

# 4️⃣ Installment Repayment

User checks loan state:

Frontend calls:

```ts
vault.creditPositions(requestId)
```

Gets:

* remaining
* installmentAmount
* installmentsPaid
* nextDueDate
* closed
* defaulted

Frontend computes:

```ts
if (installmentsPaid + 1 === totalInstallments)
    due = remaining
else
    due = installmentAmount
```

---

User clicks “Repay Installment”.

Frontend calls:

```ts
vault.repayInstallment(requestId, { value: due })
```

User signs transaction.

Backend: ❌ not involved.

---

On-chain:

Vault:

* checks not defaulted
* checks not closed
* checks timestamp <= nextDueDate
* checks correct amount
* updates remaining
* increments installmentsPaid
* increments nextDueDate

If remaining == 0:

* closed = true
* borrowed -= principal

---

# 5️⃣ Default Scenario

If:

```
block.timestamp > nextDueDate
```

Then:

Anyone can call:

```solidity
vault.liquidate(requestId)
```

On-chain:

* defaulted = true
* borrowed -= principal

Collateral remains in vault (implicit penalty via reduced credit capacity).

---

# 🔍 What Backend Actually Does

Backend ONLY handles:

```
executeFromPocket(...)
```

That’s it.

Backend does NOT:

* Track credit
* Track installments
* Modify debt
* Approve loans
* Calculate LTV
* Touch collateral

Backend is gas relay for isolated execution.

---

# ✍️ Signing Breakdown

| Step          | Who Signs | What                | Type                |
| ------------- | --------- | ------------------- | ------------------- |
| Deposit       | User      | deposit()           | On-chain tx         |
| RequestCredit | User      | requestCredit()     | On-chain tx         |
| Purchase      | User      | EIP712 Exec         | Off-chain signature |
| Execute       | Backend   | executeFromPocket() | On-chain tx         |
| Repay         | User      | repayInstallment()  | On-chain tx         |
| Liquidate     | Anyone    | liquidate()         | On-chain tx         |

Only one off-chain signature exists:
→ Pocket execution intent.

Everything else is normal wallet transactions.

---

# 🧠 Where Each Responsibility Lives

## Credit Authority

CollateralVault

## Execution Isolation

Pocket

## Gas Sponsorship

Backend

## UI State

Frontend

## Risk Signaling

merchantFlagCount + merchantBlocked

---

# 🔒 Security Model Summary

* Vault never calls merchant
* Pocket is single-use
* Borrowed not reduced per installment
* No credit recycling mid-loan
* Merchant block enforced on-chain
* Backend cannot steal funds
* Backend cannot modify debt
* Backend cannot bypass isolation

---

# 📌 Final Simplified Flow

User → Deposit
User → Request BNPL
Vault → Create + Fund Pocket
User → Sign Exec
Backend → Relay Exec
Pocket → Execute Merchant
User → Repay Installments
Vault → Close or Liquidate

---


## API:
I’ll structure this in 3 layers:

1. Execution relay (required)
2. Credit read helpers (optional but good UX)
3. Merchant reputation
4. Good UI helper endpoints

No overengineering.

---

# 🔐 1️⃣ Execution Relay (Required)

This is the only critical backend write endpoint.

## POST `/api/pocket/execute`

Relays isolated execution.

### Body

```json
{
  "pocket": "0x...",
  "target": "0xMerchant",
  "data": "0xCalldata",
  "nonce": 1,
  "expiry": 1735603200,
  "signature": "0xUserSignature"
}
```

### Backend does

* Basic validation
* Calls:

```solidity
PocketController.executeFromPocket(...)
```

* Pays gas

### Returns

```json
{
  "txHash": "0x..."
}
```

This endpoint is mandatory.

---
Backend indexes CreditRequested events and exposes:

GET /api/credit/loans/:user

That returns all requestIds for that borrower.

# 💳 2️⃣ Credit (BNPL) APIs

You can call vault directly from frontend, but these read APIs improve UX.

---

## GET `/api/credit/state/:user`

Reads:

* `positions(user)`
* `availableCredit(user)`

### Returns

```json
{
  "user": "0x...",
  "deposited": "5000000000000000000",
  "borrowed": "1000000000000000000",
  "availableCredit": "2500000000000000000"
}
```

Good for dashboard.

---

## GET `/api/credit/loan/:requestId`

Reads:

* `creditPositions(requestId)`
* `creditBorrower(requestId)`

### Returns

```json
{
  "requestId": "0x...",
  "borrower": "0x...",
  "principal": "1000000000000000000",
  "remaining": "750000000000000000",
  "installmentAmount": "250000000000000000",
  "installmentsPaid": 1,
  "totalInstallments": 4,
  "interval": 604800,
  "nextDueDate": 1735603200,
  "defaulted": false,
  "closed": false,
  "pocket": "0x..."
}
```

This powers BNPL loan screen.

---

## GET `/api/credit/loans/:user` (Optional but Excellent for UI)

Backend scans `CreditRequested` events by borrower.

Returns array of active + closed loans.

This prevents frontend from tracking requestIds manually.

Very useful for UI.

---

# 🏪 3️⃣ Merchant Reputation APIs

These are clean and useful.

---

## GET `/api/merchant/:address`

Reads:

* `merchantFlagCount`
* `merchantBlocked`

Returns:

```json
{
  "merchant": "0x...",
  "flagCount": "5",
  "blocked": false
}
```

Frontend:

* Show warning badge
* Disable buy button if blocked

---

## POST `/api/merchant/block` (Owner only)

```json
{
  "merchant": "0x..."
}
```

Backend verifies:

* backend signer == vault.owner()

Calls:

```solidity
blockMerchant(merchant)
```

---

## POST `/api/merchant/unblock`

Same pattern.

---

# 📊 4️⃣ Good UI Helper APIs

These are not required, but improve UX significantly.

---

## GET `/api/pocket/nonce/:pocket`

Returns next nonce from pocket.

Prevents failed exec attempts.

---

## GET `/api/pocket/valid/:address`

Returns:

```json
{
  "valid": true,
  "owner": "0x..."
}
```

Good for debugging and UI safety.

---

## GET `/api/health`

Simple:

```json
{
  "chainId": 97,
  "vault": "0x...",
  "controller": "0x...",
  "status": "ok"
}
```

Very helpful during demo.

---
So frontend must:

Detect overdue

Show “Defaulted” or “Liquidatable”

Not show repay button


So frontend must:

Detect overdue

Show “Defaulted” or “Liquidatable”

Not show repay button



# 🎯 5️⃣ Frontend Direct Calls (No Backend Needed)

These should NOT go through backend:

* `deposit()`
* `requestCredit()`
* `repayInstallment()`
* `liquidate()`
* `flagMerchant()`

These are user-signed transactions.

Backend should not relay these unless you intentionally want gasless UX.

Keep it simple:
User signs them directly.

---

# 🧠 Final Clean API Surface

Minimal Required:

* POST `/api/pocket/execute`
* GET `/api/credit/state/:user`
* GET `/api/credit/loan/:requestId`
* GET `/api/merchant/:address`

Nice-to-have:

* GET `/api/credit/loans/:user`
* GET `/api/pocket/nonce/:pocket`
* GET `/api/health`

That’s it.

No scoring API.
No LTV API.
No approval API.
No analytics API.

---

# 🧱 Architecture After This

Vault → credit authority
Pocket → isolation
Backend → execution relay
Frontend → state + transaction initiator


---

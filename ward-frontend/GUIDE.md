# WARD

**wallet-connected dApp** with Pocket as a safety layer in front of the user’s main wallet.

---

## 1. Wallet Connect → Dashboard

**Goal:** Show user state immediately.

**UI actions**

* User connects wallet
* Load pockets
* Show metrics per pocket

**APIs**

1. `GET /api/pockets/:userAddress`
2. (optional) `GET /api/history/:userAddress`

**UI shows**

* List of pockets
* Status: active / used / burned
* CTA: **Create Pocket** / **Use Pocket**

---

## 2. Create Pocket Flow

**Goal:** One-click safety vault creation.

**UI**

* Button: **Create Pocket**
* Optional advanced: deterministic salt

**APIs**

1. `POST /api/pocket/create`

**Result**

* Pocket address returned
* UI navigates to pocket detail page

**UX note**

* No signature needed (controller signer pays gas)
* Treat as near-instant onboarding

---

## 3. Pocket Detail Page

**Goal:** Single source of truth for a pocket.

**APIs**

1. `GET /api/pocket/:address`
2. `GET /api/controller/pocket/:address`

**UI shows**

* Pocket address
* Owner
* Status: unused / used / burned
* Allowed actions:

  * Execute transaction
  * Sweep funds
  * Burn pocket

---

## 4. “Execute Transaction” Flow (Core Path)

This is the most important UX path.

### Step 4.1 — User Inputs Action

**UI**

* Target contract address
* Action (approve / transfer / custom)
* Amount / params

---

### Step 4.2 — Decode & Explain

**Goal:** User understands what they’re signing.

**APIs**

1. `POST /api/calldata/decode`
2. `GET /api/token/:address` (if ERC-20)

**UI shows**

* “This will approve 1,000 USDC to Uniswap”
* Confidence indicator

---

### Step 4.3 — Risk Check

**Goal:** Prevent obvious foot-guns.

**APIs**

1. `POST /api/risk/classify`
2. `POST /api/risk/simulate`

**UI**

* Risk badge:

  * 🟢 Safe
  * 🟡 Unknown
  * 🔴 Dangerous
* Hard block or warning if tier ≥ 3

---

### Step 4.4 — Pre-flight Validation

**Goal:** Ensure execution will succeed.

**APIs**

1. `POST /api/pocket/simulate`
2. `POST /api/pocket/gas`

**UI**

* Gas estimate
* “This transaction will succeed” checkmark

---

### Step 4.5 — User Signs Intent

**Client-side**

* Build EIP-712 payload
* User signs with wallet

**Backend validation**

1. `POST /api/verify/exec-intent`

---

### Step 4.6 — Execute

**APIs**

1. `POST /api/pocket/exec`

   * or `POST /api/relay/pocket-exec`

**UI**

* Tx submitted
* Show tx hash
* Mark pocket as **used**

---

## 5. Sweep Funds Flow (Emergency / Cleanup)

**Goal:** Extract funds safely.

**UI**

* Select token
* Enter amount
* Receiver address

**APIs**

1. `POST /api/pocket/fee`
2. `POST /api/pocket/sweep`

**UI**

* Fee breakdown
* Net amount
* Execute sweep

---

## 6. Burn Pocket Flow

**Goal:** Permanently disable pocket.

**UI**

* “Burn Pocket” button
* Confirmation modal

**APIs**

1. `POST /api/pocket/burn`

**UI**

* Pocket marked as burned
* No further actions allowed

---

## 7. Global Monitoring / Analytics (Passive)

**APIs**

* `GET /api/metrics`
* `GET /api/history/:userAddress`

**UI**

* Total pockets created
* Total value protected
* Incident history (future)

---

## Mental Model for Users (Critical)

> **“I never interact directly with risky contracts.
> I create a Pocket, simulate everything, sign intent, and the Pocket executes once.”**

That model matches your backend perfectly.

---

## Suggested UI Sections

* **Dashboard**
* **Pocket Detail**
* **Execute (Wizard)**
* **Sweep**
* **Settings / Advanced**
* **Security History**

---

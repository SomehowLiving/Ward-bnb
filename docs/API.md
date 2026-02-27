# Ward — Required APIs

## High-level API categories

1. **User & Wallet APIs** (identity, state)
2. **Pocket Lifecycle APIs**
3. **Risk & Classification APIs**
4. **Simulation APIs**
5. **Execution & Relayer APIs**
6. **Sweep / Withdraw APIs**
7. **Telemetry & Safety APIs**
8. **Admin / Governance APIs (later)**

---

## 1. User & Wallet APIs

### 1.1 Get User State

**Purpose:** Populate dashboard, determine readiness

**Endpoint**

```
GET /api/user/state
```

**Returns**

```json
{
  "wallet": "0xUSER",
  "controllerBalanceEth": "0.034",
  "activePockets": 1,
  "abandonedPockets": 3,
  "canCreatePocket": true
}
```

**Used by**

* Frontend on load
* Before every claim

**Phase**

* ✅ MVP

---

### 1.2 Top-up Requirement Check

**Purpose:** Prevent execution when controller is underfunded

```
GET /api/user/topup-required
```

```json
{
  "required": true,
  "minEth": "0.01",
  "reason": "controller_balance_low"
}
```

**Phase**

* ✅ MVP

---

## 2. Pocket Lifecycle APIs

### 2.1 Create Pocket (Lazy)

**Purpose:** Create a pocket only when needed

```
POST /api/pocket/create
```

**Input**

```json
{
  "chainId": 1
}
```

**Returns**

```json
{
  "pocketAddress": "0xPOCKET",
  "fundedEth": "0.005",
  "maxValueEth": "0.05"
}
```

**Backend does**

* Calls PocketFactory via relayer
* Funds pocket from controller

**Phase**

* ✅ MVP

---

### 2.2 Get Pocket Details

```
GET /api/pocket/{pocketAddress}
```

```json
{
  "status": "ACTIVE | USED | ABANDONED",
  "createdAt": 1710000000,
  "txHash": "0x..."
}
```

**Phase**

* ✅ MVP

---

## 3. Risk & Classification APIs

### 3.1 Analyze Target Contract

**Purpose:** First-pass risk analysis before any execution

```
POST /api/risk/analyze
```

**Input**

```json
{
  "chainId": 1,
  "target": "0xCONTRACT",
  "calldata": "0x..."
}
```

**Returns**

```json
{
  "tier": 3,
  "confidence": 42,
  "signals": [
    "unverified_code",
    "transfer_tax_detected"
  ]
}
```

**Phase**

* ✅ MVP (Tier 1–3)
* 🔜 Phase 1 (Tier 4)

---

### 3.2 Token Classification

**Purpose:** Evaluate tokens received in pocket

```
POST /api/risk/token
```

```json
{
  "chainId": 1,
  "token": "0xTOKEN"
}
```

```json
{
  "tier": 4,
  "confidence": 78,
  "signals": ["stateful_logic_detected"]
}
```

**Phase**

* 🔜 Phase 1

---

## 4. Simulation APIs

### 4.1 Transfer Simulation

**Purpose:** Detect honeypots & gas griefing

```
POST /api/simulate/transfer
```

```json
{
  "chainId": 1,
  "token": "0xTOKEN",
  "from": "0xPOCKET",
  "to": "0xDUMMY",
  "amount": "1000000000000000000"
}
```

```json
{
  "success": false,
  "gasEstimate": 320000,
  "error": "TRANSFER_REVERT"
}
```

**Phase**

* ✅ MVP

---

### 4.2 DEX Sell Simulation

**Purpose:** Detect honeypots & economic extraction

```
POST /api/simulate/sell
```

```json
{
  "chainId": 1,
  "token": "0xTOKEN",
  "amount": "1000000000000000000",
  "dex": "uniswap-v2"
}
```

```json
{
  "success": true,
  "expectedOut": "0.98 ETH",
  "actualOut": "0.92 ETH",
  "slippagePct": 6.1
}
```

**Controls**

* Rate-limited
* Cached 10 min
* Requires signed intent after free quota

**Phase**

* 🔜 Phase 1

---

### 4.3 Simulation Quota Check

```
GET /api/simulate/quota
```

```json
{
  "remaining": 2,
  "resetAt": 1710003600
}
```

**Phase**

* 🔜 Phase 1

---

## 5. Execution & Relayer APIs

### 5.1 Prepare Claim Intent

**Purpose:** Construct EIP-712 message for user to sign

```
POST /api/intent/claim
```

```json
{
  "pocket": "0xPOCKET",
  "target": "0xCONTRACT",
  "calldata": "0x..."
}
```

```json
{
  "typedData": { /* EIP-712 */ },
  "nonce": 7,
  "expiry": 1710001200
}
```

**Phase**

* ✅ MVP

---

### 5.2 Submit Signed Intent

**Purpose:** Relayer entrypoint

```
POST /api/relayer/execute
```

```json
{
  "signature": "0xSIG",
  "typedData": { ... }
}
```

```json
{
  "txHash": "0xTX",
  "status": "SUBMITTED"
}
```

**Phase**

* ✅ MVP

---

## 6. Sweep / Withdraw APIs

### 6.1 Auto-Sweep Trigger

**Purpose:** Backend-initiated sweep for Tier 2

```
POST /api/sweep/auto
```

```json
{
  "pocket": "0xPOCKET",
  "token": "0xTOKEN"
}
```

**Backend**

* Calls controller
* Fee enforced on-chain

**Phase**

* 🔜 Phase 1

---

### 6.2 Force Withdraw (User-triggered)

**Purpose:** Tier 3 / Tier 4 user decision

```
POST /api/intent/withdraw
```

```json
{
  "pocket": "0xPOCKET",
  "token": "0xTOKEN",
  "amount": "ALL"
}
```

```json
{
  "typedData": { /* EIP-712 */ },
  "feePct": 8
}
```

**Followed by**

```
POST /api/relayer/execute
```

**Phase**

* 🔜 Phase 1

---

## 7. Telemetry & Safety APIs

### 7.1 Pocket Event Feed

```
GET /api/events?pocket=0xPOCKET
```

```json
[
  { "type": "EXECUTED", "tx": "0x..." },
  { "type": "DRAINED", "lossEth": "0.004" }
]
```

**Phase**

* ✅ MVP

---

### 7.2 Incident Report (User Feedback)

```
POST /api/report
```

```json
{
  "token": "0xTOKEN",
  "reason": "honeypot"
}
```

**Phase**

* 🔜 Phase 2

---

## 8. Admin / Governance APIs (Later)

### 8.1 Whitelist Management

```
POST /api/admin/whitelist/add
```

### 8.2 Tier Override (Emergency)

```
POST /api/admin/override
```

**Phase**

* 🔜 Phase 2+

---

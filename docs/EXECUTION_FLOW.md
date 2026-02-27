# EXECUTION_FLOW.md — Ward

## Purpose of This Document

This document provides a **complete end-to-end execution walkthrough** of Ward.

It explains, in order:

1. What the **user experiences**
2. What happens in the **backend (off-chain)**
3. What happens **on-chain (contracts)**
4. How **failures are handled** and what Ward **guarantees by design**

This is the authoritative reference for understanding **how a risky interaction is safely executed**.

---

## 1. User-Visible Flow

This section describes **exactly what the user sees and does**.

### 1.1 Initial State (Before Any Interaction)

* User has a normal EOA wallet (e.g. MetaMask)
* User has deposited ETH into the PocketController
* No pockets exist yet
* No approvals exist anywhere

The user’s wallet behaves normally.

---

### 1.2 User Initiates a Risky Action

Example:

* User visits an airdrop site
* User clicks **“Claim”**

Ward frontend intercepts the action and displays:

* Target contract
* Risk status (pending)
* “Claim safely with Ward”

No blockchain transaction occurs yet.

---

### 1.3 Risk Explanation Shown to User

After backend analysis, the UI shows:

* Risk tier (1–4)
* Clear explanation (e.g. “Unverified contract”, “Simulation failed”)
* Recommended action:

  * Auto-proceed (Tier 2)
  * Require confirmation (Tier 4)
  * Warn strongly (Tier 3)

The user always remains in control.

---

### 1.4 User Authorization (Signature Only)

If execution proceeds:

* User is asked to **sign a message**, not send a transaction
* Signature authorizes:

  * A specific pocket address
  * A specific contract
  * A specific calldata
  * Exactly once
  * With expiry

User **does not pay gas**.

This is the **only moment the user grants authority**.

---

### 1.5 Execution Happens Transparently

From the user’s perspective:

* UI shows “Executing safely…”
* No wallet pop-ups
* No approvals requested
* No gas payment

Outcome is shown clearly:

* “Pocket drained — main wallet safe”
* OR “Token received — isolated”
* OR “Token transferred to main wallet”

---

## 2. Backend (Off-Chain) Flow

This section describes **everything that happens after the click, before on-chain execution**.

---

### 2.1 Risk Classification

Backend receives:

* Chain ID
* Target contract
* Calldata

Backend performs:

* Static bytecode analysis
* Known scam / blacklist lookup
* Confidence scoring
* Tier assignment (1–4)

Result is **advisory only**.

No state is changed.

---

### 2.2 Simulation (If Required)

Depending on tier:

* Transfer simulation (`eth_call`)
* Gas estimation
* DEX sell simulation (forked chain)

Simulations:

* Never move funds
* Are cached
* Are rate-limited

Results are attached to the execution context.

---

### 2.3 Pocket Address Determination

Backend derives:

* Deterministic pocket address (CREATE2)
* Nonce / epoch

This address is shown to the user **before signing**.

---

### 2.4 Intent Construction

Backend prepares an **EIP-712 typed message** containing:

* Pocket address
* Target contract
* Calldata hash
* Nonce
* Expiry
* Chain ID

Backend does **not** sign anything.

---

### 2.5 Relayer Preparation

After user signs:

* Backend validates signature format
* Forwards intent to relayer
* Relayer queues execution

Relayer cannot modify intent.

---

## 3. On-Chain / Contract-Level Flow

This section describes **authoritative execution on the blockchain**.

---

### 3.1 Pocket Creation (Lazy)

Relayer submits a transaction calling:

```
PocketController.createPocket(user, nonce)
```

Controller:

* Deploys pocket via CREATE2
* Funds pocket with fixed ETH reserve
* Records ownership
* Emits `PocketCreated`

No risky code has run yet.

---

### 3.2 Execution Routing

Relayer submits:

```
PocketController.executeFromPocket(
  pocket,
  target,
  calldata,
  signature,
  nonce,
  expiry
)
```

Controller:

* Verifies pocket exists
* Verifies pocket unused
* Forwards call to pocket

---

### 3.3 Pocket Execution (Isolation Boundary)

Inside `Pocket.exec(...)`:

Checks:

* Signature recovers owner
* Nonce unused
* Not expired
* Pocket not already used

Then:

```
target.call(calldata)
```

Effects:

* All state changes occur **inside the pocket**
* Any malicious behavior is confined

After execution:

* Pocket is marked as used
* Pocket cannot execute again

---

### 3.4 Post-Execution Asset Handling

One of four outcomes occurs:

#### Case A — Pocket Drained

* Pocket balance becomes zero
* Pocket marked `COMPROMISED`
* No further actions possible

#### Case B — Explicitly Safe Token (Tier 2)

* Controller auto-sweeps token
* Fee calculated on-chain
* Remainder sent to main wallet

#### Case C — Provisionally Safe Token (Tier 4)

* Assets remain in pocket
* User must explicitly confirm sweep

#### Case D — Unsafe Token (Tier 3)

* Assets remain isolated
* User may force withdraw or abandon

No assets ever move silently.

---

## 4. Failure Paths and Guarantees

This section defines **what can go wrong and what cannot happen**.

---

### 4.1 Backend Failure

* No funds at risk
* Execution delayed
* User can retry later
* Signed intents remain valid until expiry

---

### 4.2 Relayer Failure

* No custody of funds
* User can submit same intent to another relayer
* No loss possible

---

### 4.3 Pocket Compromise

* Loss limited to pocket balance
* Main wallet untouched
* Other pockets unaffected

This is an **expected and acceptable failure mode**.

---

### 4.4 Controller Emergency Pause

* New executions halted
* Existing pockets cannot execute again
* No retroactive damage possible

---

## 5. System Guarantees (By Design)

Ward **guarantees**:

* Main wallet never executes risky code
* Main wallet never grants approvals
* Each pocket executes at most once
* Authority is always explicit and scoped
* Loss is bounded and predictable

Ward **does not guarantee**:

* That tokens have value
* That scams never occur
* That pocket funds cannot be lost

---

** Ward executes risky on-chain actions inside disposable, single-use pockets, ensuring that even successful attacks are physically unable to reach the user’s main wallet. **

---


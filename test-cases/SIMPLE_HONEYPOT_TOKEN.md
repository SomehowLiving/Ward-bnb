# SimpleHoneypotToken × WARD

**Command Reference & Expected Outcomes**

This document describes **all supported interactions** with `SimpleHoneypotToken` when used:

* directly by an EOA
* through a `Pocket` via `PocketController`

It also documents **expected failures**, which are **security properties**, not bugs.

---

## Contracts

* **SimpleHoneypotToken**

  * ERC20 honeypot token
  * Minting allowed
  * Transfers permanently blocked

* **Pocket**

  * Single-use execution sandbox
  * EIP-712 authorized execution
  * No asset leakage

* **PocketController**

  * Creates pockets
  * Routes execution
  * Enforces sweep + burn rules

---

## Environment Variables

```bash
export RPC_URL=...
export PRIVATE_KEY=...
export WALLET_ADDRESS=...
export CONTROLLER_ADDRESS=...
export POCKET_ADDRESS=...
export TOKEN_ADDRESS=...
```

---

## 1. Direct Token Interaction (EOA → Token)

### 1.1 Claim airdrop directly

```bash
cast send $TOKEN_ADDRESS \
  "claimAirdrop()" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected result**

* ✅ Success
* `Transfer(0x0 → WALLET_ADDRESS, 1000e18)`
* Wallet balance increases

---

### 1.2 Check wallet balance

```bash
cast call $TOKEN_ADDRESS \
  "balanceOf(address)(uint256)" \
  $WALLET_ADDRESS \
  --rpc-url $RPC_URL
```

**Expected result**

* `previous_balance + 1000e18`

---

### 1.3 Attempt transfer (honeypot trap)

```bash
cast send $TOKEN_ADDRESS \
  "transfer(address,uint256)" \
  0x000000000000000000000000000000000000dEaD \
  1 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected result**

* ❌ Revert
  `HONEYPOT: Cannot transfer`

---

### 1.4 Approve + transferFrom (still blocked)

```bash
cast send $TOKEN_ADDRESS \
  "approve(address,uint256)" \
  0x000000000000000000000000000000000000dEaD \
  100 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

```bash
cast send $TOKEN_ADDRESS \
  "transferFrom(address,address,uint256)" \
  $WALLET_ADDRESS \
  0x000000000000000000000000000000000000dEaD \
  1 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected result**

* ❌ Revert
  `HONEYPOT: Cannot transfer`

---

## 2. Pocket Execution Flow

### 2.1 Execute `claimAirdrop()` via Pocket

Selector:

```bash
cast sig "claimAirdrop()"
# 0x5b88349d
```

Execution:

```bash
cast send \
  $CONTROLLER_ADDRESS \
  "executeFromPocket(address,address,bytes,uint256,uint256,bytes)" \
  $POCKET_ADDRESS \
  $TOKEN_ADDRESS \
  0x5b88349d \
  1 \
  $EXPIRY \
  $SIGNATURE \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected result**

* ✅ Success
* `Transfer(0x0 → POCKET_ADDRESS, 1000e18)`
* Pocket marked as used

---

### 2.2 Verify pocket state

```bash
cast call $POCKET_ADDRESS "used()(bool)" --rpc-url $RPC_URL
```

**Expected**

```
true
```

```bash
cast call $POCKET_ADDRESS \
  "usedNonces(uint256)(bool)" \
  1 \
  --rpc-url $RPC_URL
```

**Expected**

```
true
```

---

### 2.3 Check pocket token balance

```bash
cast call $TOKEN_ADDRESS \
  "balanceOf(address)(uint256)" \
  $POCKET_ADDRESS \
  --rpc-url $RPC_URL
```

**Expected**

```
1000000000000000000000
```

---

## 3. Replay & Abuse Prevention

### 3.1 Re-execute pocket (any calldata)

```bash
cast send \
  $CONTROLLER_ADDRESS \
  "executeFromPocket(address,address,bytes,uint256,uint256,bytes)" \
  $POCKET_ADDRESS \
  $TOKEN_ADDRESS \
  0x5b88349d \
  1 \
  $EXPIRY \
  $SIGNATURE \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected result**

* ❌ Revert
  `PocketAlreadyUsed`

---

### 3.2 Execute with garbage calldata

```bash
cast send \
  $CONTROLLER_ADDRESS \
  "executeFromPocket(address,address,bytes,uint256,uint256,bytes)" \
  $POCKET_ADDRESS \
  $TOKEN_ADDRESS \
  0xdeadbeef \
  1 \
  $EXPIRY \
  $SIGNATURE \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected result**

* ❌ Revert
  `PocketAlreadyUsed`

---

## 4. Sweep Attempts (Isolation Proof)

### 4.1 Sweep tokens to wallet

```bash
cast send \
  $CONTROLLER_ADDRESS \
  "sweep(address,address,address,uint256,uint8)" \
  $POCKET_ADDRESS \
  $TOKEN_ADDRESS \
  $WALLET_ADDRESS \
  1 \
  0 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected result**

* ❌ Revert
  `HONEYPOT: Cannot transfer`

---

### 4.2 Sweep full balance

```bash
cast send \
  $CONTROLLER_ADDRESS \
  "sweep(address,address,address,uint256,uint8)" \
  $POCKET_ADDRESS \
  $TOKEN_ADDRESS \
  $WALLET_ADDRESS \
  1000 \
  0 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected result**

* ❌ Revert
  `HONEYPOT: Cannot transfer`

---

## 5. Bypass Attempts (Fail)

### 5.1 Direct transferFrom from pocket

```bash
cast send $TOKEN_ADDRESS \
  "transferFrom(address,address,uint256)" \
  $POCKET_ADDRESS \
  $WALLET_ADDRESS \
  1 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected result**

* ❌ Revert
  `ERC20: insufficient allowance`

(Even with allowance, transfer would still revert.)

---

## 6. ## 6. Pocket Funds (Pre-Burn)

### 6.1 Check pocket ETH balance

```bash
cast balance $POCKET_ADDRESS --rpc-url $RPC_URL
```

**Expected**

```
0.005 ETH
```

---


## 7. Token Transfer Restrictions (Honeypot Behavior)

This section documents **expected failures** when attempting direct ERC-20 transfers from externally owned accounts (EOAs).

---

### 7.1 Direct Transfer to a Regular Address (Expected Failure)

```bash
cast send $TOKEN_ADDRESS \
  "transfer(address,uint256)" \
  $BUYER_ADDRESS \
  1 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Observed Error**

```
Error: Failed to estimate gas: server returned an error response:
error code 3: execution reverted: HONEYPOT: Cannot transfer
Error("HONEYPOT: Cannot transfer")
```

**Explanation**

* The token explicitly blocks `transfer()` calls.
* This confirms the token is a **honeypot-style ERC20**.
* Tokens cannot be moved via standard ERC20 transfer semantics.

---

### 7.2 Transfer to Zero Address (Standard ERC20 Guard)

```bash
cast send $TOKEN_ADDRESS \
  "transfer(address,uint256)" \
  0x0000000000000000000000000000000000000000 \
  1 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Observed Error**

```
Error: Failed to estimate gas: server returned an error response:
error code 3: execution reverted: ERC20: transfer to the zero address
Error("ERC20: transfer to the zero address")
```

**Explanation**

* This revert comes from the standard ERC20 zero-address guard.
* It is **independent** of the honeypot restriction.
* Confirms ERC20 compliance checks are still enforced.

---

## 8. Security Implications

These failures demonstrate the intended design:

* `transfer()` is **globally disabled**
* Tokens can only be acquired via:

  * `claimAirdrop()`
  * controlled execution paths (e.g., via Pocket + Controller)
* Tokens held by a burned pocket:

  * **cannot be transferred**
  * **cannot be swept**
  * **cannot be recovered**

This validates that:

* Honeypot restrictions are effective
* Pocket burn + controller invalidation permanently isolates toxic assets
* No fallback ERC20 path exists to bypass protocol controls


### Security Guarantees Proven

* Tokens can be **received but never moved**
* Approvals do not bypass restrictions
* Pocket execution is **single-use**
* Replays are impossible
* Sweeping toxic assets fails deterministically
* Assets remain permanently isolated
* Burning the pocket is the only cleanup path

---

---

## 9. Key Takeaway

> **If `transfer()` succeeds, the isolation model is broken.**

These reverts are **expected, correct, and required** for protocol safety.

---

## Summary

This interaction set demonstrates a **real-world honeypot containment scenario**:

> A malicious ERC20 can be safely interacted with once, fully isolated, and prevented from contaminating the user’s wallet or escaping the sandbox.

---
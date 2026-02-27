# Pocket Lifecycle Reference Guide

This document describes the **full lifecycle of a Pocket**:
creation → verification → execution → burn → post-burn validation.

---

## 1. Pocket Creation

### Step 1.1: Create a New Pocket

```bash
# Use a new salt (timestamp is easiest)
export SALT=$(date +%s)

cast send $CONTROLLER_ADDRESS \
  "createPocket(address,uint256)" \
  $WALLET_ADDRESS $SALT \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Notes**

* `SALT` must be unique per pocket.
* Save the salt; it is required to compute the pocket address.

---

### Step 1.2: Compute the Pocket Address

```bash
node scipts/compute-pocket-address.js
```

```bash
# Export the new address
export POCKET_ADDRESS=0x...
```

---

## 2. Pocket Verification (Pre-Execution)

### Step 2.1: Verify ETH Funding

```bash
# Check it's funded with 0.005 ETH
cast balance $POCKET_ADDRESS --rpc-url $RPC_URL
```

---

### Step 2.2: Verify Pocket Is Unused

```bash
# Check it's not used yet
cast call $POCKET_ADDRESS "used()(bool)" --rpc-url $RPC_URL
```

**Expected**

```
false
```

---

### Step 2.3: Verify Pocket Ownership in Controller

```bash
cast call $CONTROLLER_ADDRESS \
  "pocketOwner(address)(address)" \
  $POCKET_ADDRESS \
  --rpc-url $RPC_URL
```

**Expected**

```
<WALLET_ADDRESS>
```

---

## 3. Signature Generation

### Step 3.1: Generate a Fresh Claim Signature

Create the script:

```
scripts/sign-claim-fresh.js
```

* Same logic as previous claim scripts
* Must reference the **new pocket address**
* Must use a **fresh nonce and expiry**

---

## 4. Pocket Execution

### Step 4.1: Generate Signature

```bash
node scripts/sign-claim-new.js
```

```bash
# Set variables (copy from script output)
export SIGNATURE="0x..."
export EXPIRY=1770059999
```

---

### Step 4.2: Execute From Pocket

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

---

### Step 4.3: Confirm Pocket Is Now Used

```bash
cast call $POCKET_ADDRESS "used()(bool)" --rpc-url $RPC_URL
```

**Expected**

```
true
```

---

## 5. Post-Execution Validation

### Step 5.1: Verify Nonce Consumption

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

### Step 5.2: Verify Token Balance in Pocket

```bash
cast call $TOKEN_ADDRESS \
  "balanceOf(address)(uint256)" \
  $POCKET_ADDRESS \
  --rpc-url $RPC_URL
```

**Example Output**

```
1000000000000000000000
```

---

### Step 5.3: Verify ETH Balance

```bash
cast balance $POCKET_ADDRESS --rpc-url $RPC_URL
```

**Example Output**

```
5000000000000000
```

---

## 6. Control Tests (Sanity Checks)

### Step 6.1: Direct Wallet Claim

```bash
cast send $TOKEN_ADDRESS \
  "claimAirdrop()" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

```bash
cast call $TOKEN_ADDRESS \
  "balanceOf(address)(uint256)" \
  $WALLET_ADDRESS \
  --rpc-url $RPC_URL
```

---

### Step 6.2: Simulated Call From Pocket (No State Change)

```bash
cast call $TOKEN_ADDRESS \
  "claimAirdrop()" \
  --rpc-url $RPC_URL \
  --from $POCKET_ADDRESS
```

**Expected**

```
0x
```

---

## 7. Burning the Pocket

### Step 7.1: Generate Burn Signature

```bash
# Run burn signature script
node/burn-sign.js
```

---

### Step 7.2: Burn the Pocket

```bash
cast send $CONTROLLER_ADDRESS \
  "burnPocket(address,uint256,uint256,bytes)" \
  $POCKET_ADDRESS \
  $BURN_NONCE \
  $BURN_EXPIRY \
  $BURN_SIGNATURE \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

---

## 8. Verifying a Burned Pocket

> **Important (EIP-6780)**
> `SELFDESTRUCT` no longer removes bytecode or storage unless creation and destruction occur in the same transaction.
> **Burn verification is behavioral and controller-based.**

A pocket is **irreversibly burned** only if **all checks below pass**.

---

### 8.1: Controller Invalidates Pocket (Authoritative)

```bash
cast call $CONTROLLER_ADDRESS \
  "validPocket(address)(bool)" \
  $POCKET_ADDRESS \
  --rpc-url $RPC_URL
```

**Expected**

```
false
```

This is the **primary source of truth**.

---

### 8.2: Execution Is Blocked

```bash
cast send $CONTROLLER_ADDRESS \
  "executeFromPocket(address,address,bytes,uint256,uint256,bytes)" \
  $POCKET_ADDRESS \
  $TOKEN_ADDRESS \
  0x5b88349d \
  2 \
  $EXPIRY \
  0xdeadbeef \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected**

```
InvalidPocket
```

---

### 8.3: Sweep Is Blocked

```bash
cast send $CONTROLLER_ADDRESS \
  "sweep(address,address,address,uint256,uint8)" \
  $POCKET_ADDRESS \
  $TOKEN_ADDRESS \
  $WALLET_ADDRESS \
  1 \
  0 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected**

```
InvalidPocket
```

### FIND THE AMOUNT OF TOKEN:

```bash

AMOUNT=$(cast call $TOKEN_ADDRESS \
  "balanceOf(address)(uint256)" \
  $POCKET_ADDRESS \
  --rpc-url $RPC_URL | cut -d' ' -f1)

```

> *IF YOU WANT TO SWEEP ALL*:
```bash
cast send $CONTROLLER_ADDRESS \
  "sweep(address,address,address,uint256,uint8)" \
  $POCKET_ADDRESS \
  $TOKEN_ADDRESS \
  $WALLET_ADDRESS \
  $AMOUNT \
  0 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY

```
---

### 8.4: Pocket ETH Balance Is Zero

```bash
cast balance $POCKET_ADDRESS --rpc-url $RPC_URL
```

**Expected**

```
0
```

Confirms ETH was reclaimed during burn.

---

### 8.5: Controller Reclaimed ETH

```bash
cast balance $CONTROLLER_ADDRESS --rpc-url $RPC_URL
```

**Expected**

```
+<previous pocket ETH>
```

---

### 8.6: Token Balances Remain but Are Inaccessible

```bash
cast call $TOKEN_ADDRESS \
  "balanceOf(address)(uint256)" \
  $POCKET_ADDRESS \
  --rpc-url $RPC_URL
```

**Expected**

```
> previous balance
```

Tokens are permanently **cryptographically bricked**.

---

### 8.7: Bytecode Presence Is Not a Burn Signal

```bash
cast code $POCKET_ADDRESS --rpc-url $RPC_URL
```

**Expected**

```
(non-empty)
```

Normal post-EIP-6780 behavior.

---

## 9. Burn Invariants

After a successful burn:

* Pocket cannot execute
* Pocket cannot sweep assets
* Pocket cannot be reused
* ETH is reclaimed
* Tokens remain isolated forever

Burn finality is enforced **at the controller level**, not via bytecode deletion.

---

## 10. Final Summary

> **A pocket is burned when the controller rejects it, not when its bytecode disappears.**

If all verification steps pass, the pocket is **permanently destroyed and inert**.

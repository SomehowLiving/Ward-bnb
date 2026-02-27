# Part A — Direct Interaction with `ClaimSellBlockedToken` (CSBT)

This section documents **direct EOA interactions** with `ClaimSellBlockedToken`, demonstrating both **normal behavior** and the **honeypot sell trap**.

The goal is to establish a **ground truth baseline** before introducing Pocket / WARD isolation.

---

## Contract Summary

**ClaimSellBlockedToken (CSBT)** is a *conditional honeypot ERC20* with the following properties:

* Anyone may claim a one-time airdrop
* Tokens behave like a normal ERC20 **until a sell is attempted**
* **Selling to the DEX pair is permanently blocked for claimed wallets**
* The **contract owner is exempt** from all restrictions (realistic scam behavior)

---

## Roles Used in Testing

| Role         | Description                                    |
| ------------ | ---------------------------------------------- |
| **Owner**    | Contract deployer (liquidity seeder / scammer) |
| **User**     | Regular wallet that has not claimed            |
| **Victim**   | Regular wallet that has claimed                |
| **DEX Pair** | Simulated DEX pair address                     |

---

## Environment Variables

```bash
export RPC_URL=...
export TOKEN_ADDRESS=...
export DEX_PAIR=0x0000000000000000000000000000000000000001
```

---

## A.1 Token Identity Check

```bash
cast call $TOKEN_ADDRESS "symbol()(string)" --rpc-url $RPC_URL
```

**Expected**

```
CSBT
```

---

## A.2 Owner Claims Airdrop (Allowed)

```bash
cast send $TOKEN_ADDRESS \
  "claimAirdrop()" \
  --rpc-url $RPC_URL \
  --private-key $OWNER_KEY
```

**Expected**

* ✅ Success
* `claimed(owner) == true`
* Owner balance increases by `1000 CSBT`

---

## A.3 Owner Can Transfer to Other Wallets

```bash
cast send $TOKEN_ADDRESS \
  "transfer(address,uint256)" \
  $FRIEND_ADDRESS \
  10 \
  --rpc-url $RPC_URL \
  --private-key $OWNER_KEY
```

**Expected**

* ✅ Success
* Tokens behave like a normal ERC20

---

## A.4 Owner Can Sell to DEX (Exempt by Design)

```bash
cast send $TOKEN_ADDRESS \
  "transfer(address,uint256)" \
  $DEX_PAIR \
  1 \
  --rpc-url $RPC_URL \
  --private-key $OWNER_KEY
```

**Expected**

* ✅ Success

> **Important:**
> The contract owner is intentionally exempt from sell restrictions.
> This allows liquidity seeding, fake volume, and dumping — matching real honeypot behavior.

---

## A.5 Owner Approval Does Not Affect Honeypot Logic

```bash
cast send $TOKEN_ADDRESS \
  "approve(address,uint256)" \
  $DEX_PAIR \
  1000 \
  --rpc-url $RPC_URL \
  --private-key $OWNER_KEY
```

**Expected**

* ✅ Success
* Does **not** bypass sell restrictions for victims

---

## A.6 Victim Claims Airdrop

```bash
cast send $TOKEN_ADDRESS \
  "claimAirdrop()" \
  --rpc-url $RPC_URL \
  --private-key $VICTIM_KEY
```

```bash
cast call $TOKEN_ADDRESS \
  "claimed(address)(bool)" \
  $VICTIM_ADDRESS \
  --rpc-url $RPC_URL
```

**Expected**

```
true
```

---

## A.7 Victim Transfers to Another Wallet (Still Allowed)

```bash
cast send $TOKEN_ADDRESS \
  "transfer(address,uint256)" \
  $FRIEND_ADDRESS \
  10 \
  --rpc-url $RPC_URL \
  --private-key $VICTIM_KEY
```

**Expected**

* ✅ Success

Tokens **appear fully functional**.

---

## A.8 Victim Attempts to Sell (HONEYPOT TRIGGER)

```bash
cast send $TOKEN_ADDRESS \
  "transfer(address,uint256)" \
  $DEX_PAIR \
  1 \
  --rpc-url $RPC_URL \
  --private-key $VICTIM_KEY
```

**Expected**

* ❌ Revert

  ```
  SELL DISABLED: claimed wallet
  ```

This is the **honeypot trap**.

---

## A.9 Approval Does NOT Bypass the Trap

```bash
cast send $TOKEN_ADDRESS \
  "approve(address,uint256)" \
  $DEX_PAIR \
  1000 \
  --rpc-url $RPC_URL \
  --private-key $VICTIM_KEY
```

```bash
cast send $TOKEN_ADDRESS \
  "transferFrom(address,address,uint256)" \
  $VICTIM_ADDRESS \
  $DEX_PAIR \
  1 \
  --rpc-url $RPC_URL \
  --private-key $VICTIM_KEY
```

**Expected**

* ❌ Revert

  ```
  SELL DISABLED: claimed wallet
  ```

---

## A.10 Behavioral Summary

| Action              | Owner | Victim |
| ------------------- | ----- | ------ |
| Claim airdrop       | ✅     | ✅      |
| Transfer to wallet  | ✅     | ✅      |
| Approve spender     | ✅     | ✅      |
| Sell to DEX         | ✅     | ❌      |
| Bypass via approval | N/A   | ❌      |

---

## A.11 Security Implication

This token demonstrates a **realistic conditional honeypot**:

* Tokens look transferable
* Balance increases normally
* Wallet-to-wallet transfers work
* Only the **sell action** fails
* Owner behavior masks the scam

This makes static detection difficult and motivates **isolated execution environments** like WARD pockets.

---
Good test choice. This token is **much closer to real-world scam behavior**.
Below is a **clear, deterministic test plan** you can run with **EOA only** and then **with WARD pockets**, including **expected outcomes** and **what each test proves**.

I’ll structure this exactly like something you can paste into a README or test checklist.

---

# Testing `ClaimSellBlockedToken` (CSBT)

## Token properties recap (important for tests)

* Claiming **marks the wallet**
* Marked wallets:

  * ✅ can transfer to normal wallets
  * ❌ cannot sell to the DEX pair
* Owner is always exempt
* This simulates *“everything works until you try to sell”*

---

## Setup

### 0. Deploy token

Use a dummy DEX pair (can be any address):

```bash
export DEX_PAIR=0x0000000000000000000000000000000000000001
```

Deploy:

```bash
forge create ClaimSellBlockedToken \
  --constructor-args $DEX_PAIR \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

Save:

```bash
export TOKEN_ADDRESS=0x...
```

---

## PART B — Testing with WARD Pocket (core value)

### 1. Create pocket

```bash
cast send $CONTROLLER_ADDRESS \
  "createPocket(address,uint256)" \
  $WALLET_ADDRESS \
  1 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

Save pocket address.

---

### 2. Claim via pocket (safe execution)

Generate signature for:

```solidity
claimAirdrop()
```

Then execute:

```bash
cast send $CONTROLLER_ADDRESS \
  "executeFromPocket(address,address,bytes,uint256,uint256,bytes)" \
  $POCKET_ADDRESS \
  $TOKEN_ADDRESS \
  0x<claimAirdrop selector> \
  1 \
  $EXPIRY \
  $SIGNATURE \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected**

* ✅ Success
* `claimed[POCKET_ADDRESS] == true`
* Tokens minted to **pocket**, not wallet

---

### 3. Verify wallet is NOT marked

```bash
cast call $TOKEN_ADDRESS \
  "claimed(address)(bool)" \
  $WALLET_ADDRESS
```

**Expected**

```
false
```

This is **critical**:

* The wallet never triggered the honeypot
* Only the pocket is poisoned

---

### 4. Attempt sell from pocket (expected failure)

```bash
cast send $CONTROLLER_ADDRESS \
  "sweep(address,address,address,uint256,uint8)" \
  $POCKET_ADDRESS \
  $TOKEN_ADDRESS \
  $DEX_PAIR \
  1 \
  0 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected**

```
SELL DISABLED: claimed wallet
```

---

### 5. Wallet can still sell its own tokens

If the wallet received CSBT from someone else:

```bash
cast send $TOKEN_ADDRESS \
  "transfer(address,uint256)" \
  $DEX_PAIR \
  1 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected**

* ✅ Success

WARD successfully **prevented wallet contamination**.

---

## PART C — Burn pocket (cleanup)

```bash
cast send $CONTROLLER_ADDRESS \
  "burnPocket(address,uint256,uint256,bytes)" \
  $POCKET_ADDRESS \
  $NONCE \
  $EXPIRY \
  $BURN_SIGNATURE \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

**Expected**

* Pocket invalidated
* ETH reclaimed
* Claimed tokens permanently isolated

---

## What this test proves (important)

This token demonstrates a **next-level honeypot**, and your tests show:

* The token behaves normally **until a claim**
* Selling fails **only for claimed wallets**
* Ward pockets absorb the poison
* The main wallet remains clean
* Loss is contained and final

---

## One-line summary for README

> **ClaimSellBlockedToken simulates modern honeypots that only block selling after an airdrop claim; WARD safely contains the poisoned execution inside a pocket, preventing wallet-level contamination.**

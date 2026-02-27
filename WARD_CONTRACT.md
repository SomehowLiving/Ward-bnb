# Ward — End-to-End Flow

This system has **three roles**:

* **User** → owns the main wallet (identity signer)
* **Controller** → trusted relayer + enforcer (PocketController)
* **Pocket** → single-use execution sandbox

---

## 0. Initial Setup (One-time)

### Contracts deployed

1. **PocketFactory**

   * Responsible for deploying Pocket contracts via CREATE2

2. **PocketController**

   * Holds ETH for gas funding
   * Acts as the *only* entity allowed to:

     * create pockets
     * execute calls
     * sweep funds
     * burn pockets

---

## 1. User wants to interact with a risky contract

Example:

* Claim an airdrop
* Interact with an unknown DeFi / NFT / game contract

**Important design decision**

* The user **never sends a transaction**
* The user **never touches gas**
* The user **never directly calls the target contract**

---

## 2. Controller creates a disposable pocket (lazy creation)

### Call

```solidity
PocketController.createPocket(user, salt)
```

### What happens on-chain

1. Controller checks it has enough ETH for gas funding
2. Factory deploys a new `Pocket` via CREATE2:

   * `controller` = PocketController
   * `owner` = user
3. Controller:

   * marks the pocket as valid
   * records `pocketOwner[pocket] = user`
4. Controller sends **GAS_RESERVE (0.005 ETH)** to the pocket

### Result

* A **fresh, isolated smart wallet** now exists
* It has:

  * ETH for gas
  * no approvals
  * no history
  * no permissions except what will be explicitly signed

---

## 3. User authorizes exactly one action (off-chain)

The user signs an **EIP-712 typed message**, *not a transaction*.

### What the user signs

```
Exec(
  pocket: address,
  target: address,
  dataHash: keccak256(calldata),
  nonce: uint256,
  expiry: uint256
)
```

This signature cryptographically binds:

* one pocket
* one target contract
* one exact calldata
* one nonce
* one expiry window

**Key guarantee**

> Even the controller cannot change *anything* without invalidating the signature.

---

## 4. Controller executes the risky interaction

### Call

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

### Inside `Pocket.exec`

The pocket enforces **hard constraints**:

1. Only the controller may call `exec`
2. Pocket must not be burned
3. Pocket must not have been used before
4. Nonce must be unused
5. Signature must not be expired
6. Signature must recover to `owner`

Only after all checks pass:

```solidity
target.call(data)
```

### Critical security property

* The **risky execution happens from the pocket**
* If the target:

  * drains ETH
  * steals ERC20 approvals
  * behaves maliciously

➡️ **Only the pocket is affected**

The main wallet is untouched.

After execution:

* `used = true`
* Pocket can **never execute again**

---

## 5. Outcome handling (post-execution)

There are two possible outcomes:

---

### Case A: Contract was malicious

* Pocket may be drained
* ETH may be gone
* Tokens may be stolen

**Result**

* Damage is capped to:

  * GAS_RESERVE
  * any tokens intentionally moved into the pocket
* Main wallet is safe
* Controller can burn the pocket

---

### Case B: Contract was legitimate

Tokens now sit inside the pocket.

---

## 6. Sweeping assets back (with enforced fee)

### Call

```solidity
PocketController.sweep(
  pocket,
  token,
  receiver,
  amount,
  tier
)
```

### Enforced guarantees

1. Only valid pockets
2. Only pocket owner can receive funds
3. Fee is enforced on-chain (basis points)

### Flow

* Fee → treasury
* Remaining amount → user’s main wallet

No approvals leak.
No permissions persist.

---

## 7. Pocket destruction (finalization)

### Call

```solidity
PocketController.burnPocket(
  pocket,
  nonce,
  expiry,
  signature
)
```

### Inside `Pocket.burn`

1. Signature verified against owner
2. Pocket marked burned
3. `selfdestruct(controller)`

### Result

* Pocket is permanently unusable
* Any leftover ETH goes back to controller
* State cleaned up

---

## 8. System invariants (this is what you should emphasize)

Your contracts enforce:

* ❌ Main wallet never executes risky calls
* ❌ Main wallet never grants approvals
* ❌ No reusable execution context
* ❌ No silent permission inheritance

✔️ Every risky action is:

* single-use
* explicitly authorized
* fully isolated
* loss-capped

---

> Ward routes risky on-chain interactions through disposable smart wallets created on demand. Users sign a one-time intent authorizing a specific call, the controller executes it from an isolated pocket, and the pocket is destroyed afterward. If the interaction is malicious, only the pocket is affected; if safe, assets are swept back with enforced fees. The main wallet never touches untrusted contracts.

---

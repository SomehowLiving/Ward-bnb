# WARD Backend API Documentation

Base URL:

```
http://localhost:3000
```

All requests and responses use JSON.

---

## Authentication / Signing Model

* Transactions are authorized via **EIP-712 signatures** created by the Pocket owner.
* Backend acts as a **relay** using a controller signer.
* Most mutating endpoints perform **staticCall simulation** before sending a transaction.

---

## Error Format

Most errors follow this shape:

```json
{
  "error": {
    "type": "CONTRACT_ERROR | REVERT | RPC_ERROR | UNKNOWN",
    "name": "ErrorName",
    "args": [],
    "message": "Human readable message"
  }
}
```

---

## Pocket Lifecycle

### Create Pocket

**POST** `/api/pocket/create`

Creates a new Pocket for a user.

**Body**

```json
{
  "user": "0xUserAddress",
  "salt": "123"
}
```

**Response**

```json
{
  "pocket": "0xPocketAddress"
}
```

---

### Get Pocket Status

**GET** `/api/pocket/:address`

**Response**

```json
{
  "address": "0xPocket",
  "owner": "0xOwner",
  "used": false,
  "burned": false
}
```

---

### Backfill Pocket Created Blocks

**POST** `/api/pocket/backfill-created-blocks`

Backfills `createdBlock` for already-known pockets by scanning historical `PocketDeployed` logs from the factory.

**Body (optional)**

```json
{
  "fromBlock": 0,
  "toBlock": "latest",
  "dryRun": true
}
```

**Response**

```json
{
  "ok": true,
  "factory": "0xFactory",
  "fromBlock": 0,
  "toBlock": "latest",
  "dryRun": true,
  "logsScanned": 10,
  "knownPockets": 3,
  "matched": 3,
  "updated": 0
}
```

---

### Get Pocket Owner (Direct)

**GET** `/api/pocket/:address/owner`

**Response**

```json
{
  "address": "0xPocket",
  "owner": "0xOwner"
}
```

---

### Burn Pocket

**POST** `/api/pocket/burn`

**Body**

```json
{
  "pocket": "0xPocket",
  "nonce": "1",
  "expiry": 1710000000,
  "signature": "0xSignature"
}
```

**Response**

```json
{
  "status": "burned",
  "txHash": "0xTxHash"
}
```

---

## Pocket Execution

### Execute From Pocket

**POST** `/api/pocket/exec`

Performs a protected execution from a Pocket.

**Body**

```json
{
  "pocket": "0xPocket",
  "target": "0xTarget",
  "data": "0xCalldata",
  "nonce": "1",
  "expiry": 1710000000,
  "signature": "0xSignature"
}
```

**Response**

```json
{
  "status": "executed",
  "txHash": "0xTxHash",
  "gasUsed": "123456"
}
```

---

### Simulate Execution (Frontend Pre-check)

**POST** `/api/pocket/simulate`

**Response**

```json
{
  "ok": true
}
```

or

```json
{
  "ok": false,
  "error": { ... }
}
```

---

### Estimate Gas for Execution

**POST** `/api/pocket/gas`

**Response**

```json
{
  "gas": "210000"
}
```

---

### Relay Execution (Direct)

**POST** `/api/relay/pocket-exec`

Same parameters as `/exec`, skips simulation.

**Response**

```json
{
  "txHash": "0xTxHash"
}
```

---

## Sweep & Fees

### Sweep Tokens From Pocket

**POST** `/api/pocket/sweep`

Risk tier is derived internally.

**Body**

```json
{
  "pocketAddress": "0xPocket",
  "tokenAddress": "0xToken",
  "receiverAddress": "0xReceiver",
  "amount": "1000000000000000000"
}
```

**Response**

```json
{
  "txHash": "0xTxHash"
}
```

---

### Calculate Sweep Fee (No Tx)

**POST** `/api/pocket/fee`

**Body**

```json
{
  "tokenAddress": "0xToken",
  "amount": "1000000000000000000"
}
```

**Response**

```json
{
  "amount": "1000000000000000000",
  "tier": 2,
  "fee": "5000000000000000",
  "net": "995000000000000000"
}
```

---

## Pocket Discovery

### List User Pockets

**GET** `/api/pockets/:userAddress`

**Response**

```json
{
  "pockets": [
    {
      "address": "0xPocket",
      "used": false,
      "createdAt": 19283912,
      "token": null
    }
  ]
}
```

---

### Controller View of Pocket

**GET** `/api/controller/pocket/:address`

**Response**

```json
{
  "address": "0xPocket",
  "valid": true,
  "owner": "0xOwner"
}
```

---

## Signature & Intent Verification

### Verify Execution Intent (EIP-712)

**POST** `/api/verify/exec-intent`

**Body**

```json
{
  "pocket": "0xPocket",
  "target": "0xTarget",
  "dataHash": "0xDataHash",
  "nonce": "1",
  "expiry": 1710000000,
  "signature": "0xSignature"
}
```

**Response**

```json
{
  "valid": true
}
```

---

## Calldata Decoding

### Decode Calldata (Human Readable)

**POST** `/api/calldata/decode`

Supports ERC-20 `approve` and `transfer`.

**Response**

```json
{
  "function": "transfer",
  "args": ["0xRecipient", "1000000000000000000"],
  "confidence": "low"
}
```

---

## Risk Engine (Internal / Heuristic)

### Classify Token Risk

**POST** `/api/risk/classify`

**Body**

```json
{
  "tokenAddress": "0xToken",
  "simulate": false
}
```

**Response**

```json
{
  "tier": 1,
  "confidence": 0.9,
  "signals": [],
  "message": "Token appears safe"
}
```

---

### Simulate Pocket → Target Call

**POST** `/api/risk/simulate`

**Response**

```json
{
  "success": true,
  "gasUsed": 0
}
```

---

## Token Metadata

### Get ERC-20 Metadata

**GET** `/api/token/:address`

**Response**

```json
{
  "name": "Token",
  "symbol": "TKN",
  "decimals": 18,
  "totalSupply": "1000000000000000000000000"
}
```

---

## Metrics & History (Stubbed)

### User History

**GET** `/api/history/:userAddress`

### Platform Metrics

**GET** `/api/metrics`

---

## Health Check

**GET** `/health`

**Response**

```json
{
  "ok": true
}
```

---

## Notes for Integrators

* `nonce` must be strictly increasing per Pocket.
* `expiry` is UNIX seconds.
* All signatures must match the Pocket owner.
* Frontends should call `/simulate` and `/verify/exec-intent` **before prompting users to sign**.

---

# CONTRACT.md — Ward Collateral Contracts And Flow

## Overview

Ward Collateral combines:
- `CollateralVault` for collateralized BNPL credit accounting
- `PocketController + Pocket + PocketFactory` for execution isolation

Core model:
- Credit authority is on-chain in `CollateralVault`
- Execution authority is signature-bound in `Pocket`
- Risky external calls are isolated to disposable pockets

---

## Contract Responsibilities

## 1. `CollateralVault.sol`

### What it does
- Accepts user collateral via `deposit()` (native BNB in this repo).
- Computes user credit capacity with a fixed LTV constant via `availableCredit()`.
- Creates installment BNPL loans with `requestCredit(merchant, amount, installmentCount, interval, salt)` which:
  - verifies the merchant is not blocked
  - ensures installment and interval parameters are valid
  - allocates the borrowed amount by incrementing `positions[borrower].borrowed`
  - creates a deterministic pocket via `PocketController.createPocket` and funds it
  - emits `CreditRequested` with pocket and next due date
- Tracks loans in `creditPositions` keyed by `requestId` containing principal, remaining, installmentAmount, installmentsPaid, totalInstallments, interval, nextDueDate, defaulted, closed, and pocket address
- Accepts repayments via `repayInstallment(requestId)` (user sends the installment amount) and closes the loan when fully repaid
- Supports liquidation via `liquidate(requestId)` after due date — marks defaulted and releases bookkeeping
- Merchant governance methods for on‑chain reputation: `flagMerchant`, `blockMerchant`, `unblockMerchant` and storage `merchantFlagCount` / `merchantBlocked`

### Gas / UX notes
- `requestCredit` deploys a pocket and forwards funds in the same transaction; callers must supply gas for deployment and funding

### What it does not do
- No interest/accrual model (installments are fixed amounts)
- No price or oracle feeds
- No off‑chain credit scoring (the backend may provide context but not authority)
- The Vault never executes merchant calls — pockets do

---

## 2. `PocketController.sol`

### What it does
- Deterministically deploys pockets (CREATE2) via a factory
- Funds pockets with a minimal gas reserve when created
- Maintains mappings of valid pockets and owners
- Exposes `executeFromPocket(...)` which validates existence and forwards the call to the pocket
- Implements controller-only sweep and burn operations for token handling

### What it does not do
- No credit accounting or loan state — that belongs to the Vault

---

## 3. `Pocket.sol`

### What it does
- Single‑use execution contract that accepts a signed EIP‑712 intent and executes exactly one target call
- Verifies signature, nonce and expiry
- Marks itself used on success to prevent replay
- Can be queried for next nonce and state from off‑chain services

### What it does not do
- Has no access to collateral accounting and cannot alter Vault state

---

## 4. `PocketFactory.sol`

### What it does
- Deploys minimal pocket bytecode under deterministic addresses (CREATE2)
- Emits `PocketCreated` for indexing by the backend

### What it does not do
- No custody and no execution authority beyond providing the contract bytecode

---

## Current End-to-End Flow

1. User deposits BNB via `CollateralVault.deposit()` (user tx).
2. User requests credit through `requestCredit(merchant, amount, installmentCount, interval, salt)` (user tx). Vault verifies parameters and merchant blocklist, increases `positions[borrower].borrowed`, creates & funds a pocket, and emits `CreditRequested`.
3. Backend derives the deterministic pocket address and presents it to the user for signing.
4. The user signs an EIP‑712 Exec intent (pocket, target, dataHash, nonce, expiry).
5. A relayer or backend submits `PocketController.executeFromPocket(pocket, target, calldata, signature, nonce, expiry)` which forwards to `Pocket.exec`.
6. Pocket executes a single call to the merchant; any side effects are contained inside the pocket.
7. After execution the pocket is marked used; logs and events are emitted for indexing.
8. The borrower repays installments via `repayInstallment(requestId)` (user tx). If fully repaid the vault decreases `positions[borrower].borrowed` and emits `LoanClosed`.
9. If a repayment is missed and the due date passes, `liquidate(requestId)` can be called to mark default and perform bookkeeping.

## Off‑chain integration (backend)

- The backend exposes HTTP endpoints used by the frontend and relayer, including `/merchant` routes for status, `/pocket` and `/credit` activity endpoints, and admin routes that call `blockMerchant` / `unblockMerchant` using the configured controller private key when that key is owner of the Vault.

## Invariants

- LTV math is enforced on‑chain by `availableCredit`
- Borrowed amount is decreased only when loan closes or when liquidated
- Merchant block/unblock is an owner‑only operation (backend ensures owner signing)
- Pockets are single‑use and deterministic

---

## Invariants

- LTV math remains fixed and on-chain.
- Borrowed amount does not decrease per installment; only on close or liquidation.
- Merchant blocklist is explicit governance, not auto-triggered by flags.
- Pocket/Controller isolation logic is unchanged by BNPL layer.
- Vault is credit source of truth.

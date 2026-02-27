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
- Accepts user collateral via `deposit()`.
- Computes user credit capacity with fixed LTV via `availableCredit()`.
- Creates installment BNPL loans via:
  - `requestCredit(merchant, amount, installmentCount, interval, salt)`
- Tracks each loan in `creditPositions` with:
  - `principal`, `remaining`, `installmentAmount`, `installmentsPaid`, `totalInstallments`, `interval`, `nextDueDate`, `defaulted`, `closed`, `pocket`.
- Funds newly created pocket with requested principal.
- Accepts installment repayments via `repayInstallment(requestId)`.
- Closes loan only when `remaining == 0`, then decreases `positions[user].borrowed` by full `principal`.
- Liquidates overdue/defaulted loans via `liquidate(requestId)`, and decreases borrowed by full `principal`.
- Maintains merchant governance:
  - `flagMerchant`, `blockMerchant`, `unblockMerchant`
  - `merchantFlagCount`, `merchantBlocked`, `owner`.

### What it does not do
- No off-chain credit scoring.
- No interest calculation.
- No oracle pricing.
- No direct merchant execution.
- No bypass of pocket isolation.

---

## 2. `PocketController.sol`

### What it does
- Creates pockets through factory (`createPocket`).
- Funds each pocket with gas reserve (`GAS_RESERVE`).
- Tracks valid pockets and pocket owner mapping.
- Routes execution (`executeFromPocket`) to `Pocket.exec(...)`.
- Supports sweep and burn routes.

### What it does not do
- No credit accounting.
- No LTV enforcement.
- No loan repayment/default logic.

---

## 3. `Pocket.sol`

### What it does
- Single-use execution wallet.
- Verifies user EIP-712 signature for execution.
- Enforces nonce and expiry.
- Marks itself used after one successful execution.
- Supports controller-only token sweep and signed burn.

### What it does not do
- No credit logic.
- No collateral access.
- No upgrade/admin flow.

---

## 4. `PocketFactory.sol`

### What it does
- Deterministically deploys pockets using CREATE2.
- Emits deployment event.

### What it does not do
- No custody.
- No execution authority.
- No policy logic.

---

## Current End-to-End Flow

1. User deposits collateral into `CollateralVault.deposit()`.
2. User requests BNPL credit with installment terms through `requestCredit(...)`.
3. Vault verifies:
- merchant not blocked
- installment parameters valid
- credit available under LTV
4. Vault increments borrower exposure (`positions[user].borrowed += principal`).
5. Vault asks `PocketController` to create pocket.
6. Vault funds pocket with principal.
7. User signs EIP-712 execution intent for pocket.
8. Relayer/backend submits `PocketController.executeFromPocket(...)`.
9. Pocket executes exactly one merchant call (isolation boundary).
10. User repays installments through `repayInstallment(requestId)` before each due date.
11. If all installments paid:
- loan closes
- borrowed decreases by full principal.
12. If installment due is missed:
- anyone can call `liquidate(requestId)` after `nextDueDate`
- loan defaulted
- borrowed decreases by full principal.

---

## Invariants

- LTV math remains fixed and on-chain.
- Borrowed amount does not decrease per installment; only on close or liquidation.
- Merchant blocklist is explicit governance, not auto-triggered by flags.
- Pocket/Controller isolation logic is unchanged by BNPL layer.
- Vault is credit source of truth.

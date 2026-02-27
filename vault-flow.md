# Vault Flow Cross-Check Report

## Scope
Compared `updated-flow.md` against:
- `contracts/src/CollateralVault.sol`
- `ward-backend/src/routes/credit.js`
- `ward-backend/src/routes/pocket.js`
- `ward-frontend/src/api.ts`
- `ward-frontend/src/components/Dashboard.tsx`

## Contract Authority Model (Actual)
- Credit lifecycle authority is `CollateralVault`.
- User submits vault state-changing actions directly from wallet:
  - `deposit()`
  - `requestCredit(merchant, amount, installmentCount, interval, salt)`
  - `repayInstallment(requestId)`
  - `liquidate(requestId)` (callable when overdue)
- Execution isolation authority remains `Pocket` + `PocketController`.
- Merchant execution is still relayed via `controller.executeFromPocket(...)` using user EIP-712 signature.

## Implemented End-to-End Flow (Current)
1. User connects wallet in frontend.
2. Frontend loads credit dashboard from backend read endpoints:
   - `GET /api/credit/state/:user`
   - `GET /api/credit/request/:requestId`
3. User deposits collateral via direct vault tx (`deposit`).
4. User requests credit via direct vault tx (`requestCredit` with installment params).
5. Frontend parses `CreditRequested` event from receipt and extracts:
   - `requestId`, `pocket`, `nextDueDate`
6. Frontend uses pocket address from event (not user input) to build EIP-712 execution intent.
7. Frontend sends signed payload to backend `POST /api/pocket/execute`.
8. Backend relays `executeFromPocket` through controller.
9. User repays installments via direct vault tx (`repayInstallment`).
10. When `remaining == 0`, vault closes loan and reduces `borrowed` by full `principal`.
11. If overdue (`block.timestamp > nextDueDate`), liquidation marks default and reduces `borrowed` by full `principal`.

## Compatibility Check vs `updated-flow.md`

### Matches
- Vault is source of truth for credit state.
- Pocket execution remains isolated and relayed.
- Frontend uses backend for read + relay, not for off-chain credit authority.
- Merchant block is enforced on-chain in `requestCredit` and reflected in frontend UX.

### Mismatches (Document vs Deployed/Integrated Reality)
- `updated-flow.md` uses old request signature:
  - Document: `requestCredit(merchant, amount, duration)`
  - Actual: `requestCredit(merchant, amount, installmentCount, interval, salt)`
- `updated-flow.md` assumes single repayment:
  - Document: `repay(requestId)`
  - Actual: `repayInstallment(requestId)` with installment due logic
- `updated-flow.md` references old request state semantics (`dueDate`/single-cycle)
  - Actual state is BNPL struct:
    - `principal`, `remaining`, `installmentAmount`, `installmentsPaid`, `totalInstallments`, `interval`, `nextDueDate`, `defaulted`, `closed`, `pocket`

## Backend Integration Status
- Uses correct BNPL vault methods:
  - `/api/credit/request` calls `requestCredit(... installmentCount, interval, salt)`
  - `/api/credit/repay` calls `repayInstallment(requestId)`
  - `/api/credit/liquidate` calls `liquidate(requestId)`
- Uses wei-safe `BigInt` handling for request and repay values.
- Returns BNPL fields and computes current `installmentDue` from on-chain state.
- Does not store flags off-chain; merchant status is read from contract mappings.

## Frontend Integration Status
- Sends `installmentCount` and `intervalSeconds` for request flow.
- Parses `CreditRequested` event and uses emitted pocket.
- Displays BNPL fields (`remaining`, installment counters, `nextDueDate`, `installmentDue`, `defaulted`, `closed`).
- Repays using `repayInstallment` with server-provided/chain-derived installment due.
- Prevents repay when `defaulted` or `closed`.
- Disables credit request UI if merchant is blocked.

## Final Flow You Are Following
You are following the **BNPL collateral flow** (not the old single-repay flow):
- Credit is created and enforced on-chain by `CollateralVault` with installments.
- Execution remains isolated in pockets and relayed by backend.
- Repayment and default outcomes are fully vault-governed.
- Frontend/backend currently align with deployed BNPL interface.

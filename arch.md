# Ward BNPL Integration Architecture (BSC Testnet Deployed)

## Deployed On-Chain Authority

### CollateralVault (source of truth)
- `deposit()`
- `availableCredit(address user)`
- `requestCredit(address merchant, uint256 amount, uint256 installmentCount, uint256 interval, uint256 salt)`
- `repayInstallment(bytes32 requestId)`
- `liquidate(bytes32 requestId)`
- `creditPositions(bytes32)` returns:
  - `principal`
  - `remaining`
  - `installmentAmount`
  - `installmentsPaid`
  - `totalInstallments`
  - `interval`
  - `nextDueDate`
  - `defaulted`
  - `closed`
  - `pocket`
- Merchant governance:
  - `merchantFlagCount`
  - `merchantBlocked`
  - `flagMerchant`
  - `blockMerchant`
  - `unblockMerchant`

### Isolation layer (unchanged)
- `PocketController.executeFromPocket(...)`
- `Pocket` EIP-712 single-use execution

## Runtime System Flow (intended)
1. User deposits collateral directly to `CollateralVault`.
2. User requests credit directly with installment params.
3. Vault creates and funds pocket through controller.
4. Frontend builds EIP-712 exec intent.
5. Backend relays `executeFromPocket`.
6. User repays installment(s) via `repayInstallment`.
7. Loan closes when `remaining == 0`, otherwise can default and be liquidated after due date.

## Integration Status Review

## Breaking Issues

1. Backend ABI is stale and incompatible with deployed BNPL struct/methods.
- File: `ward-backend/src/abi/CollateralVault.json`
- Problem:
  - `requestCredit` encoded as `(merchant, amount, duration, salt)` (4 args)
  - has `repay(bytes32)` (non-existent)
  - `creditPositions` outputs old fields (`amount`, `dueDate`, `repaid`, `pocket`)
- Impact:
  - Backend cannot safely call or decode current deployed contract.

2. Backend credit route calls old methods and old field names.
- File: `ward-backend/src/routes/credit.js`
- Problems:
  - Calls `vault.requestCredit(merchant, requestedAmount, requestedDuration, requestedSalt)` (old 4-arg form).
  - Calls `vault.repay(requestId, { value: ... })` (method no longer exists).
  - Reads `creditPosition.dueDate`, `creditPosition.amount`, `creditPosition.repaid` (no longer present).
  - Expects `CreditRequested` event arg `dueDate` (event now emits `nextDueDate` and installment metadata).
- Impact:
  - Request/repay endpoints are broken against deployed BNPL vault.

3. Frontend Vault ABI is stale and encodes wrong methods/events.
- File: `ward-frontend/src/api.ts`
- Problems:
  - Uses `requestCredit(address,uint256,uint256,uint256)` with `duration` instead of `(installmentCount, interval)`.
  - Uses `repay(bytes32)` instead of `repayInstallment(bytes32)`.
  - Parses `CreditRequested(... amount, dueDate)` instead of BNPL event fields.
- Impact:
  - Frontend transactions for request/repay fail or parse incorrectly.

4. Frontend request payload semantics are wrong for BNPL.
- File: `ward-frontend/src/components/Dashboard.tsx`
- Problems:
  - UI input `durationSeconds` is sent as third arg to `requestCredit` where deployed contract expects `installmentCount`.
  - No `interval` input exists.
- Impact:
  - Loan terms sent from frontend do not match deployed contract semantics.

5. Frontend repayment/default state logic assumes old single-repay model.
- File: `ward-frontend/src/components/Dashboard.tsx`
- Problems:
  - Request state assumes fields: `amount`, `dueDate`, `repaid`.
  - Repay button attempts full repayment by sending `requestState.amount` once.
- Impact:
  - Cannot represent/installment lifecycle (`remaining`, `installmentsPaid`, `closed`, `defaulted`, `nextDueDate`).

## Incorrect Assumptions

1. Backend and frontend both assume old full-repayment loans (`repay`) instead of installment loans (`repayInstallment`).
2. Integration assumes `creditPositions` has `dueDate/repaid/amount`; deployed vault uses `nextDueDate/closed/defaulted/remaining/principal`.
3. Request flow assumes credit request takes `duration`; deployed vault requires `installmentCount` + `interval`.

## End-to-End Compatibility Conclusion

- Current end-to-end path `deposit -> requestCredit -> execute -> repayInstallment -> close` is **not fully compatible** in the existing backend/frontend integration.
- Isolation path itself (`pocket execute relay`) remains aligned in principle, but is blocked by upstream credit/request state mismatches.


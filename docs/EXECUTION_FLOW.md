# EXECUTION_FLOW.md — Ward
## 1. User-visible flow 

The `ward-frontend` implements a dashboard and governance controls that map to the on‑chain and backend routes in this repository. Key user steps:

1. Connect wallet (BSC Testnet)
2. Deposit BNB via `CollateralVault.deposit()` using the Deposit card
3. Enter merchant address and "Check Merchant" to call backend `/merchant/:address` (reads `merchantFlagCount` and `merchantBlocked` from the Vault)
4. Request credit (`requestCredit` on the Vault) — this TX deploys a pocket and funds it; the UI captures the `CreditRequested` event (pocket address and next due date)
5. User signs an EIP‑712 Exec intent for the pocket (off‑chain signature)
6. Relayer calls backend `POST /pocket/execute` (or equivalent) which calls `PocketController.executeFromPocket(...)` — the pocket executes exactly one call
7. UI reflects execution results and activity (pocket creation, execution events, repayments)

## 2. Backend (off‑chain) alignment

- The Express API (`ward-backend/src/routes`) provides:
  - `/merchant/:address` — reads on‑chain `merchantFlagCount` and `merchantBlocked`
  - `/merchant/flag`, `/merchant/block`, `/merchant/unblock` — flag uses backend signer; block/unblock require backend signer to be Vault owner
  - `/pocket/execute` and other activity endpoints used to relay executions and index events
- Backend derives deterministic pocket addresses (CREATE2) and provides nonces and signature validation helpers to the frontend

## 3. On‑chain flow and guardrails

1. `CollateralVault.requestCredit` performs checks and then calls `PocketController.createPocket` and funds it. The emitted `CreditRequested` is the canonical record.
2. `PocketController.createPocket` (CREATE2) and `PocketController.executeFromPocket` are the only paths that lead to `Pocket.exec` being invoked.
3. `Pocket.exec` verifies the EIP‑712 signature, checks nonce/expiry and executes exactly one target call.
4. After execution, the pocket is marked used and logs are emitted; the controller/pocket provide token sweep and burn routes controlled by the controller where applicable.

## 4. Failure handling and guarantees

- Pocket compromise is possible but loss is limited to the funded amount.
- Backend classification/simulation failures do not affect on‑chain guarantees; they only affect UX guidance.
- Admin operations in backend (block/unblock) are gated: `requireBackendOwner` ensures the backend signer matches the Vault owner before calling owner‑only methods.

## 5. Mapping to code files

- Frontend: `ward-frontend/src/components/Dashboard.tsx` — all user actions (deposit, request credit, flag, block, unblock, execute, repay)
- API helpers: `ward-frontend/src/api.ts` — wraps backend endpoints and on‑chain contract calls
- Backend routes: `ward-backend/src/routes/merchant.js`, `pocket.js`, `credit.js`, `activity.js` — these endpoints implement relayer and governance logic
- Contracts: `contracts/src/CollateralVault.sol`, `PocketController.sol`, `Pocket.sol`, `PocketFactory.sol`

This file (and the codebase) are aligned: UI actions call API helpers, API calls backend routes, backend calls Vault/Controller, and contracts emit events which backend indexes for the UI.
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


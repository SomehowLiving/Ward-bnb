# Ward — Product Requirements Document (PRD)

## 1. Product Summary

**Ward** is a wallet-layer security system that protects users from malicious on-chain interactions by executing risky actions inside **isolated, disposable smart-wallet “pockets”**.

Instead of relying only on warnings, Ward enforces **physical isolation at execution time**, ensuring that even if a user interacts with a malicious contract, losses are limited to a small, predefined pocket and never affect the main wallet.

---

## 2. Problem Statement

Crypto users routinely lose funds due to:

- Approval-drainer scams (`setApprovalForAll`, infinite allowances)
- Malicious airdrops and claim contracts
- Honeypot tokens and transfer-restricted assets
- Phishing dApps and fake frontends

Existing security tools are primarily **detective**:

- browser warnings
- signature previews
- static scanners

These tools fail when:

- users ignore warnings,
- attacks execute faster than users can react,
- or contracts behave maliciously only after interaction.

**Detection alone does not prevent loss.**

---

## 3. Core Insight

> The only reliable way to prevent catastrophic loss is execution isolation, not better warnings.
> 

Ward introduces **transaction-level isolation**:

- every risky interaction is executed from a disposable pocket,
- pockets have limited funds and permissions,
- compromise is contained by design.

---

## 4. Goals & Non-Goals

### Product Goals

- Prevent main-wallet drains even when users interact with malicious contracts
- Provide gasless, low-friction UX for airdrop claims
- Make risk containment the default behavior
- Be ecosystem-agnostic (EVM-compatible chains)

### Non-Goals (explicitly out of scope for v1)

- Perfect scam detection
- Preventing users from losing money inside pockets
- Full cross-chain support
- Decentralized relayer marketplace
- DAO governance

---

## 5. Target Users

### Primary

- Airdrop farmers
- DeFi power users
- Users interacting with unknown/new protocols

### Secondary

- Casual users who occasionally claim airdrops
- Wallet providers integrating Ward as a safety layer

---

## 6. Core Product Concept

### Key Objects

| Object | Description |
| --- | --- |
| Main Wallet | User’s EOA (MetaMask, etc). Used only for identity & signatures. |
| Pocket | Disposable smart-wallet used for exactly one risky interaction. |
| PocketFactory | Contract that creates pockets deterministically. |
| PocketController | Contract that routes execution and enforces policy. |
| Relayer | Off-chain service that submits gas-paid transactions. |
| Risk Engine | Backend service that classifies token/contract risk. |

---

## 7. High-Level User Flow

### Setup (one-time)

1. User connects wallet
2. User initializes Ward
3. User deposits small amount (e.g. $20–$50)
4. System creates N pre-funded pockets
5. Dashboard shows available pockets

### Risky Interaction

1. User clicks “Claim Airdrop”
2. Ward analyzes target
3. System routes interaction to a pocket
4. User signs an off-chain intent
5. Relayer executes transaction
6. Pocket absorbs all risk

### Post-Execution

- If safe → tokens may be swept to main wallet
- If malicious → pocket drained, main wallet untouched
- User decides next action if uncertain

---

## Pocket Funding Model

### Design

- User deposits ETH **only into PocketController**
- Pockets are created **on-demand**, not pre-funded
- Controller funds pocket at creation time

### Parameters

- Pocket gas reserve: **0.005 ETH** (configurable)
- Max pocket value: **0.05 ETH equivalent**
- Auto-refill prompt when controller balance < **0.01 ETH**

## Chain Configuration (Avalanche C-Chain)
| Parameter             | Value     | Rationale                               |
| --------------------- | --------- | --------------------------------------- |
| Pocket gas reserve    | 0.01 AVAX | Covers ~10 transactions at 50 nAVAX/gas |
| Max pocket value      | 0.5 AVAX  | ~\$20 limit per interaction             |
| Auto-refill threshold | 0.1 AVAX  | Prompt when <4 pockets can be funded    |

### Rationale

- Avoids wasted capital
- Adapts to gas volatility
- Enforces loss ceiling per interaction

## 8. Trust & Security Model (Critical)

### Hard Guarantees

- Main wallet **never executes risky calls**
- Main wallet **never grants approvals to unknown contracts**
- Compromise of a pocket **cannot affect other pockets or main wallet**
- Every execution requires a user signature with strict scope

### Explicit Limitations

- Pocket funds can be lost
- Honeypot tokens may be worthless
- Backend risk classification is probabilistic

---

## 9. Risk Classification Model (Authoritative Policy)

Ward uses a **four-tier confidence model**.

### Tier 1 — Explicitly Malicious

**Signals**

- Blacklisted address
- Known honeypot bytecode
- `transfer()` always reverts
- 100% transfer tax

**Action**

- Auto-abandon pocket
- No sweep
- Inform user
- No fee
- Pocket optionally burned

---

### Tier 2 — Explicitly Safe (Auto-sweep, 2% fee)

**Signals**

- Verified contract
- Bytecode exactly matches **audited, known source**
- Deployer or token on **on-chain whitelist**
- Transfer + DEX sell simulation returns **>98% expected value**
- `estimateGas(transfer) < 80k`
- No external calls inside `transfer()` (pre-transfer hooks)
- No state-dependent logic

**Action**

- Auto-sweep to main wallet
- Protocol fee: 2%
- User notified post-fact

> Whitelist-only auto-sweep is mandatory. 
> Heuristics alone are insufficient and unsafe.> 

---

### Tier 3 — Unsafe / Simulation Failed (Force Withdraw)

**Signals**

- Unverified or obfuscated code
- Transfer tax 5–15%
- Simulation revert
- Gas griefing (>200k gas)
- Economic extraction detected

**Action**

- Funds remain isolated
- Hold tokens in pocket
- Require explicit “Force Withdraw”
- Protocol fee: 8%

---

### Tier 4 — Provisional Safe (User-confirmed)

**Signals**

- Simulation passes
- But stateful logic detected (`block.number`, blacklists)
- Confidence 60–90%

**Action**

- Require explicit user confirmation
- Protocol fee: 3%
- No auto-sweep

---

## 10. Backend Responsibilities

### Risk Engine

- Static bytecode analysis
- Contract metadata checks
- Known scam database lookup
- Confidence scoring

### Simulation Engine

- `eth_call` transfer simulation
- `estimateGas` checks
- Forked-chain sell simulation (DEX)
- Cache results for 10 minutes

### Simulation Cost Control

- Backend pays for simulations
- 3 free simulations/user/day
- Beyond limit: require signed meta-intent
- Cache results globally for **10 minutes**

### Policy Enforcement

- Tier assignment
- Auto-sweep eligibility
- UI messaging

---

## 11. Smart Contract Responsibilities

### Pocket

- Stores owner address
- Executes exactly one authorized call
- Verifies EIP-712 signatures
- Enforces nonce & expiry
- Can transfer owned assets only

### PocketFactory

- Creates pockets via CREATE2
- Supports batch creation
- Minimal persistent state

### PocketController

- Routes execution
- Triggers sweeps
- Enforces fee capture
- Holds no long-term user funds
- Enforces fee logic **on-chain**
- Calculates tier-based fee
- Sends fee to protocol treasury
- Relayer reimbursed separately

> Relayers never touch user assets.
> 

---

## 12. Relayer Responsibilities

- Receive signed intents
- Verify signature, nonce, expiry
- Pay gas for execution
- Call controller methods
- Capture protocol fees
- Receive gas reimbursement
- No fee custody
- No asset authority

Relayer is **non-custodial** and **replaceable**.

---

## 13. UX Principles

- Default to safety
- Never surprise users with asset movement
- Clearly distinguish:
    - “Probably safe”
    - “Confirmed safe”
    - “Unsafe”
- Force Withdraw UX must be explicit and cautionary

### Force Withdraw UX (Tier 3 — mandatory)

Before button enables:

- Display failure reason + stats
    
    (“38% of similar tokens are honeypots”)
    
- Show dollar amount being moved
- Checkbox: *“I understand this token may be malicious”*
- **30-second cooldown timer**

This is non-negotiable.

---

## 14. Metrics (Success Criteria)

### Security

- Zero main-wallet drains
- Pocket loss limited to configured cap
- Average loss per pocket
- Auto-sweep vs force-withdraw ratio
- Simulation cache hit rate
- Relayer gas reimbursement rate

### UX

- < 2 clicks to claim safely
- < 1 signature per action

### Adoption

- Pockets used per user
- % claims routed via pocket
- Auto-sweep rate vs manual

---

## 15. Phased Delivery Plan

### Phase 0 — Hackathon MVP (Must Ship)

**Goal:** Prove isolation works.

**Scope**

- Pocket + Controller contracts
- Basic relayer
- Simple frontend
- Fake malicious airdrop demo
- Tier 1–3 logic (no DEX sell sim)

**Deliverable**

- Live demo: pocket drained, main wallet safe

---

### Phase 1 — Production MVP

**Goal:** Usable by real users.

**Add**

- Tier 4 logic
- DEX sell simulation
- Force Withdraw UX
- Fee capture
- Caching & rate limits

---

### Phase 2 — Advanced Protection

**Add**

- Social recovery for pockets
- Pocket burner (destroy pockets holding toxic assets)
- Relayer refund buffer (staked gas insurance for failed transactions)
- Multiple relayers (decentralize execution)
- Advanced simulation heuristics (improve detection accuracy)
- Wallet extension integration (MetaMask Snap, Core Wallet plugin)

---

### Phase 3 — Ecosystem Expansion

**Add**

- Cross-chain pockets
- Relayer marketplace
- Wallet SDK
- Enterprise integrations

---

## 16. Explicit Out-of-Scope Items (for clarity)

- Perfect scam detection
- Full DAO governance
- Non-EVM chains
- Automated trading / selling
- Custodial asset management
- Token price accuracy guarantees
- Rug-pull prediction
- Post-sweep protection
- Recovery of drained pockets

---

## 17. One-Sentence Product Definition (for judges)

> Ward prevents catastrophic wallet drains by executing risky on-chain actions inside disposable smart-wallet pockets, limiting loss by design instead of relying on warnings.
> 

---

## 18. What to Build First (Engineering Order)

1. Pocket + Controller contracts
2. Signature verification & nonce logic
3. Relayer execution path
4. Basic risk classification
5. Minimal UI
6. Demo scenario
# SECURITY.md — Ward

## Overview

Ward is designed to **prevent catastrophic wallet loss** by isolating risky on-chain interactions inside disposable smart-wallet “pockets.”
This document describes Ward’s **security model, trust assumptions, threat boundaries, attacker models, mitigations, and explicit non-guarantees**.

This is not a promise of perfect safety. It is a clear statement of **what Ward protects, how it protects it, and where responsibility shifts to the user**.

---

## Core Security Principle

> **The main wallet never executes risky logic.**

All risky interactions are executed from **isolated, single-use pocket contracts** with:

* limited funds,
* no authority over the main wallet,
* and strictly scoped, signature-based permissions.

Loss is **contained by design**, not prevented by heuristics alone.

---

## Security Goals

Ward aims to guarantee:

1. **Main wallet isolation**

   * The user’s main wallet is never exposed to malicious contracts.
2. **Bounded loss**

   * Maximum loss per interaction is capped by the pocket’s funding limit.
3. **No approval escalation**

   * The main wallet never grants approvals to unknown contracts.
4. **Explicit user authority**

   * Every execution requires a user signature with strict scope.
5. **Non-custodial operation**

   * Neither Ward nor relayers can unilaterally move user funds.

---

## Explicit Non-Goals

Ward does **not** guarantee:

* That users will never lose money (pocket funds can be lost).
* That a token has real-world or USD value.
* That a “safe” token cannot rug later.
* That scam detection is perfect.
* That post-sweep assets remain protected.

Once assets are swept to the main wallet, **standard wallet risk applies**.

---

## Trust Model

### Trusted Components

| Component        | Trust Level              | Rationale                                  |
| ---------------- | ------------------------ | ------------------------------------------ |
| Main Wallet      | Fully trusted            | User-controlled private keys               |
| Pocket Contracts | Trusted                  | Minimal, auditable, single-purpose         |
| PocketController | Trusted with constraints | No permanent custody, on-chain enforcement |
| Backend          | Semi-trusted             | Advisory only, cannot move funds           |
| Relayers         | Minimally trusted        | Pay gas only, no asset authority           |

### Untrusted Components

* Target contracts (airdrops, DeFi, NFTs)
* Tokens received from unknown contracts
* External frontends and websites
* RPC providers (assumed honest-but-fallible)

## User-Visible Failure Modes & Asset Containment

Ward is designed so that **loss is visible, bounded, and non-propagating**.
Users may realize an interaction was malicious at different stages. All cases are explicitly handled.

### Case A — Immediate Pocket Drain

**What happens**

* Pocket executes a malicious contract
* Pocket balance is drained immediately
* Main wallet remains unchanged

**Security interpretation**

* This is expected behavior
* Loss is limited to the pocket’s funding cap
* No further action is possible or required

**Guarantee**

* Main wallet was never exposed
* No approvals or permissions persist

---

### Case B — Toxic Asset (Delayed Realization)

**What happens**

* Pocket receives a token that is:

  * honeypot,
  * transfer-restricted,
  * heavily taxed,
  * or economically malicious
* No immediate drain occurs

**When the user realizes**

* Transfer attempt fails
* Sell simulation fails
* Gas usage spikes
* Output value collapses

**Security interpretation**

* This is **not a wallet drain**
* This is a *toxic asset*
* Ward’s responsibility is **containment**, not asset redemption

**Policy**

* Assets remain isolated by default
* No automatic sweep occurs
* User must explicitly accept risk to move assets

---

### Case C — False Alarm / User Panic

**What happens**

* User sees an unfamiliar token
* No malicious behavior occurs

**Security interpretation**

* No security failure
* This is a UX / messaging concern, not a protocol issue

---

## Asset Movement Policy (Pocket → Main Wallet)

Ward supports three asset outcomes. At least two must always be available.

### 1. Auto-Sweep (Explicitly Safe Only)

* Allowed only under Tier 2 conditions
* Enforced by on-chain rules
* No user action required

### 2. User-Triggered Withdraw (Explicit Risk Acceptance)

* User signs a separate intent
* Backend warnings are shown
* Assets move only after confirmation

### 3. Abandon / Burn

* Recommended for malicious or non-transferable assets
* Pocket can be destroyed
* Assets become permanently inaccessible

This behavior is intentional and honest.

---

## Why Ward Does NOT Auto-Transfer by Default

Automatically sweeping all received assets would:

* Introduce honeypots into the main wallet
* Allow griefing via malicious ERC20 hooks
* Shift blame to Ward for asset toxicity

**Security rule**

> Assets must never move from a pocket to the main wallet without an explicit safety decision (automatic or user-confirmed).

---

## Backend vs User Authority (Security Boundary)

* Backend may **classify and simulate**
* Backend may **recommend**
* Backend may **block automation**

Backend may **never**:

* move user assets,
* mark assets “100% safe”,
* override user intent.

Final authority always rests with:

* deterministic on-chain rules, or
* explicit user signature.

---

## Key Invariant

> A wallet drain requires permission.
> The main wallet never grants permission.
> Therefore, the main wallet cannot be drained.

---

## Authority & Permission Model

### Main Wallet

The main wallet is used **only for**:

* Identity (public address)
* Off-chain message signatures (EIP-712)

The main wallet **never**:

* Executes risky transactions
* Grants token approvals
* Interacts directly with unknown contracts

---

### Pocket Contracts

Each pocket:

* Has a single owner (main wallet address)
* Is created lazily for one execution
* Can execute exactly one authorized call
* Cannot call arbitrary targets without a valid signature
* Is never reused

---

### Authorization Mechanism

All execution authority flows via **explicit, scoped signatures**:

A signed intent authorizes:

* One pocket
* One target contract
* One calldata payload
* One nonce
* One expiry window

Signatures cannot be replayed or broadened.

---

## Asset Flow Rules

Allowed flows:

* Pocket → Target contract (during execution)
* Target contract → Pocket (tokens received)
* Pocket → Main wallet (explicit sweep only)

Disallowed flows:

* Target contract → Main wallet
* Pocket → arbitrary external contracts (outside authorized call)
* Main wallet → Pocket approvals

---

## Pocket Funding & Loss Caps

* Pockets are funded **at creation time** by the PocketController.
* Funding amount is fixed and configurable (e.g. 0.005 ETH).
* Each pocket has a **hard maximum value cap** (e.g. 0.05 ETH equivalent).

This enforces an upper bound on loss per interaction.

---

## Risk Classification & Automation Safety

Ward uses a **four-tier risk model**.
Automation is deliberately conservative.

### Auto-Sweep (Tier 2) Safety Rules

A token is auto-swept **only if all conditions are met**:

* Bytecode matches an audited, known implementation.
* Deployer or token address is on an on-chain whitelist.
* Transfer simulation passes.
* DEX sell simulation returns >98% expected value.
* Gas usage is within normal bounds.
* No external calls inside `transfer()`.

If **any condition fails**, auto-sweep is disabled.

---

## User-Triggered Risk Acceptance

For uncertain or unsafe tokens:

* Assets remain isolated in the pocket.
* User must explicitly sign a **Force Withdraw** intent.
* UI enforces:

  * clear warnings,
  * value disclosure,
  * explicit acknowledgment,
  * cooldown timer.

This ensures **informed consent**.

---

## Fee Enforcement & Custody

* All protocol fees are calculated **on-chain** by PocketController.
* Fees are sent directly to a protocol treasury contract.
* Relayers **never custody or extract fees from user assets**.
* Relayers are reimbursed separately for gas costs.

This prevents fee theft and relayer abuse.

---

## Threat Model & Mitigations

### 1. Malicious Contract / Airdrop

**Threat:** Contract drains funds or behaves maliciously.

**Mitigation:**

* Execution occurs inside pocket.
* Loss limited to pocket balance.
* Main wallet untouched.

**Residual Risk:** Pocket funds may be lost (expected).

---

### 2. Approval Drainer Attacks

**Threat:** Contract tricks user into granting approvals.

**Mitigation:**

* Main wallet never approves unknown contracts.
* Pockets do not hold approvals beyond execution.

---

### 3. Honeypot / Tax Tokens

**Threat:** Tokens cannot be sold or have hidden taxes.

**Mitigation:**

* Sell simulations where possible.
* Tokens held in pocket by default.
* User-controlled withdrawal only.

---

### 4. Backend Compromise

**Threat:** Backend attempts to steal funds or modify execution.

**Mitigation:**

* Backend cannot sign transactions.
* Backend cannot move funds.
* All execution requires user signature + on-chain verification.

---

### 5. Relayer Abuse or Censorship

**Threat:** Relayer censors or frontruns transactions.

**Mitigation:**

* Relayers are replaceable.
* User signatures are portable.
* Multiple relayers can be supported.

---

### 6. CREATE2 Address Predictability

**Threat:** Adversary predicts pocket addresses and dusts or griefs them.

**Mitigation:**

* CREATE2 salts include user nonce + controller epoch.
* Salts are not revealed until deployment.
* Pockets accept inbound transfers only after arming.

---

### 7. Controller Compromise (Worst Case)

**Threat:** Controller logic compromised.

**Mitigation:**

* Controller holds no long-term user funds.
* All sweeps require user signature (except whitelisted auto-sweep).
* Upgrades gated by multisig.
* Emergency pause available.

---

## Known Limitations

* Ward cannot recover funds already drained from a pocket.
* Ward does not guarantee token value or liquidity.
* Some stateful scams may evade simulation.
* Gas price spikes can reduce effective pocket coverage.
* NFT-specific attacks may require manual pocket burning.

These limitations are **explicit by design**.

---

## Responsible Disclosure

If you discover a vulnerability:

* Do **not** exploit it.
* Do **not** disclose publicly.
* Contact the team via the repository’s security contact.

We commit to:

* Prompt acknowledgement
* Responsible fixes
* Public disclosure after patching

---

> Ward does not try to make users smarter.
> It makes mistakes survivable.

By enforcing **execution isolation, bounded loss, and explicit consent**, Ward shifts crypto security from *best-effort detection* to *guaranteed containment*.

---

> **If a pocket is compromised, the main wallet remains safe.**


---

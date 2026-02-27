# HIGH LEVEL FLOW:

```markdown
┌───────────────────────────────┐
│            USER               │
│  EOA (Main Wallet)            │
│  - Identity only              │
│  - Signs EIP-712 intent       │
└───────────────┬───────────────┘
                │
                │ (1) Risky Action Initiated
                ▼
┌───────────────────────────────┐
│           FRONTEND            │
│  - Intercepts interaction     │
│  - Displays risk status       │
│  - Requests signature         │
└───────────────┬───────────────┘
                │
                │ (2) Metadata: target, calldata, chainId
                ▼
┌───────────────────────────────┐
│            BACKEND            │
│  Risk Engine + Simulation     │
│  - Static analysis            │
│  - Blacklist lookup           │
│  - Tier classification        │
│  - Fork simulation            │
└───────────────┬───────────────┘
                │
                │ (3) EIP-712 Intent Built
                ▼
┌───────────────────────────────┐
│             USER              │
│  Signs Intent (Gasless)       │
│  - Pocket address             │
│  - Target contract            │
│  - Calldata hash              │
│  - Nonce + Expiry             │
└───────────────┬───────────────┘
                │
                │ (4) Signed Intent
                ▼
┌───────────────────────────────┐
│            RELAYER            │
│  - Verifies format            │
│  - Pays AVAX gas              │
│  - Submits transactions       │
└───────────────┬───────────────┘
                │
                │ (5) createPocket()
                ▼
┌───────────────────────────────┐
│       POCKET CONTROLLER       │
│  - Deploy pocket (CREATE2)    │
│  - Fund with capped AVAX      │
│  - Record ownership           │
└───────────────┬───────────────┘
                │
                │ (6) executeFromPocket()
                ▼
┌───────────────────────────────┐
│            POCKET             │
│  Single-use smart wallet      │
│  - Verify signature           │
│  - Verify nonce + expiry      │
│  - Execute target.call()      │
│  - Mark as used               │
└───────────────┬───────────────┘
                │
                │ (7) Risky Execution
                ▼
┌───────────────────────────────┐
│      UNTRUSTED CONTRACT       │
│  Airdrop / DeFi / Token       │
└───────────────┬───────────────┘
                │
                │ (8) Result Handling
                ▼
┌────────────────────────────────────────────┐
│        POST-EXECUTION RESOLUTION           │
│                                            │
│  A) Drained → Mark COMPROMISED             │
│  B) Safe → Auto-sweep to main wallet       │
│  C) Uncertain → Await user confirmation    │
│  D) Toxic → Burn pocket                    │
└────────────────────────────────────────────┘

```

---

# User flow:

```mermaid
---
config:
  layout: dagre
---
flowchart TB
    U["User - Main Wallet EOA"] -- Clicks Claim --> F["Ward Frontend"]
    F -- Send target + calldata --> B["Backend - Risk Engine + Simulation"]
    B -- Return risk tier --> F
    F -- "User signs EIP-712 intent" --> U
    U -- Signed intent --> R["Relayer - Pays AVAX Gas"]
    R -- createPocket --> C["PocketController Avalanche Fuji"]
    C -- Deploy + fund pocket --> P["Pocket - Single Use Smart Wallet"]
    R -- executeFromPocket --> C
    C -- Route execution --> P
    P -- "target.call" --> T["Untrusted Contract"]
    T --> P
    P -- Post execution --> C
    C --> S1["Drained - Loss Capped to Pocket"] & S2["Safe Token - Auto Sweep to Main Wallet"] & S3["Uncertain Token - Await User Decision"] & S4["Toxic Token - Burn Pocket"]
```
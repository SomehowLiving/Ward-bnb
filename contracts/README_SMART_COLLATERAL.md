# Smart Collateral BNPL Demo (Ward Execution Isolation)

This demo adds a fixed-LTV collateral vault to the existing Ward pocket architecture without changing `Pocket.sol` isolation logic.

## Contracts

- `src/CollateralVault.sol`
- `src/MerchantGood.sol`
- `src/MerchantMalicious.sol`

## What It Does

1. User deposits native collateral (ETH/BNB).
2. Available credit is `deposited * 70 / 100 - borrowed`.
3. User requests credit:
- Vault verifies credit limit.
- Vault calls `PocketController.createPocket(user, salt)`.
- Vault funds the returned pocket with requested credit amount.
- Vault stores credit position (`amount`, `dueDate`, `repaid`, `pocket`).
4. Pocket execution remains isolated by existing Ward EIP-712 + single-use execution rules.
5. User can repay exact amount to close position.
6. If due date passes, anyone can liquidate the position.

## Security Boundaries Preserved

- No changes to `Pocket.sol`.
- No changes to EIP-712 execution authorization.
- No changes to `PocketController.executeFromPocket` or sweep logic.
- Single-chain, native-collateral only.
- No oracles, scoring, cross-chain, installments, or multi-asset features.

## Deploy

Set env vars:

```bash
export PRIVATE_KEY=<deployer_private_key>
export TREASURY_ADDRESS=<treasury_address>
```

Deploy:

```bash
cd contracts
forge script script/CollateralDemo.s.sol:DeployCollateralDemo \
  --rpc-url <RPC_URL> \
  --broadcast
```

Save emitted addresses for the next script.

## Run Demo Flow

Set env vars:

```bash
export BORROWER_PRIVATE_KEY=<borrower_private_key>
export POCKET_CONTROLLER=<controller_address>
export COLLATERAL_VAULT=<vault_address>
export MERCHANT_GOOD=<merchant_good_address>
export MERCHANT_MALICIOUS=<merchant_malicious_address>
```

Run flow script:

```bash
forge script script/CollateralDemo.s.sol:RunCollateralDemo \
  --rpc-url <RPC_URL> \
  --broadcast
```

Flow executed by script:

1. Deposit collateral.
2. Request credit for good merchant and malicious merchant (separate pockets).
3. Execute good merchant purchase via pocket.
4. Execute malicious merchant purchase via pocket (drain attempt occurs inside merchant).
5. Print vault balance before/after malicious call to show vault isolation.
6. Repay one request.
7. Open short-duration request, advance block/time (for local/anvil style flow), liquidate after due date.

## Notes

- `RunCollateralDemo` uses `vm.roll` and `vm.warp` to force liquidation timing; this works in local/anvil execution and simulation contexts.
- On public testnets, liquidation should be sent in a later transaction after due date has naturally passed.

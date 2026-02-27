import express from "express";

import { controllerSigner, getVaultContract } from "../config/chain.js";
import { decodeEthersError } from "../utils/errors.js";
import { requireAddress, ValidationError } from "../utils/validate.js";

const router = express.Router();

async function requireBackendOwner(vault) {
  const [backendSigner, vaultOwner] = await Promise.all([
    controllerSigner.getAddress(),
    vault.owner()
  ]);
  if (backendSigner.toLowerCase() !== vaultOwner.toLowerCase()) {
    throw new ValidationError("Backend signer is not vault owner");
  }
}

router.get("/:address", async (req, res) => {
  try {
    const merchant = req.params.address;
    requireAddress(merchant, "merchant");

    const vault = getVaultContract();
    const [flagCount, blocked] = await Promise.all([
      vault.merchantFlagCount(merchant),
      vault.merchantBlocked(merchant)
    ]);

    res.json({
      merchant,
      flagCount: flagCount.toString(),
      blocked
    });
  } catch (err) {
    const status = err instanceof ValidationError ? 400 : 500;
    res.status(status).json({
      error: err instanceof ValidationError ? err.message : decodeEthersError(err)
    });
  }
});

router.post("/block", async (req, res) => {
  try {
    const { merchant } = req.body ?? {};
    requireAddress(merchant, "merchant");

    const vault = getVaultContract();
    await requireBackendOwner(vault);

    const tx = await vault.blockMerchant(merchant);
    const receipt = await tx.wait();

    res.json({ merchant, blocked: true, txHash: receipt.hash });
  } catch (err) {
    const status = err instanceof ValidationError ? 403 : 500;
    res.status(status).json({
      error: err instanceof ValidationError ? err.message : decodeEthersError(err)
    });
  }
});

router.post("/unblock", async (req, res) => {
  try {
    const { merchant } = req.body ?? {};
    requireAddress(merchant, "merchant");

    const vault = getVaultContract();
    await requireBackendOwner(vault);

    const tx = await vault.unblockMerchant(merchant);
    const receipt = await tx.wait();

    res.json({ merchant, blocked: false, txHash: receipt.hash });
  } catch (err) {
    const status = err instanceof ValidationError ? 403 : 500;
    res.status(status).json({
      error: err instanceof ValidationError ? err.message : decodeEthersError(err)
    });
  }
});

export default router;

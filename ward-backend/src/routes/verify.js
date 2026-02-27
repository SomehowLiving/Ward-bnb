import express from "express";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";

import { provider } from "../config/chain.js";
import { requireAddress } from "../utils/validate.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Load ABI correctly (FIX: use .abi)                                         */
/* -------------------------------------------------------------------------- */

const PocketABI = JSON.parse(
  fs.readFileSync(
    path.resolve("src/abi/Pocket.json"),
    "utf8"
  )
).abi;

/* -------------------------------------------------------------------------- */
/* Verify EIP-712 execution intent                                             */
/* -------------------------------------------------------------------------- */

router.post("/exec-intent", async (req, res) => {
  try {
    const {
      pocket,
      target,
      dataHash,
      nonce,
      expiry,
      signature
    } = req.body;

    requireAddress(pocket, "pocket");
    requireAddress(target, "target");

    const { chainId } = await provider.getNetwork();

    /* ---------------------------------------------------------------------- */
    /* Domain                                                                 */
    /* ---------------------------------------------------------------------- */

    const domain = {
      name: "Ward Pocket",
      version: "1",
      chainId: Number(chainId),
      verifyingContract: pocket
    };

    const types = {
      Exec: [
        { name: "pocket", type: "address" },
        { name: "target", type: "address" },
        { name: "dataHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" }
      ]
    };

    const message = {
      pocket,
      target,
      dataHash,
      nonce: BigInt(nonce),
      expiry: BigInt(expiry)
    };

    /* ---------------------------------------------------------------------- */
    /* Recover signer                                                         */
    /* ---------------------------------------------------------------------- */

    const recovered = ethers.verifyTypedData(
      domain,
      types,
      message,
      signature
    );

    /* ---------------------------------------------------------------------- */
    /* Compare against pocket owner                                           */
    /* ---------------------------------------------------------------------- */

    const pocketContract = new ethers.Contract(
      pocket,
      PocketABI,
      provider
    );

    const owner = await pocketContract.owner();

    if (recovered.toLowerCase() !== owner.toLowerCase()) {
      return res.json({
        valid: false,
        reason: "Invalid signer",
        recovered,
        owner,
        chainId: Number(chainId)
      });
    }

    if (Number(expiry) < Math.floor(Date.now() / 1000)) {
      return res.json({
        valid: false,
        reason: "Signature expired"
      });
    }

    return res.json({ valid: true });

  } catch (err) {
    return res.status(500).json({
      valid: false,
      reason: err.message
    });
  }
});

export default router;

import express from "express";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";

import { controller } from "../config/chain.js";
const PocketArtifact = JSON.parse(
  fs.readFileSync(
    path.resolve("src/abi/Pocket.json"),
    "utf8"
  )
);
const PocketABI = PocketArtifact.abi;
import { decodeEthersError } from "../utils/errors.js";
import { requireAddress } from "../utils/validate.js";
import { pocketRegistry } from "../utils/pocketRegistry.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Controller read APIs                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Get controller view of a pocket
 * GET /api/controller/pocket/:address
 *
 * Returns:
 * - valid: whether controller recognizes the pocket
 * - owner: recorded owner (receiver for sweep)
 */
router.get("/pocket/:address", async (req, res) => {
  try {
    const { address } = req.params;
    requireAddress(address, "pocket");

    const [valid, owner] = await Promise.all([
      controller.validPocket(address),
      controller.pocketOwner(address)
    ]);

    res.json({
      address,
      valid,
      owner
    });
  } catch (err) {
    res.status(500).json({
      error: decodeEthersError(err, controller.interface)
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Pocket discovery (registry + controller state)                               */
/* -------------------------------------------------------------------------- */

/**
 * List pockets created for a user
 * GET /api/controller/pockets/:userAddress
 *
 * Source of truth: PocketController state + backend registry
 */
router.get("/pockets/:userAddress", async (req, res) => {
  try {
    const { userAddress } = req.params;
    requireAddress(userAddress, "user");

    const provider = controller.runner.provider;
    const storedPockets = pocketRegistry.getPocketsByOwner(userAddress);
    const pockets = [];

    for (const pocketAddress of storedPockets) {
      try {
        const [valid, owner] = await Promise.all([
          controller.validPocket(pocketAddress),
          controller.pocketOwner(pocketAddress)
        ]);
        if (!valid) continue;
        if (owner.toLowerCase() !== userAddress.toLowerCase()) continue;

        const pocket = new ethers.Contract(pocketAddress, PocketABI, provider);
        const [used, burned] = await Promise.all([
          pocket.used(),
          pocket.burned()
        ]);
        pockets.push({ address: pocketAddress, owner, used, burned });
      } catch (err) {
        console.warn("[GET /api/controller/pockets/:userAddress] skipping pocket", {
          userAddress,
          pocketAddress,
          error: err?.message
        });
      }
    }

    res.json({ pockets });
  } catch (err) {
    res.json({ pockets: [] });
  }
});

export default router;

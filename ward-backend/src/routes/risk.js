import express from "express";
import { ethers } from "ethers";

import { provider } from "../config/chain.js";
import { requireAddress } from "../utils/validate.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Risk classification                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Classify token risk
 * POST /api/risk/classify
 *
 * Returns:
 * - tier: 1 | 2 | 3 | 4
 * - confidence: 0..1
 * - signals: string[]
 *
 * NOTE:
 * - Pure analysis
 * - No execution
 * - No authority
 */
router.post("/classify", async (req, res) => {
  try {
    const { tokenAddress, simulate = false } = req.body;

    requireAddress(tokenAddress, "token");

    const signals = [];
    let tier = 1;
    let confidence = 0.9;

    // Heuristic 1: contract existence
    const code = await provider.getCode(tokenAddress);
    if (code === "0x") {
      signals.push("no_code");
      tier = 4;
      confidence = 0.95;
    }

    // Heuristic 2: simulation requested (future extension)
    if (simulate) {
      signals.push("simulation_requested");
    }

    res.json({
      tier,
      confidence,
      signals,
      message:
        tier >= 3
          ? "Token is potentially dangerous"
          : "Token appears safe"
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Action simulation (raw eth_call)                                            */
/* -------------------------------------------------------------------------- */

/**
 * Simulate action from pocket
 * POST /api/risk/simulate
 *
 * Performs:
 * - eth_call
 *
 * Does NOT:
 * - validate signature
 * - validate controller path
 * - mutate state
 *
 * This is for risk heuristics ONLY.
 */
router.post("/simulate", async (req, res) => {
  try {
    const { pocketAddress, target, data } = req.body;

    requireAddress(pocketAddress, "pocket");
    requireAddress(target, "target");

    await provider.call({
      from: pocketAddress,
      to: target,
      data
    });

    res.json({
      success: true,
      gasUsed: 0 // eth_call does not return gas
    });
  } catch (err) {
    res.json({
      success: false,
      error: err.reason || err.message
    });
  }
});

export default router;

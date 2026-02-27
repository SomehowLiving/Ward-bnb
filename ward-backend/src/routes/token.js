import express from "express";
import { ethers } from "ethers";

import { provider } from "../config/chain.js";
import { requireAddress } from "../utils/validate.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* ERC20 Metadata                                                              */
/* -------------------------------------------------------------------------- */

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)"
];

/**
 * Get token metadata
 * GET /api/token/:address
 *
 * Read-only helper for frontend UX.
 */
router.get("/:address", async (req, res) => {
  try {
    const { address } = req.params;
    requireAddress(address, "token");

    const code = await provider.getCode(address);
    if (code === "0x") {
      return res.status(400).json({ error: "Address is not a contract" });
    }

    const token = new ethers.Contract(address, ERC20_ABI, provider);

    const [name, symbol, decimals, totalSupply] = await Promise.all([
      token.name(),
      token.symbol(),
      token.decimals(),
      token.totalSupply()
    ]);

    res.json({
      address,
      name,
      symbol,
      decimals,
      totalSupply: totalSupply.toString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

import express from "express";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Health                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Health check
 * GET /api/health
 *
 * Used for:
 * - uptime monitoring
 * - load balancers
 * - deployments
 */
router.get("/health", (_, res) => {
  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* User history (off-chain aggregation)                                        */
/* -------------------------------------------------------------------------- */

/**
 * User interaction history
 * GET /api/history/:userAddress
 *
 * NOTE:
 * - Off-chain only
 * - Non-authoritative
 * - Replace with DB / indexer later
 */
router.get("/history/:userAddress", async (req, res) => {
  const { userAddress } = req.params;

  // TODO: Replace with indexed DB / analytics store
  res.json({
    userAddress,
    totalPockets: 0,
    totalProtected: "0",
    interactions: []
  });
});

/* -------------------------------------------------------------------------- */
/* System metrics (marketing / dashboard)                                      */
/* -------------------------------------------------------------------------- */

/**
 * System metrics
 * GET /api/metrics
 *
 * NOTE:
 * - Informational only
 * - No protocol impact
 */
router.get("/metrics", async (_, res) => {
  res.json({
    totalPocketsCreated: 0,
    totalValueProtected: "0",
    mainWalletDrains: 0,
    averageLossPerPocket: "0"
  });
});

export default router;

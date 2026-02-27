import express from "express";
import dotenv from "dotenv";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";

import pocketRoutes from "./routes/pocket.js";
import controllerRoutes from "./routes/controller.js";
import verifyRoutes from "./routes/verify.js";
import tokenRoutes from "./routes/token.js";
import metaRoutes from "./routes/meta.js";
import creditRoutes from "./routes/credit.js";
import merchantRoutes from "./routes/merchant.js";
import activityRoutes from "./routes/activity.js";
import { requireAddress } from "./utils/validate.js";
import { controller, provider } from "./config/chain.js";
import { pocketRegistry } from "./utils/pocketRegistry.js";

dotenv.config();

const app = express();
import cors from "cors";

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// app.use(
//   cors({
//     origin: [
//       "http://localhost:5173",
//       "http://127.0.0.1:5173",
//       "https://id-preview--75652319-5a64-44e8-9ac9-2dca146d2276.lovable.app"
//     ],
//     methods: ["GET", "POST", "OPTIONS"],
//     allowedHeaders: ["Content-Type"]
//   })
// );
app.use(cors({ origin: true }));

app.use(express.json());

// app.use(express.json());

/* -------------------------------------------------------------------------- */
/* Route mounting                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Pocket lifecycle + execution
 * (state-changing, relayed)
 */
app.use("/api/pocket", pocketRoutes);

/**
 * Controller registry + discovery
 * (read-only)
 */
app.use("/api/controller", controllerRoutes);

/**
 * Signature verification
 * (cryptographic, read-only)
 */
app.use("/api/verify", verifyRoutes);

/**
 * Token metadata
 * (read-only)
 */
app.use("/api/token", tokenRoutes);

/**
 * Credit orchestration
 * (vault-aware)
 */
app.use("/api/credit", creditRoutes);

/**
 * Merchant governance
 * (flag status + owner blocklist operations)
 */
app.use("/api/merchant", merchantRoutes);
app.use("/api/activity", activityRoutes);

/**
 * System meta, health, metrics
 * (off-chain only)
 */
app.use("/api", metaRoutes);

/**
 * Decode calldata helper (best-effort)
 * POST /api/calldata/decode
 */
app.post("/api/calldata/decode", (req, res) => {
  const { data } = req.body || {};
  if (typeof data !== "string" || !data.startsWith("0x")) {
    return res.status(400).json({ error: "Invalid calldata hex string" });
  }

  const selector = data.slice(0, 10);
  const argsData = `0x${data.slice(10)}`;
  const hasArgs = argsData.length > 2;

  return res.json({
    function: selector,
    args: hasArgs ? [argsData] : [],
    confidence: hasArgs ? "low" : "medium"
  });
});

/* -------------------------------------------------------------------------- */
/* Pocket discovery (list by user)                                            */
/* -------------------------------------------------------------------------- */

/**
 * List pockets created for a user
 * GET /api/pockets/:userAddress
 *
 * Behaviour:
 * - invalid address      -> 400
 * - valid, zero pockets  -> 200 { pockets: [] }
 * - internal error       -> 500
 */
app.get("/api/pockets/:userAddress", async (req, res) => {
  const { userAddress } = req.params;

  console.log("[GET /api/pockets/:userAddress] incoming request", {
    userAddress
  });

  // Address validation with explicit 400 on failure
  try {
    requireAddress(userAddress, "user");
  } catch (err) {
    console.warn("[GET /api/pockets/:userAddress] invalid user address", {
      userAddress,
      error: err?.message
    });
    return res.status(400).json({ error: "Invalid user address" });
  }

  try {
    const storedPockets = pocketRegistry.getPocketsByOwner(userAddress);
    if (!storedPockets || storedPockets.length === 0) {
      console.log(
        "[GET /api/pockets/:userAddress] no pockets found for user",
        { userAddress }
      );
      return res.json({ pockets: [] });
    }

    const PocketArtifact = JSON.parse(
      fs.readFileSync(
        path.resolve("src/abi/Pocket.json"),
        "utf8"
      )
    );
    const PocketABI = PocketArtifact.abi;

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

        pockets.push({
          address: pocketAddress,
          owner,
          used,
          burned
        });
      } catch (err) {
        console.warn("[GET /api/pockets/:userAddress] skipping pocket on read failure", {
          userAddress,
          pocketAddress,
          error: err?.message
        });
      }
    }

    console.log(
      "[GET /api/pockets/:userAddress] successfully resolved pockets",
      {
        userAddress,
        pocketsCount: pockets.length
      }
    );

    res.json({ pockets });
  } catch (err) {
    console.error(
      "[GET /api/pockets/:userAddress] internal error while listing pockets",
      {
        userAddress,
        error: err?.message,
        stack: err?.stack
      }
    );

    res.json({ pockets: [] });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    method: req.method,
    path: req.originalUrl
  });
});

app.use((err, req, res, _next) => {
  console.error("[unhandled error]", {
    method: req.method,
    path: req.originalUrl,
    error: err?.message,
    stack: err?.stack
  });
  res.status(err?.statusCode || 500).json({
    error: err?.message || "Internal server error"
  });
});

/* -------------------------------------------------------------------------- */
/* Start server                                                               */
/* -------------------------------------------------------------------------- */

const PORT = process.env.PORT || 3000;
const EXPECTED_CHAIN_ID = Number(process.env.CHAIN_ID || 97);

async function startServer() {
  const network = await provider.getNetwork();
  const actualChainId = Number(network.chainId);
  if (actualChainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `RPC chainId mismatch. Expected ${EXPECTED_CHAIN_ID}, got ${actualChainId}. Check RPC_URL/CHAIN_ID env.`
    );
  }

  app.listen(PORT, () => {
    console.log(`Pocket backend running on :${PORT} (chainId=${actualChainId})`);
  });
}

startServer().catch((err) => {
  console.error("[startup] failed", err?.message || err);
  process.exit(1);
});

import express from "express";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";


import { controller, provider } from "../config/chain.js";
// import PocketABI from "../abi/Pocket.json" assert { type: "json" };
const PocketArtifact = JSON.parse(
    fs.readFileSync(
        path.resolve("src/abi/Pocket.json"),
        "utf8"
    )
);
const PocketFactoryArtifact = JSON.parse(
    fs.readFileSync(
        path.resolve("src/abi/PocketFactory.json"),
        "utf8"
    )
);
const PocketABI = PocketArtifact.abi;
const PocketBytecode = PocketArtifact?.bytecode?.object;
const PocketFactoryABI = PocketFactoryArtifact.abi;

import { decodeEthersError, parseRevertReason } from "../utils/errors.js";
import { requireAddress, ValidationError } from "../utils/validate.js";
import { fetchRiskTier } from "../utils/risk.js";
import { pocketRegistry } from "../utils/pocketRegistry.js";
import { backfillPocketCreatedBlocks } from "../utils/backfillPocketCreatedBlocks.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function getPocket(address) {
    return new ethers.Contract(address, PocketABI, provider);
}

async function getNextAvailableNonce(pocketContract, maxProbe = 2048) {
    for (let nonce = 1; nonce <= maxProbe; nonce += 1) {
        const used = await pocketContract.usedNonces(nonce);
        if (!used) return nonce;
    }
    throw new Error(`No available nonce found within probe window (1..${maxProbe})`);
}

async function computePocketAddress(user, salt) {
    if (!PocketBytecode) {
        throw new Error("Pocket bytecode unavailable");
    }
    const factoryAddress = await controller.factory();
    const controllerAddress = await controller.getAddress();
    const createSalt = ethers.solidityPackedKeccak256(
        ["address", "uint256"],
        [user, salt]
    );
    const constructorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address"],
        [controllerAddress, user]
    );
    const initCodeHash = ethers.keccak256(
        ethers.concat([PocketBytecode, constructorArgs])
    );
    return ethers.getCreate2Address(factoryAddress, createSalt, initCodeHash);
}

async function simulateExec(args) {
    try {
        await controller.executeFromPocket.staticCall(
            args.pocket,
            args.target,
            args.data,
            args.nonce,
            args.expiry,
            args.signature
        );
        return null;
    } catch (err) {
        return decodeEthersError(err, controller.interface);
    }
}

function isValidationError(err) {
    return err instanceof ValidationError || err?.name === "ValidationError";
}

const ERC20_MIN_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)"
];
const ERC20_AMOUNT_ABI = [
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
];

async function resolveTokenAmount(tokenAddress, amountInput) {
    const value = String(amountInput ?? "").trim();
    if (!value) throw new ValidationError("amount is required");
    const token = new ethers.Contract(tokenAddress, ERC20_AMOUNT_ABI, provider);

    let decimals;
    try {
        decimals = Number(await token.decimals());
    } catch {
        throw new ValidationError("Token does not expose decimals()");
    }

    if (!Number.isFinite(decimals) || decimals < 0 || decimals > 255) {
        throw new ValidationError("Invalid token decimals");
    }

    try {
        const amountBaseUnits = ethers.parseUnits(value, decimals);
        const symbol = await token.symbol().catch(() => "TOKEN");
        return {
            decimals,
            symbol,
            amountHuman: value,
            amountBaseUnits
        };
    } catch {
        throw new ValidationError(`Invalid token amount for ${decimals} decimals`);
    }
}

async function findPocketDeployedBlock(receipt, expectedPocket) {
    const expected = ethers.getAddress(expectedPocket);
    const factoryAddress = ethers.getAddress(await controller.factory());
    const factoryIface = new ethers.Interface(PocketFactoryABI);

    for (const log of receipt.logs ?? []) {
        if (!log?.address) continue;
        if (ethers.getAddress(log.address) !== factoryAddress) continue;
        try {
            const parsed = factoryIface.parseLog(log);
            if (parsed?.name !== "PocketDeployed") continue;
            const deployedPocket = ethers.getAddress(parsed.args.pocket);
            if (deployedPocket === expected) {
                return Number(receipt.blockNumber);
            }
        } catch {
            // Ignore unrelated logs.
        }
    }

    return Number(receipt.blockNumber);
}

async function getLogsChunked(baseFilter, fromBlock, toBlock, step = 10) {
    const logs = [];

    for (let start = fromBlock; start <= toBlock; start += step) {
        const end = Math.min(start + step - 1, toBlock);

        const chunk = await provider.getLogs({
            ...baseFilter,
            fromBlock: start,
            toBlock: end
        });

        logs.push(...chunk);
    }

    return logs;
}


async function indexPocketAssets(pocketAddress) {
    const normalizedPocket = ethers.getAddress(pocketAddress);
    const record = pocketRegistry.getPocketRecord(normalizedPocket);
    const fromBlock =
        record?.createdBlock ??
        Number(process.env.ASSET_INDEXER_FROM_BLOCK ?? 0);
    const toBlock = "latest";
    const pocketTopic = ethers.zeroPadValue(normalizedPocket, 32);
    const transferTopic = ethers.id("Transfer(address,address,uint256)");

    const latest = await provider.getBlockNumber();

    const incoming = await getLogsChunked(
        { topics: [transferTopic, null, pocketTopic] },
        fromBlock,
        latest
    );

    const outgoing = await getLogsChunked(
        { topics: [transferTopic, pocketTopic, null] },
        fromBlock,
        latest
    );


    const tokens = new Set();
    for (const log of incoming) tokens.add(ethers.getAddress(log.address));
    for (const log of outgoing) tokens.add(ethers.getAddress(log.address));

    return {
        fromBlock,
        tokens: Array.from(tokens)
    };
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Create Pocket
 * POST /api/pocket/create
 */
router.post("/create", async (req, res) => {
    try {
        const { user, salt } = req.body;
        requireAddress(user, "user");
        if (salt === undefined || salt === null) {
            return res.status(400).json({
                error: { type: "VALIDATION", message: "Missing salt" }
            });
        }
        const normalizedSalt = BigInt(salt);
        const pocket = await computePocketAddress(user, normalizedSalt);

        const tx = await controller.createPocket(user, normalizedSalt);
        const receipt = await tx.wait();

        const isValid = await controller.validPocket(pocket);
        if (!isValid) {
            throw new Error("Pocket creation transaction succeeded but controller did not mark pocket valid");
        }

        const createdBlock = await findPocketDeployedBlock(receipt, pocket);
        pocketRegistry.addPocket(user, pocket, createdBlock);
        res.json({ pocket, createdBlock });
    } catch (err) {
        console.error("[POST /api/pocket/create] failed", {
            user: req.body?.user,
            salt: req.body?.salt,
            error: err?.message,
            stack: err?.stack
        });
        const status = isValidationError(err) ? 400 : 500;
        res.status(status).json({
            error: decodeEthersError(err, controller.interface)
        });
    }
});

/**
 * Backfill missing createdBlock values in local pocket registry
 * POST /api/pocket/backfill-created-blocks
 */
router.post("/backfill-created-blocks", async (req, res) => {
    try {
        const { fromBlock, toBlock, dryRun } = req.body ?? {};
        const result = await backfillPocketCreatedBlocks({ fromBlock, toBlock, dryRun });
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({
            ok: false,
            error: err?.message || "Backfill failed"
        });
    }
});

/**
 * Get next available nonce for a pocket
 * GET /api/pocket/:address/next-nonce
 */
router.get("/:address/next-nonce", async (req, res) => {
    try {
        const { address } = req.params;
        requireAddress(address, "pocket");
        const code = await provider.getCode(address);
        if (code === "0x") {
            return res.status(404).json({
                error: { type: "NOT_FOUND", message: "Pocket contract not found" }
            });
        }

        const pocket = getPocket(address);
        const nextNonce = await getNextAvailableNonce(pocket);

        res.json({ address: ethers.getAddress(address), nextNonce });
    } catch (err) {
        const status = isValidationError(err) ? 400 : 500;
        res.status(status).json({
            error: err?.message || "Failed to resolve next nonce"
        });
    }
});

/**
 * Get pocket state
 * GET /api/pocket/:address
 */
router.get("/:address", async (req, res) => {
    try {
        const { address } = req.params;
        requireAddress(address, "pocket");
        const code = await provider.getCode(address);
        if (code === "0x") {
            return res.status(404).json({
                error: { type: "NOT_FOUND", message: "Pocket contract not found" }
            });
        }

        const pocket = getPocket(address);

        const [used, burned, owner] = await Promise.all([
            pocket.used(),
            pocket.burned(),
            pocket.owner()
        ]);

        res.json({ address, owner, used, burned });
    } catch (err) {
        const status = isValidationError(err) ? 400 : 500;
        res.status(status).json({
            error: decodeEthersError(err, controller.interface)
        });
    }
});

/**
 * Asset indexer for a pocket
 * GET /api/pocket/:address/assets
 *
 * Scans ERC20 Transfer logs to/from the pocket and returns current balances
 * with token metadata for all discovered token contracts.
 */
router.get("/:address/assets", async (req, res) => {
    try {
        const { address } = req.params;
        requireAddress(address, "pocket");

        const code = await provider.getCode(address);
        if (code === "0x") {
            return res.status(404).json({
                error: { type: "NOT_FOUND", message: "Pocket contract not found" }
            });
        }

        const normalizedPocket = ethers.getAddress(address);
        const [{ fromBlock, tokens }, nativeBalance] = await Promise.all([
            indexPocketAssets(normalizedPocket),
            provider.getBalance(normalizedPocket)
        ]);

        const assets = [];
        for (const tokenAddress of tokens) {
            try {
                const token = new ethers.Contract(tokenAddress, ERC20_MIN_ABI, provider);

                const [name, symbol, decimals, balanceRaw] = await Promise.all([
                    token.name().catch(() => "Unknown Token"),
                    token.symbol().catch(() => "UNKNOWN"),
                    token.decimals().catch(() => 18),
                    token.balanceOf(normalizedPocket)
                ]);

                assets.push({
                    address: tokenAddress,
                    name,
                    symbol,
                    decimals: Number(decimals),
                    balance: balanceRaw.toString(),
                    formattedBalance: ethers.formatUnits(balanceRaw, Number(decimals)),
                    hasBalance: balanceRaw > 0n
                });
            } catch {
                // Ignore contracts that don't behave like ERC20s.
            }
        }

        assets.sort((a, b) => Number(b.hasBalance) - Number(a.hasBalance));

        res.json({
            pocket: normalizedPocket,
            fromBlock,
            nativeBalance: nativeBalance.toString(),
            formattedNativeBalance: ethers.formatEther(nativeBalance),
            assets
        });
    } catch (err) {
        const status = isValidationError(err) ? 400 : 500;
        res.status(status).json({
            error: err?.message || "Failed to index pocket assets"
        });
    }
});

/**
 * Execute from pocket
 * POST /api/pocket/exec
 */
router.post("/exec", async (req, res) => {
    const { pocket, target, data, nonce, expiry, signature } = req.body;

    try {
        requireAddress(pocket, "pocket");
        requireAddress(target, "target");

        const simError = await simulateExec({
            pocket,
            target,
            data,
            nonce,
            expiry,
            signature
        });

        if (simError) {
            return res.status(400).json({ error: simError });
        }

        const tx = await controller.executeFromPocket(
            pocket,
            target,
            data,
            nonce,
            expiry,
            signature
        );

        const receipt = await tx.wait();

        res.json({
            status: "executed",
            txHash: receipt.hash,
            gasUsed: receipt.gasUsed.toString()
        });
    } catch (err) {
        res.status(500).json({
            error: decodeEthersError(err, controller.interface)
        });
    }
});

/**
 * Burn pocket
 * POST /api/pocket/burn
 */
router.post("/burn", async (req, res) => {
    const { pocket, nonce, expiry, signature } = req.body;

    try {
        requireAddress(pocket, "pocket");

        try {
            await controller.burnPocket.staticCall(
                pocket,
                nonce,
                expiry,
                signature
            );
        } catch (err) {
            return res.status(400).json({
                error: decodeEthersError(err, controller.interface)
            });
        }

        const tx = await controller.burnPocket(
            pocket,
            nonce,
            expiry,
            signature
        );

        const receipt = await tx.wait();
        res.json({ status: "burned", txHash: receipt.hash });
    } catch (err) {
        res.status(500).json({
            error: decodeEthersError(err, controller.interface)
        });
    }
});

/**
 * Sweep tokens
 * POST /api/pocket/sweep
 */
router.post("/sweep", async (req, res) => {
    try {
        const { pocketAddress, tokenAddress, receiverAddress, amount } = req.body;

        requireAddress(pocketAddress, "pocket");
        requireAddress(tokenAddress, "token");
        requireAddress(receiverAddress, "receiver");
        const { amountBaseUnits } = await resolveTokenAmount(tokenAddress, amount);

        const valid = await controller.validPocket(pocketAddress);
        if (!valid) {
            return res.status(400).json({
                error: { type: "VALIDATION", message: "Invalid pocket" }
            });
        }

        const { tier } = await fetchRiskTier(tokenAddress);

        try {
            await controller.sweep.staticCall(
                pocketAddress,
                tokenAddress,
                receiverAddress,
                amountBaseUnits,
                tier
            );
        } catch (err) {
            return res.status(400).json({
                error: parseRevertReason(err, controller.interface)
            });
        }

        const tx = await controller.sweep(
            pocketAddress,
            tokenAddress,
            receiverAddress,
            amountBaseUnits,
            tier
        );

        const receipt = await tx.wait();
        res.json({ txHash: receipt.hash });
    } catch (err) {
        res.status(400).json({
            error: parseRevertReason(err, controller.interface)
        });
    }
});

/**
 * Simulate execution (UX helper)
 * POST /api/pocket/simulate
 */
router.post("/simulate", async (req, res) => {
    try {
        const { pocket, target, data, nonce, expiry, signature } = req.body;

        requireAddress(pocket, "pocket");
        requireAddress(target, "target");

        const valid = await controller.validPocket(pocket);
        if (!valid) {
            return res.status(400).json({ error: "Invalid pocket" });
        }

        await controller.executeFromPocket.staticCall(
            pocket,
            target,
            data,
            nonce,
            expiry,
            signature
        );

        res.json({ ok: true });
    } catch (err) {
        res.json({
            ok: false,
            error: decodeEthersError(err, controller.interface)
        });
    }
});

/**
 * Calculate fee (no tx)
 * POST /api/pocket/fee
 */
router.post("/fee", async (req, res) => {
    try {
        const { amount, tokenAddress } = req.body;

        if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
            return res.status(400).json({
                error: { type: "VALIDATION", message: "Invalid token address" }
            });
        }
        const { decimals, symbol, amountHuman, amountBaseUnits } = await resolveTokenAmount(tokenAddress, amount);

        const { tier } = await fetchRiskTier(tokenAddress);
        const feeBps = await controller.feeBps(tier);

        const fee = (amountBaseUnits * BigInt(feeBps)) / 10_000n;
        const net = amountBaseUnits - fee;

        res.json({
            amount: amountBaseUnits.toString(),
            amountHuman,
            symbol,
            decimals,
            tier,
            fee: fee.toString(),
            feeFormatted: ethers.formatUnits(fee, decimals),
            net: net.toString(),
            netFormatted: ethers.formatUnits(net, decimals)
        });
    } catch (err) {
        const status = isValidationError(err) ? 400 : 500;
        res.status(status).json({
            error: isValidationError(err)
                ? { type: "VALIDATION", message: err.message }
                : decodeEthersError(err, controller.interface)
        });
    }
});

/**
 * Gas estimation
 * POST /api/pocket/gas
 */
router.post("/gas", async (req, res) => {
    try {
        const { pocket, target, data, nonce, expiry, signature } = req.body;

        requireAddress(pocket, "pocket");
        requireAddress(target, "target");

        const valid = await controller.validPocket(pocket);
        if (!valid) {
            return res.status(400).json({ error: "Invalid pocket" });
        }

        const gas = await controller.executeFromPocket.estimateGas(
            pocket,
            target,
            data,
            nonce,
            expiry,
            signature
        );

        res.json({ gas: gas.toString() });
    } catch (err) {
        res.json({
            error: decodeEthersError(err, controller.interface)
        });
    }
});

/** Relay execution from pocket
 * POST /api/relay/pocket-exec
 */
router.post("/api/relay/pocket-exec", async (req, res) => {
    try {
        const { pocket, target, data, nonce, expiry, signature } = req.body;
        const valid = await controller.validPocket(pocket);
        if (!valid) {
            return res.status(400).json({ error: "Invalid pocket" });
        }

        const tx = await controller.executeFromPocket(
            pocket,
            target,
            data,
            nonce,
            expiry,
            signature
        );

        const receipt = await tx.wait();
        res.json({ txHash: receipt.hash });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

export default router;

import express from "express";
import { ethers } from "ethers";

import { controller, getVaultContract, provider } from "../config/chain.js";
import { decodeEthersError } from "../utils/errors.js";
import { requireAddress, ValidationError } from "../utils/validate.js";

const router = express.Router();

const BATCH_BLOCKS = Number(process.env.ACTIVITY_SCAN_BATCH || 500);
const FROM_BLOCK = Number(process.env.DEPLOYMENT_BLOCK || 0);

const vaultEventAbi = [
  "event CreditRequested(bytes32 indexed requestId,address indexed user,address indexed merchant,address pocket,uint256 principal,uint256 installmentAmount,uint256 totalInstallments,uint256 interval,uint256 nextDueDate)",
  "event InstallmentRepaid(bytes32 indexed requestId,address indexed user,uint256 amount,uint256 remaining,uint256 installmentsPaid,uint256 nextDueDate)"
];
const factoryEventAbi = ["event PocketDeployed(address pocket,address owner)"];
const merchantEventAbi = [
  "event Purchased(address buyer,uint256 amount)",
  "event AttackAttempted(address indexed caller,uint256 observedCallerBalance,bool success,bytes returnData)"
];

const vaultIface = new ethers.Interface(vaultEventAbi);
const factoryIface = new ethers.Interface(factoryEventAbi);
const merchantIface = new ethers.Interface(merchantEventAbi);

function isValidationError(err) {
  return err instanceof ValidationError || err?.name === "ValidationError";
}

async function getLogsChunked(baseFilter, fromBlock, toBlock, step = BATCH_BLOCKS) {
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += step) {
    const end = Math.min(start + step - 1, toBlock);
    const chunk = await provider.getLogs({ ...baseFilter, fromBlock: start, toBlock: end });
    logs.push(...chunk);
  }
  return logs;
}

async function timestampMapForLogs(logs) {
  const map = new Map();
  const uniqueBlocks = [...new Set(logs.map((l) => Number(l.blockNumber)))];
  await Promise.all(
    uniqueBlocks.map(async (blockNumber) => {
      const block = await provider.getBlock(blockNumber);
      map.set(blockNumber, Number(block?.timestamp ?? 0));
    })
  );
  return map;
}

router.get("/credits/:user", async (req, res) => {
  try {
    const { user } = req.params;
    requireAddress(user, "user");

    const vault = getVaultContract();
    const latest = await provider.getBlockNumber();
    const userTopic = ethers.zeroPadValue(ethers.getAddress(user), 32);
    const topic = ethers.id(
      "CreditRequested(bytes32,address,address,address,uint256,uint256,uint256,uint256,uint256)"
    );

    const logs = await getLogsChunked(
      { address: await vault.getAddress(), topics: [topic, null, userTopic] },
      FROM_BLOCK,
      latest
    );
    const tsMap = await timestampMapForLogs(logs);

    const items = logs
      .map((log) => {
        const parsed = vaultIface.parseLog(log);
        return {
          requestId: parsed.args.requestId,
          merchant: parsed.args.merchant,
          amount: parsed.args.principal.toString(),
          pocket: parsed.args.pocket,
          dueDate: parsed.args.nextDueDate.toString(),
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
          timestamp: tsMap.get(Number(log.blockNumber)) ?? 0
        };
      })
      .sort((a, b) => b.blockNumber - a.blockNumber);

    res.json({ user: ethers.getAddress(user), items });
  } catch (err) {
    const status = isValidationError(err) ? 400 : 500;
    res.status(status).json({ error: decodeEthersError(err) });
  }
});

router.get("/repayments/:user", async (req, res) => {
  try {
    const { user } = req.params;
    requireAddress(user, "user");

    const vault = getVaultContract();
    const latest = await provider.getBlockNumber();
    const userTopic = ethers.zeroPadValue(ethers.getAddress(user), 32);
    const topic = ethers.id("InstallmentRepaid(bytes32,address,uint256,uint256,uint256,uint256)");

    const logs = await getLogsChunked(
      { address: await vault.getAddress(), topics: [topic, null, userTopic] },
      FROM_BLOCK,
      latest
    );
    const tsMap = await timestampMapForLogs(logs);

    const items = logs
      .map((log) => {
        const parsed = vaultIface.parseLog(log);
        return {
          requestId: parsed.args.requestId,
          amount: parsed.args.amount.toString(),
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
          timestamp: tsMap.get(Number(log.blockNumber)) ?? 0
        };
      })
      .sort((a, b) => b.blockNumber - a.blockNumber);

    res.json({ user: ethers.getAddress(user), items });
  } catch (err) {
    const status = isValidationError(err) ? 400 : 500;
    res.status(status).json({ error: decodeEthersError(err) });
  }
});

router.get("/pockets/:user", async (req, res) => {
  try {
    const { user } = req.params;
    requireAddress(user, "user");

    const normalizedUser = ethers.getAddress(user);
    const factoryAddress = await controller.factory();
    const latest = await provider.getBlockNumber();
    const topic = ethers.id("PocketDeployed(address,address)");

    const logs = await getLogsChunked(
      { address: factoryAddress, topics: [topic] },
      FROM_BLOCK,
      latest
    );
    const tsMap = await timestampMapForLogs(logs);

    const items = logs
      .map((log) => {
        const parsed = factoryIface.parseLog(log);
        return {
          pocket: parsed.args.pocket,
          owner: parsed.args.owner,
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
          timestamp: tsMap.get(Number(log.blockNumber)) ?? 0
        };
      })
      .filter((x) => ethers.getAddress(x.owner) === normalizedUser)
      .sort((a, b) => b.blockNumber - a.blockNumber);

    res.json({ user: normalizedUser, items });
  } catch (err) {
    const status = isValidationError(err) ? 400 : 500;
    res.status(status).json({ error: decodeEthersError(err) });
  }
});

router.get("/merchant/:merchant", async (req, res) => {
  try {
    const { merchant } = req.params;
    requireAddress(merchant, "merchant");

    const normalizedMerchant = ethers.getAddress(merchant);
    const vault = getVaultContract();
    const [flagCount, blocked, latest] = await Promise.all([
      vault.merchantFlagCount(normalizedMerchant),
      vault.merchantBlocked(normalizedMerchant),
      provider.getBlockNumber()
    ]);

    const purchasedTopic = ethers.id("Purchased(address,uint256)");
    const attackTopic = ethers.id("AttackAttempted(address,uint256,bool,bytes)");
    const [purchaseLogs, attackLogs] = await Promise.all([
      getLogsChunked({ address: normalizedMerchant, topics: [purchasedTopic] }, FROM_BLOCK, latest),
      getLogsChunked({ address: normalizedMerchant, topics: [attackTopic] }, FROM_BLOCK, latest)
    ]);

    let totalExecutions = 0;
    let totalDrainedAttempts = 0;
    for (const log of purchaseLogs) {
      const parsed = merchantIface.parseLog(log);
      if (parsed?.name === "Purchased") totalExecutions += 1;
    }
    for (const log of attackLogs) {
      const parsed = merchantIface.parseLog(log);
      if (parsed?.name === "AttackAttempted") {
        totalExecutions += 1;
        totalDrainedAttempts += 1;
      }
    }

    res.json({
      merchant: normalizedMerchant,
      totalFlags: flagCount.toString(),
      blocked,
      totalExecutions,
      totalDrainedAttempts
    });
  } catch (err) {
    const status = isValidationError(err) ? 400 : 500;
    res.status(status).json({ error: decodeEthersError(err) });
  }
});

router.get("/executions/:user", async (req, res) => {
  try {
    const { user } = req.params;
    requireAddress(user, "user");
    const normalizedUser = ethers.getAddress(user);

    const goodAddress = process.env.MERCHANT_GOOD_ADDRESS;
    const badAddress = process.env.MERCHANT_MALICIOUS_ADDRESS;
    const merchants = [goodAddress, badAddress].filter(Boolean).map((x) => ethers.getAddress(x));
    const latest = await provider.getBlockNumber();

    const purchasedTopic = ethers.id("Purchased(address,uint256)");
    const attackTopic = ethers.id("AttackAttempted(address,uint256,bool,bytes)");
    const logsByMerchant = await Promise.all(
      merchants.map(async (merchant) => {
        const [purchaseLogs, attackLogs] = await Promise.all([
          getLogsChunked({ address: merchant, topics: [purchasedTopic] }, FROM_BLOCK, latest),
          getLogsChunked({ address: merchant, topics: [attackTopic] }, FROM_BLOCK, latest)
        ]);
        return purchaseLogs.concat(attackLogs);
      })
    );
    const logs = logsByMerchant.flat();
    const tsMap = await timestampMapForLogs(logs);

    const items = [];
    for (const log of logs) {
      const parsed = merchantIface.parseLog(log);
      const caller = parsed.name === "Purchased" ? parsed.args.buyer : parsed.args.caller;
      let owner;
      try {
        owner = await controller.pocketOwner(caller);
      } catch {
        continue;
      }
      if (ethers.getAddress(owner) !== normalizedUser) continue;
      items.push({
        merchant: log.address,
        event: parsed.name,
        txHash: log.transactionHash,
        blockNumber: Number(log.blockNumber),
        timestamp: tsMap.get(Number(log.blockNumber)) ?? 0
      });
    }

    items.sort((a, b) => b.blockNumber - a.blockNumber);
    res.json({ user: normalizedUser, items });
  } catch (err) {
    const status = isValidationError(err) ? 400 : 500;
    res.status(status).json({ error: decodeEthersError(err) });
  }
});

export default router;

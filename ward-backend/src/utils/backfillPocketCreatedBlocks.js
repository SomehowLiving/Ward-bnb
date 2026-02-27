import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { controller, provider } from "../config/chain.js";
import { pocketRegistry } from "./pocketRegistry.js";

const PocketFactoryArtifact = JSON.parse(
  fs.readFileSync(
    path.resolve("src/abi/PocketFactory.json"),
    "utf8"
  )
);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}


async function getLogsChunked(filter, fromBlock, toBlock, step = 10) {
  const logs = [];
  const latest =
    toBlock === "latest" ? await provider.getBlockNumber() : toBlock;

  for (let start = fromBlock; start <= latest; start += step) {
    const end = Math.min(start + step - 1, latest);

    const chunk = await provider.getLogs({
      ...filter,
      fromBlock: start,
      toBlock: end
    });

    logs.push(...chunk);
  }

  return logs;

  await sleep(200);
}

function normalizeBlockInput(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export async function backfillPocketCreatedBlocks(options = {}) {
  const fromBlock = normalizeBlockInput(options.fromBlock, 0);

  let toBlock;

  if (options.toBlock === undefined || options.toBlock === null || options.toBlock === "") {
    // user did not provide -> use latest
    toBlock = await provider.getBlockNumber();
  } else if (options.toBlock === "latest") {
    toBlock = await provider.getBlockNumber();
  } else {
    toBlock = normalizeBlockInput(options.toBlock, 0);
  }

  const dryRun = Boolean(options.dryRun);

  const factoryAddress = ethers.getAddress(await controller.factory());
  const iface = new ethers.Interface(PocketFactoryArtifact.abi);
  const deployedTopic = iface.getEvent("PocketDeployed").topicHash;

  const logs = await getLogsChunked(
    {
      address: factoryAddress,
      topics: [deployedTopic]
    },
    fromBlock,
    toBlock,
    10 // must match provider limit
  );


  const deployedMap = new Map();
  for (const log of logs) {
    try {
      const parsed = iface.parseLog(log);
      if (!parsed || parsed.name !== "PocketDeployed") continue;
      const pocket = ethers.getAddress(parsed.args.pocket).toLowerCase();
      const owner = ethers.getAddress(parsed.args.owner);
      const blockNumber = Number(log.blockNumber);
      const existing = deployedMap.get(pocket);
      if (!existing || blockNumber < existing.createdBlock) {
        deployedMap.set(pocket, { owner, createdBlock: blockNumber });
      }
    } catch {
      // Ignore malformed/unexpected logs.
    }
  }

  const knownOwners = pocketRegistry.getAllOwners();
  const knownPockets = new Set();
  for (const owner of knownOwners) {
    const pockets = pocketRegistry.getPocketsByOwner(owner);
    for (const pocket of pockets) knownPockets.add(pocket.toLowerCase());
  }

  let matched = 0;
  let updated = 0;
  const skipped = [];

  for (const pocket of knownPockets) {
    const registryRecord = pocketRegistry.getPocketRecord(pocket);
    const deployment = deployedMap.get(pocket);
    if (!deployment) {
      skipped.push({ pocket, reason: "not_found_in_factory_logs" });
      continue;
    }
    matched += 1;

    const hasCorrectBlock = Number.isFinite(registryRecord?.createdBlock) && registryRecord.createdBlock === deployment.createdBlock;
    if (hasCorrectBlock) continue;

    if (!dryRun) {
      const ownerToPersist = registryRecord?.owner ?? deployment.owner;
      pocketRegistry.addPocket(ownerToPersist, pocket, deployment.createdBlock);
    }
    updated += 1;
  }

  return {
    factory: factoryAddress,
    fromBlock,
    toBlock,
    dryRun,
    logsScanned: logs.length,
    knownPockets: knownPockets.size,
    matched,
    updated,
    skipped
  };
}

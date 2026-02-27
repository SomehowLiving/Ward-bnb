import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.resolve(__dirname, "../data/activity-cache.json");

function getDefaultCache() {
    return {
        lastScannedBlock: 0,
        timestamp: Date.now(),
        activities: {
            credits: {},
            repayments: {},
            pockets: {},
            executions: {}
        }
    };
}

export function readActivityCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const content = fs.readFileSync(CACHE_FILE, "utf-8");
            return JSON.parse(content);
        }
    } catch (err) {
        console.warn("Failed to read activity cache:", err);
    }
    return getDefaultCache();
}

export function writeActivityCache(cache) {
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
    } catch (err) {
        console.error("Failed to write activity cache:", err);
    }
}

export function getLastScannedBlock() {
    const cache = readActivityCache();
    return cache.lastScannedBlock || 0;
}

export function setLastScannedBlock(block) {
    const cache = readActivityCache();
    cache.lastScannedBlock = block;
    cache.timestamp = Date.now();
    writeActivityCache(cache);
}

export function addCreditActivity(user, activity) {
    const cache = readActivityCache();
    const userAddr = user.toLowerCase();
    if (!cache.activities.credits[userAddr]) {
        cache.activities.credits[userAddr] = [];
    }
    cache.activities.credits[userAddr].push(activity);
    writeActivityCache(cache);
}

export function addRepaymentActivity(user, activity) {
    const cache = readActivityCache();
    const userAddr = user.toLowerCase();
    if (!cache.activities.repayments[userAddr]) {
        cache.activities.repayments[userAddr] = [];
    }
    cache.activities.repayments[userAddr].push(activity);
    writeActivityCache(cache);
}

export function addPocketActivity(user, activity) {
    const cache = readActivityCache();
    const userAddr = user.toLowerCase();
    if (!cache.activities.pockets[userAddr]) {
        cache.activities.pockets[userAddr] = [];
    }
    cache.activities.pockets[userAddr].push(activity);
    writeActivityCache(cache);
}

export function addExecutionActivity(user, activity) {
    const cache = readActivityCache();
    const userAddr = user.toLowerCase();
    if (!cache.activities.executions[userAddr]) {
        cache.activities.executions[userAddr] = [];
    }
    cache.activities.executions[userAddr].push(activity);
    writeActivityCache(cache);
}

export function getCreditActivitiesForUser(user) {
    const cache = readActivityCache();
    const userAddr = user.toLowerCase();
    return cache.activities.credits[userAddr] || [];
}

export function getRepaymentActivitiesForUser(user) {
    const cache = readActivityCache();
    const userAddr = user.toLowerCase();
    return cache.activities.repayments[userAddr] || [];
}

export function getPocketActivitiesForUser(user) {
    const cache = readActivityCache();
    const userAddr = user.toLowerCase();
    return cache.activities.pockets[userAddr] || [];
}

export function getExecutionActivitiesForUser(user) {
    const cache = readActivityCache();
    const userAddr = user.toLowerCase();
    return cache.activities.executions[userAddr] || [];
}

export function clearActivityCache() {
    writeActivityCache(getDefaultCache());
}

// import fs from "fs";
// import path from "path";
// import { fileURLToPath } from "url";
// import { ethers } from "ethers";
// import { controller, getVaultContract, provider } from "../config/chain.js";
// import { pocketRegistry } from "./pocketRegistry.js";

// const __dirname = path.dirname(fileURLToPath(import.meta.url));
// const dataDir = path.resolve(__dirname, "../../data");
// const cacheFile = path.resolve(dataDir, "activity-cache.json");

// const SCAN_BATCH = Number(process.env.ACTIVITY_SCAN_BATCH || 100);
// const SCAN_RETRY_MS = Number(process.env.ACTIVITY_RETRY_MS || 350);

// const vaultEventAbi = [
//   "event CreditRequested(bytes32 indexed requestId,address indexed user,address indexed merchant,address pocket,uint256 principal,uint256 installmentAmount,uint256 totalInstallments,uint256 interval,uint256 nextDueDate)",
//   "event InstallmentRepaid(bytes32 indexed requestId,address indexed user,uint256 amount,uint256 remaining,uint256 installmentsPaid,uint256 nextDueDate)",
//   "event LoanClosed(bytes32 indexed requestId,address indexed user)",
//   "event LoanLiquidated(bytes32 indexed requestId,address indexed user,uint256 principal)"
// ];
// const factoryEventAbi = ["event PocketDeployed(address pocket,address owner)"];
// const merchantEventAbi = [
//   "event Purchased(address buyer,uint256 amount)",
//   "event AttackAttempted(address indexed caller,uint256 observedCallerBalance,bool success,bytes returnData)"
// ];

// const vaultIface = new ethers.Interface(vaultEventAbi);
// const factoryIface = new ethers.Interface(factoryEventAbi);
// const merchantIface = new ethers.Interface(merchantEventAbi);

// function normalize(addr) {
//   return ethers.getAddress(addr);
// }

// function lower(addr) {
//   return normalize(addr).toLowerCase();
// }

// function ensureUser(cache, user) {
//   const u = lower(user);
//   if (!cache.users[u]) {
//     cache.users[u] = {
//       credits: [],
//       repayments: [],
//       pockets: [],
//       executions: []
//     };
//   }
//   return cache.users[u];
// }

// function defaultFromBlock() {
//   const configured = process.env.DEPLOYMENT_BLOCK;
//   if (configured !== undefined && configured !== "") {
//     const n = Number(configured);
//     if (Number.isFinite(n) && n >= 0) return n;
//   }
//   return 0;
// }

// function loadCache() {
//   fs.mkdirSync(dataDir, { recursive: true });
//   if (!fs.existsSync(cacheFile)) {
//     const initial = {
//       lastScannedBlock: defaultFromBlock() - 1,
//       chainId: null,
//       vault: null,
//       factory: null,
//       controller: null,
//       users: {},
//       pocketOwner: {}
//     };
//     fs.writeFileSync(cacheFile, JSON.stringify(initial, null, 2));
//   }
//   const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
//   parsed.users ??= {};
//   parsed.pocketOwner ??= {};
//   if (parsed.lastScannedBlock === undefined || parsed.lastScannedBlock === null) {
//     parsed.lastScannedBlock = defaultFromBlock() - 1;
//   }
//   return parsed;
// }

// function persistCache(cache) {
//   const tmp = `${cacheFile}.tmp`;
//   fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
//   fs.renameSync(tmp, cacheFile);
// }

// async function getLogsChunked(baseFilter, fromBlock, toBlock, step = SCAN_BATCH) {
//   const logs = [];
//   for (let start = fromBlock; start <= toBlock; start += step) {
//     const end = Math.min(start + step - 1, toBlock);
//     let chunk = [];
//     let ok = false;
//     let attempt = 0;
//     while (!ok && attempt < 5) {
//       attempt += 1;
//       try {
//         chunk = await provider.getLogs({ ...baseFilter, fromBlock: start, toBlock: end });
//         ok = true;
//       } catch (err) {
//         const msg = String(err?.message || err);
//         const rateLimited =
//           msg.includes("rate limit") || msg.includes("missing response for request");
//         if (!rateLimited || attempt >= 5) {
//           if (attempt >= 5) {
//             // Skip this chunk under sustained provider throttling.
//             ok = true;
//             chunk = [];
//             break;
//           }
//           throw err;
//         }
//         await new Promise((r) => setTimeout(r, SCAN_RETRY_MS * attempt));
//       }
//     }
//     logs.push(...chunk);
//     await new Promise((r) => setTimeout(r, 50));
//   }
//   return logs;
// }

// async function getBlockTimestamp(blockNumber) {
//   const block = await provider.getBlock(blockNumber);
//   return Number(block?.timestamp ?? 0);
// }

// function upsertCredit(userStore, entry) {
//   const idx = userStore.credits.findIndex((x) => x.requestId === entry.requestId);
//   if (idx === -1) userStore.credits.push(entry);
//   else userStore.credits[idx] = { ...userStore.credits[idx], ...entry };
// }

// export async function syncActivityCache() {
//   const cache = loadCache();

//   const vault = getVaultContract();
//   const [network, vaultAddress, factoryAddress, controllerAddress, latest] = await Promise.all([
//     provider.getNetwork(),
//     vault.getAddress(),
//     controller.factory(),
//     controller.getAddress(),
//     provider.getBlockNumber()
//   ]);

//   cache.chainId = Number(network.chainId);
//   cache.vault = normalize(vaultAddress);
//   cache.factory = normalize(factoryAddress);
//   cache.controller = normalize(controllerAddress);

//   const fromBlock = Math.max(defaultFromBlock(), Number(cache.lastScannedBlock) + 1);
//   if (fromBlock > latest) return cache;

//   const creditRequestedLogs = await getLogsChunked(
//     { address: cache.vault, topics: [vaultIface.getEvent("CreditRequested").topicHash] },
//     fromBlock,
//     latest
//   );
//   const installmentLogs = await getLogsChunked(
//     { address: cache.vault, topics: [vaultIface.getEvent("InstallmentRepaid").topicHash] },
//     fromBlock,
//     latest
//   );
//   const loanClosedLogs = await getLogsChunked(
//     { address: cache.vault, topics: [vaultIface.getEvent("LoanClosed").topicHash] },
//     fromBlock,
//     latest
//   );
//   const liquidatedLogs = await getLogsChunked(
//     { address: cache.vault, topics: [vaultIface.getEvent("LoanLiquidated").topicHash] },
//     fromBlock,
//     latest
//   );
//   const pocketLogs = await getLogsChunked(
//     { address: cache.factory, topics: [factoryIface.getEvent("PocketDeployed").topicHash] },
//     fromBlock,
//     latest
//   );

//   for (const log of creditRequestedLogs) {
//     let parsed;
//     try {
//       parsed = vaultIface.parseLog(log);
//     } catch {
//       continue;
//     }
//     const user = lower(parsed.args.user);
//     const merchant = normalize(parsed.args.merchant);
//     const pocket = normalize(parsed.args.pocket);
//     const ts = await getBlockTimestamp(Number(log.blockNumber));
//     const userStore = ensureUser(cache, user);

//     cache.pocketOwner[lower(pocket)] = user;
//     pocketRegistry.addPocket(user, pocket, Number(log.blockNumber));

//     upsertCredit(userStore, {
//       requestId: parsed.args.requestId,
//       merchant,
//       pocket,
//       principal: parsed.args.principal.toString(),
//       remaining: parsed.args.principal.toString(),
//       installmentAmount: parsed.args.installmentAmount.toString(),
//       installmentsPaid: "0",
//       totalInstallments: parsed.args.totalInstallments.toString(),
//       interval: parsed.args.interval.toString(),
//       nextDueDate: parsed.args.nextDueDate.toString(),
//       defaulted: false,
//       closed: false,
//       createdTxHash: log.transactionHash,
//       createdBlockNumber: Number(log.blockNumber),
//       createdTimestamp: ts
//     });

//     if (!userStore.pockets.some((p) => lower(p.address) === lower(pocket))) {
//       userStore.pockets.push({
//         address: pocket,
//         createdBlock: Number(log.blockNumber),
//         txHash: log.transactionHash,
//         timestamp: ts
//       });
//     }
//   }

//   for (const log of installmentLogs) {
//     let parsed;
//     try {
//       parsed = vaultIface.parseLog(log);
//     } catch {
//       continue;
//     }
//     const user = lower(parsed.args.user);
//     const userStore = ensureUser(cache, user);
//     const ts = await getBlockTimestamp(Number(log.blockNumber));

//     userStore.repayments.push({
//       requestId: parsed.args.requestId,
//       amount: parsed.args.amount.toString(),
//       remaining: parsed.args.remaining.toString(),
//       installmentsPaid: parsed.args.installmentsPaid.toString(),
//       blockNumber: Number(log.blockNumber),
//       txHash: log.transactionHash,
//       timestamp: ts
//     });

//     const idx = userStore.credits.findIndex((x) => x.requestId === parsed.args.requestId);
//     if (idx !== -1) {
//       userStore.credits[idx].remaining = parsed.args.remaining.toString();
//       userStore.credits[idx].installmentsPaid = parsed.args.installmentsPaid.toString();
//       userStore.credits[idx].nextDueDate = parsed.args.nextDueDate.toString();
//       if (parsed.args.remaining === 0n) userStore.credits[idx].closed = true;
//     }
//   }

//   for (const log of loanClosedLogs) {
//     let parsed;
//     try {
//       parsed = vaultIface.parseLog(log);
//     } catch {
//       continue;
//     }
//     const user = lower(parsed.args.user);
//     const userStore = ensureUser(cache, user);
//     const idx = userStore.credits.findIndex((x) => x.requestId === parsed.args.requestId);
//     if (idx !== -1) userStore.credits[idx].closed = true;
//   }

//   for (const log of liquidatedLogs) {
//     let parsed;
//     try {
//       parsed = vaultIface.parseLog(log);
//     } catch {
//       continue;
//     }
//     const user = lower(parsed.args.user);
//     const userStore = ensureUser(cache, user);
//     const idx = userStore.credits.findIndex((x) => x.requestId === parsed.args.requestId);
//     if (idx !== -1) userStore.credits[idx].defaulted = true;
//   }

//   for (const log of pocketLogs) {
//     let parsed;
//     try {
//       parsed = factoryIface.parseLog(log);
//     } catch {
//       continue;
//     }
//     const pocket = normalize(parsed.args.pocket);
//     const owner = lower(parsed.args.owner);
//     const ts = await getBlockTimestamp(Number(log.blockNumber));
//     const userStore = ensureUser(cache, owner);

//     cache.pocketOwner[lower(pocket)] = owner;
//     pocketRegistry.addPocket(owner, pocket, Number(log.blockNumber));

//     if (!userStore.pockets.some((p) => lower(p.address) === lower(pocket))) {
//       userStore.pockets.push({
//         address: pocket,
//         createdBlock: Number(log.blockNumber),
//         txHash: log.transactionHash,
//         timestamp: ts
//       });
//     }
//   }

//   const good = process.env.MERCHANT_GOOD_ADDRESS;
//   const bad = process.env.MERCHANT_MALICIOUS_ADDRESS;
//   const merchants = [good, bad].filter(Boolean).map((x) => normalize(x));
//   for (const merchant of merchants) {
//     const purchasedLogs = await getLogsChunked(
//       { address: merchant, topics: [merchantIface.getEvent("Purchased").topicHash] },
//       fromBlock,
//       latest
//     );
//     const attackLogs = await getLogsChunked(
//       { address: merchant, topics: [merchantIface.getEvent("AttackAttempted").topicHash] },
//       fromBlock,
//       latest
//     );

//     for (const log of purchasedLogs.concat(attackLogs)) {
//       let parsed;
//       try {
//         parsed = merchantIface.parseLog(log);
//       } catch {
//         continue;
//       }
//       const pocket = parsed.name === "Purchased" ? normalize(parsed.args.buyer) : normalize(parsed.args.caller);
//       let owner = cache.pocketOwner[lower(pocket)];
//       if (!owner) {
//         try {
//           owner = lower(await controller.pocketOwner(pocket));
//           cache.pocketOwner[lower(pocket)] = owner;
//         } catch {
//           continue;
//         }
//       }

//       const userStore = ensureUser(cache, owner);
//       if (userStore.executions.some((x) => x.txHash === log.transactionHash && x.event === parsed.name)) {
//         continue;
//       }
//       const ts = await getBlockTimestamp(Number(log.blockNumber));
//       userStore.executions.push({
//         merchant,
//         event: parsed.name,
//         blockNumber: Number(log.blockNumber),
//         txHash: log.transactionHash,
//         timestamp: ts
//       });
//     }
//   }

//   for (const u of Object.values(cache.users)) {
//     u.credits.sort((a, b) => b.createdBlockNumber - a.createdBlockNumber);
//     u.repayments.sort((a, b) => b.blockNumber - a.blockNumber);
//     u.pockets.sort((a, b) => b.createdBlock - a.createdBlock);
//     u.executions.sort((a, b) => b.blockNumber - a.blockNumber);
//   }

//   cache.lastScannedBlock = latest;
//   persistCache(cache);
//   return cache;
// }

// export function getActivityCacheSnapshot() {
//   return loadCache();
// }

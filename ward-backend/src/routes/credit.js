import express from "express";
import { ethers } from "ethers";

import { controller, controllerSigner, getVaultContract, provider } from "../config/chain.js";
import { decodeEthersError } from "../utils/errors.js";
import { requireAddress, ValidationError } from "../utils/validate.js";
import { pocketRegistry } from "../utils/pocketRegistry.js";

const router = express.Router();

function requireBytes32(value, name) {
  if (typeof value !== "string" || !ethers.isHexString(value, 32)) {
    throw new ValidationError(`Invalid bytes32: ${name}`);
  }
}

function getAddressLower(value) {
  return ethers.getAddress(value).toLowerCase();
}

const CREDIT_SCAN_BATCH = Number(process.env.ACTIVITY_SCAN_BATCH || 500);
const CREDIT_LOOKBACK_BLOCKS = Number(process.env.ACTIVITY_LOOKBACK_BLOCKS || 250000);

function resolveFromBlock(latestBlock) {
  const configured = process.env.DEPLOYMENT_BLOCK;
  if (configured !== undefined && configured !== "") {
    const n = Number(configured);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return Math.max(0, latestBlock - CREDIT_LOOKBACK_BLOCKS);
}

async function getLogsChunked(baseFilter, fromBlock, toBlock, step = CREDIT_SCAN_BATCH) {
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += step) {
    const end = Math.min(start + step - 1, toBlock);
    const chunk = await provider.getLogs({ ...baseFilter, fromBlock: start, toBlock: end });
    logs.push(...chunk);
  }
  return logs;
}

router.get("/state/:user", async (req, res) => {
  try {
    const { user } = req.params;
    requireAddress(user, "user");

    const vault = getVaultContract();
    const [position, availableCredit] = await Promise.all([
      vault.positions(user),
      vault.availableCredit(user)
    ]);

    res.json({
      user: ethers.getAddress(user),
      deposited: position.deposited.toString(),
      borrowed: position.borrowed.toString(),
      availableCredit: availableCredit.toString()
    });
  } catch (err) {
    const status = err instanceof ValidationError ? 400 : 500;
    res.status(status).json({
      error: err instanceof ValidationError ? err.message : decodeEthersError(err)
    });
  }
});

router.get("/request/:requestId", async (req, res) => {
  try {
    const { requestId } = req.params;
    requireBytes32(requestId, "requestId");

    const vault = getVaultContract();
    const [creditPosition, borrower] = await Promise.all([
      vault.creditPositions(requestId),
      vault.creditBorrower(requestId)
    ]);

    const exists = creditPosition.principal > 0n;

    const installmentDue =
      creditPosition.installmentsPaid + 1n === creditPosition.totalInstallments
        ? creditPosition.remaining
        : creditPosition.installmentAmount;

    res.json({
      requestId,
      exists,
      borrower,
      principal: creditPosition.principal.toString(),
      remaining: creditPosition.remaining.toString(),
      installmentAmount: creditPosition.installmentAmount.toString(),
      installmentsPaid: creditPosition.installmentsPaid.toString(),
      totalInstallments: creditPosition.totalInstallments.toString(),
      interval: creditPosition.interval.toString(),
      nextDueDate: creditPosition.nextDueDate.toString(),
      installmentDue: installmentDue.toString(),
      defaulted: creditPosition.defaulted,
      closed: creditPosition.closed,
      pocket: creditPosition.pocket
    });
  } catch (err) {
    const status = err instanceof ValidationError ? 400 : 500;
    res.status(status).json({
      error: err instanceof ValidationError ? err.message : decodeEthersError(err)
    });
  }
});

router.get("/requests/:user", async (req, res) => {
  try {
    const { user } = req.params;
    requireAddress(user, "user");

    const normalizedUser = ethers.getAddress(user);
    const vault = getVaultContract();
    const latest = await provider.getBlockNumber();
    const fromBlock = resolveFromBlock(latest);
    const userTopic = ethers.zeroPadValue(normalizedUser, 32);
    const topic = ethers.id(
      "CreditRequested(bytes32,address,address,address,uint256,uint256,uint256,uint256,uint256)"
    );

    const logs = await getLogsChunked(
      { address: await vault.getAddress(), topics: [topic, null, userTopic] },
      fromBlock,
      latest
    );

    const items = [];
    for (const log of logs) {
      let parsed;
      try {
        parsed = vault.interface.parseLog(log);
      } catch {
        continue;
      }
      if (!parsed || parsed.name !== "CreditRequested") continue;

      const requestId = parsed.args.requestId;
      const pocket = parsed.args.pocket;

      const [cp, borrower, block] = await Promise.all([
        vault.creditPositions(requestId),
        vault.creditBorrower(requestId),
        provider.getBlock(Number(log.blockNumber))
      ]);
      if (ethers.getAddress(borrower) !== normalizedUser) continue;

      pocketRegistry.addPocket(normalizedUser, pocket, Number(log.blockNumber));

      const installmentDue =
        cp.installmentsPaid + 1n === cp.totalInstallments ? cp.remaining : cp.installmentAmount;

      items.push({
        requestId,
        merchant: parsed.args.merchant,
        pocket,
        principal: cp.principal.toString(),
        remaining: cp.remaining.toString(),
        installmentAmount: cp.installmentAmount.toString(),
        installmentDue: installmentDue.toString(),
        installmentsPaid: cp.installmentsPaid.toString(),
        totalInstallments: cp.totalInstallments.toString(),
        interval: cp.interval.toString(),
        nextDueDate: cp.nextDueDate.toString(),
        defaulted: cp.defaulted,
        closed: cp.closed,
        createdTxHash: log.transactionHash,
        createdBlockNumber: Number(log.blockNumber),
        createdTimestamp: Number(block?.timestamp ?? 0)
      });
    }

    items.sort((a, b) => b.createdBlockNumber - a.createdBlockNumber);
    res.json({ user: normalizedUser, fromBlock, items });
  } catch (err) {
    const status = err instanceof ValidationError ? 400 : 500;
    res.status(status).json({
      error: err instanceof ValidationError ? err.message : decodeEthersError(err)
    });
  }
});

router.post("/request", async (req, res) => {
  try {
    const { user, merchant, amount, installmentCount, interval, salt } = req.body ?? {};

    requireAddress(user, "user");
    requireAddress(merchant, "merchant");

    const requestedAmount = BigInt(amount);
    const requestedInstallmentCount = BigInt(installmentCount);
    const requestedInterval = BigInt(interval);
    const requestedSalt = salt === undefined ? BigInt(Date.now()) : BigInt(salt);

    if (requestedAmount <= 0n) throw new ValidationError("amount must be > 0");
    if (requestedInstallmentCount <= 0n) throw new ValidationError("installmentCount must be > 0");
    if (requestedInterval <= 0n) throw new ValidationError("interval must be > 0");

    const signerAddress = await controllerSigner.getAddress();
    if (getAddressLower(user) !== getAddressLower(signerAddress)) {
      return res.status(400).json({
        error:
          "requestCredit uses msg.sender in the current vault contract; backend signer must equal user or frontend should call vault directly"
      });
    }

    const vault = getVaultContract();
    const availableCredit = await vault.availableCredit(user);
    if (requestedAmount > availableCredit) {
      return res.status(400).json({
        error: "Insufficient credit",
        availableCredit: availableCredit.toString(),
        requestedAmount: requestedAmount.toString()
      });
    }

    const tx = await vault.requestCredit(
      merchant,
      requestedAmount,
      requestedInstallmentCount,
      requestedInterval,
      requestedSalt
    );
    const receipt = await tx.wait();

    let requestEvent = null;
    for (const log of receipt.logs ?? []) {
      try {
        const parsed = vault.interface.parseLog(log);
        if (parsed?.name === "CreditRequested") {
          requestEvent = parsed;
          break;
        }
      } catch {
        // ignore unrelated logs
      }
    }

    if (!requestEvent) {
      throw new Error("CreditRequested event not found");
    }

    const requestId = requestEvent.args.requestId;
    const pocket = requestEvent.args.pocket;
    const nextDueDate = requestEvent.args.nextDueDate;

    const [validPocket, pocketOwner] = await Promise.all([
      controller.validPocket(pocket),
      controller.pocketOwner(pocket)
    ]);

    if (!validPocket || getAddressLower(pocketOwner) !== getAddressLower(user)) {
      throw new Error("Invariant violation: returned pocket does not match controller mapping for user");
    }

    res.json({
      requestId,
      pocket,
      nextDueDate: nextDueDate.toString(),
      txHash: receipt.hash
    });
  } catch (err) {
    const status = err instanceof ValidationError ? 400 : 500;
    res.status(status).json({
      error: err instanceof ValidationError ? err.message : decodeEthersError(err)
    });
  }
});

router.post("/repay", async (req, res) => {
  try {
    const { requestId, user } = req.body ?? {};
    requireBytes32(requestId, "requestId");
    requireAddress(user, "user");

    const signerAddress = await controllerSigner.getAddress();
    if (getAddressLower(user) !== getAddressLower(signerAddress)) {
      return res.status(400).json({
        error:
          "repayInstallment uses msg.sender in the current vault contract; backend signer must equal user or frontend should call vault directly"
      });
    }

    const vault = getVaultContract();
    const creditPosition = await vault.creditPositions(requestId);
    if (creditPosition.principal === 0n) {
      return res.status(404).json({ error: "Credit request not found" });
    }

    const installmentDue =
      creditPosition.installmentsPaid + 1n === creditPosition.totalInstallments
        ? creditPosition.remaining
        : creditPosition.installmentAmount;

    const tx = await vault.repayInstallment(requestId, { value: installmentDue });
    const receipt = await tx.wait();

    res.json({
      requestId,
      repaidAmount: installmentDue.toString(),
      txHash: receipt.hash
    });
  } catch (err) {
    const status = err instanceof ValidationError ? 400 : 500;
    res.status(status).json({
      error: err instanceof ValidationError ? err.message : decodeEthersError(err)
    });
  }
});

router.post("/liquidate", async (req, res) => {
  try {
    const { requestId } = req.body ?? {};
    requireBytes32(requestId, "requestId");

    const vault = getVaultContract();
    const tx = await vault.liquidate(requestId);
    const receipt = await tx.wait();

    res.json({ requestId, txHash: receipt.hash });
  } catch (err) {
    const status = err instanceof ValidationError ? 400 : 500;
    res.status(status).json({
      error: err instanceof ValidationError ? err.message : decodeEthersError(err)
    });
  }
});

export default router;


// import express from "express";
// import { ethers } from "ethers";

// import { controller, controllerSigner, getVaultContract } from "../config/chain.js";
// import { decodeEthersError } from "../utils/errors.js";
// import { requireAddress, ValidationError } from "../utils/validate.js";
// import { getActivityCacheSnapshot, syncActivityCache } from "../utils/activityCache.js";

// const router = express.Router();

// function requireBytes32(value, name) {
//   if (typeof value !== "string" || !ethers.isHexString(value, 32)) {
//     throw new ValidationError(`Invalid bytes32: ${name}`);
//   }
// }

// function getAddressLower(value) {
//   return ethers.getAddress(value).toLowerCase();
// }

// router.get("/state/:user", async (req, res) => {
//   try {
//     const { user } = req.params;
//     requireAddress(user, "user");

//     const vault = getVaultContract();
//     const [position, availableCredit] = await Promise.all([
//       vault.positions(user),
//       vault.availableCredit(user)
//     ]);

//     res.json({
//       user: ethers.getAddress(user),
//       deposited: position.deposited.toString(),
//       borrowed: position.borrowed.toString(),
//       availableCredit: availableCredit.toString()
//     });
//   } catch (err) {
//     const status = err instanceof ValidationError ? 400 : 500;
//     res.status(status).json({
//       error: err instanceof ValidationError ? err.message : decodeEthersError(err)
//     });
//   }
// });

// router.get("/request/:requestId", async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     requireBytes32(requestId, "requestId");

//     const vault = getVaultContract();
//     const [creditPosition, borrower] = await Promise.all([
//       vault.creditPositions(requestId),
//       vault.creditBorrower(requestId)
//     ]);

//     const exists = creditPosition.principal > 0n;

//     const installmentDue =
//       creditPosition.installmentsPaid + 1n === creditPosition.totalInstallments
//         ? creditPosition.remaining
//         : creditPosition.installmentAmount;

//     res.json({
//       requestId,
//       exists,
//       borrower,
//       principal: creditPosition.principal.toString(),
//       remaining: creditPosition.remaining.toString(),
//       installmentAmount: creditPosition.installmentAmount.toString(),
//       installmentsPaid: creditPosition.installmentsPaid.toString(),
//       totalInstallments: creditPosition.totalInstallments.toString(),
//       interval: creditPosition.interval.toString(),
//       nextDueDate: creditPosition.nextDueDate.toString(),
//       installmentDue: installmentDue.toString(),
//       defaulted: creditPosition.defaulted,
//       closed: creditPosition.closed,
//       pocket: creditPosition.pocket
//     });
//   } catch (err) {
//     const status = err instanceof ValidationError ? 400 : 500;
//     res.status(status).json({
//       error: err instanceof ValidationError ? err.message : decodeEthersError(err)
//     });
//   }
// });

// router.get("/requests/:user", async (req, res) => {
//   try {
//     const { user } = req.params;
//     requireAddress(user, "user");
//     await syncActivityCache();
//     const normalizedUser = ethers.getAddress(user);
//     const cache = getActivityCacheSnapshot();
//     const items = (cache.users?.[normalizedUser.toLowerCase()]?.credits ?? []).map((x) => {
//       const installmentsPaid = BigInt(x.installmentsPaid);
//       const totalInstallments = BigInt(x.totalInstallments);
//       const remaining = BigInt(x.remaining);
//       const installmentAmount = BigInt(x.installmentAmount);
//       const installmentDue =
//         installmentsPaid + 1n === totalInstallments ? remaining : installmentAmount;
//       return { ...x, installmentDue: installmentDue.toString() };
//     });
//     res.json({ user: normalizedUser, items });
//   } catch (err) {
//     const status = err instanceof ValidationError ? 400 : 500;
//     res.status(status).json({
//       error: err instanceof ValidationError ? err.message : decodeEthersError(err)
//     });
//   }
// });

// router.post("/request", async (req, res) => {
//   try {
//     const { user, merchant, amount, installmentCount, interval, salt } = req.body ?? {};

//     requireAddress(user, "user");
//     requireAddress(merchant, "merchant");

//     const requestedAmount = BigInt(amount);
//     const requestedInstallmentCount = BigInt(installmentCount);
//     const requestedInterval = BigInt(interval);
//     const requestedSalt = salt === undefined ? BigInt(Date.now()) : BigInt(salt);

//     if (requestedAmount <= 0n) throw new ValidationError("amount must be > 0");
//     if (requestedInstallmentCount <= 0n) throw new ValidationError("installmentCount must be > 0");
//     if (requestedInterval <= 0n) throw new ValidationError("interval must be > 0");

//     const signerAddress = await controllerSigner.getAddress();
//     if (getAddressLower(user) !== getAddressLower(signerAddress)) {
//       return res.status(400).json({
//         error:
//           "requestCredit uses msg.sender in the current vault contract; backend signer must equal user or frontend should call vault directly"
//       });
//     }

//     const vault = getVaultContract();
//     const availableCredit = await vault.availableCredit(user);
//     if (requestedAmount > availableCredit) {
//       return res.status(400).json({
//         error: "Insufficient credit",
//         availableCredit: availableCredit.toString(),
//         requestedAmount: requestedAmount.toString()
//       });
//     }

//     const tx = await vault.requestCredit(
//       merchant,
//       requestedAmount,
//       requestedInstallmentCount,
//       requestedInterval,
//       requestedSalt
//     );
//     const receipt = await tx.wait();

//     let requestEvent = null;
//     for (const log of receipt.logs ?? []) {
//       try {
//         const parsed = vault.interface.parseLog(log);
//         if (parsed?.name === "CreditRequested") {
//           requestEvent = parsed;
//           break;
//         }
//       } catch {
//         // ignore unrelated logs
//       }
//     }

//     if (!requestEvent) {
//       throw new Error("CreditRequested event not found");
//     }

//     const requestId = requestEvent.args.requestId;
//     const pocket = requestEvent.args.pocket;
//     const nextDueDate = requestEvent.args.nextDueDate;

//     const [validPocket, pocketOwner] = await Promise.all([
//       controller.validPocket(pocket),
//       controller.pocketOwner(pocket)
//     ]);

//     if (!validPocket || getAddressLower(pocketOwner) !== getAddressLower(user)) {
//       throw new Error("Invariant violation: returned pocket does not match controller mapping for user");
//     }

//     res.json({
//       requestId,
//       pocket,
//       nextDueDate: nextDueDate.toString(),
//       txHash: receipt.hash
//     });
//   } catch (err) {
//     const status = err instanceof ValidationError ? 400 : 500;
//     res.status(status).json({
//       error: err instanceof ValidationError ? err.message : decodeEthersError(err)
//     });
//   }
// });

// router.post("/repay", async (req, res) => {
//   try {
//     const { requestId, user } = req.body ?? {};
//     requireBytes32(requestId, "requestId");
//     requireAddress(user, "user");

//     const signerAddress = await controllerSigner.getAddress();
//     if (getAddressLower(user) !== getAddressLower(signerAddress)) {
//       return res.status(400).json({
//         error:
//           "repayInstallment uses msg.sender in the current vault contract; backend signer must equal user or frontend should call vault directly"
//       });
//     }

//     const vault = getVaultContract();
//     const creditPosition = await vault.creditPositions(requestId);
//     if (creditPosition.principal === 0n) {
//       return res.status(404).json({ error: "Credit request not found" });
//     }

//     const installmentDue =
//       creditPosition.installmentsPaid + 1n === creditPosition.totalInstallments
//         ? creditPosition.remaining
//         : creditPosition.installmentAmount;

//     const tx = await vault.repayInstallment(requestId, { value: installmentDue });
//     const receipt = await tx.wait();

//     res.json({
//       requestId,
//       repaidAmount: installmentDue.toString(),
//       txHash: receipt.hash
//     });
//   } catch (err) {
//     const status = err instanceof ValidationError ? 400 : 500;
//     res.status(status).json({
//       error: err instanceof ValidationError ? err.message : decodeEthersError(err)
//     });
//   }
// });

// router.post("/liquidate", async (req, res) => {
//   try {
//     const { requestId } = req.body ?? {};
//     requireBytes32(requestId, "requestId");

//     const vault = getVaultContract();
//     const tx = await vault.liquidate(requestId);
//     const receipt = await tx.wait();

//     res.json({ requestId, txHash: receipt.hash });
//   } catch (err) {
//     const status = err instanceof ValidationError ? 400 : 500;
//     res.status(status).json({
//       error: err instanceof ValidationError ? err.message : decodeEthersError(err)
//     });
//   }
// });

// export default router;

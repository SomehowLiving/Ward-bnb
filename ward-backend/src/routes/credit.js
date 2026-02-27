import express from "express";
import { ethers } from "ethers";

import { controller, controllerSigner, getVaultContract } from "../config/chain.js";
import { decodeEthersError } from "../utils/errors.js";
import { requireAddress, ValidationError } from "../utils/validate.js";

const router = express.Router();

function requireBytes32(value, name) {
  if (typeof value !== "string" || !ethers.isHexString(value, 32)) {
    throw new ValidationError(`Invalid bytes32: ${name}`);
  }
}

function getAddressLower(value) {
  return ethers.getAddress(value).toLowerCase();
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

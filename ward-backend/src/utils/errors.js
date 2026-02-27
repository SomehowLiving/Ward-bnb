import dotenv from "dotenv";
import { ethers } from "ethers";
dotenv.config();

const ERROR_STRING_SELECTOR = "0x08c379a0";
const PANIC_SELECTOR = "0x4e487b71";

function decodeBuiltInRevert(data) {
  if (typeof data !== "string" || !data.startsWith("0x")) return null;

  if (data.startsWith(ERROR_STRING_SELECTOR)) {
    try {
      const encodedArgs = `0x${data.slice(10)}`;
      const [reason] = new ethers.AbiCoder().decode(["string"], encodedArgs);
      if (typeof reason === "string" && reason.length > 0) return reason;
    } catch { }
  }

  if (data.startsWith(PANIC_SELECTOR)) {
    try {
      const encodedArgs = `0x${data.slice(10)}`;
      const [code] = new ethers.AbiCoder().decode(["uint256"], encodedArgs);
      return `Panic(${code.toString()})`;
    } catch { }
  }

  return null;
}

export function decodeEthersError(err, iface) {
  if (err?.data) {
    const builtIn = decodeBuiltInRevert(err.data);
    if (builtIn) return { type: "REVERT", message: builtIn };

    try {
      const decoded = iface.parseError(err.data);
      if (decoded?.name === "Error" && typeof decoded?.args?.[0] === "string") {
        return { type: "REVERT", message: decoded.args[0] };
      }
      return {
        type: "CONTRACT_ERROR",
        name: decoded.name,
        args: decoded.args
      };
    } catch { }
  }

  if (err?.error) {
    const nested = decodeEthersError(err.error, iface);
    if (nested?.message || nested?.name) return nested;
  }

  if (err?.shortMessage) return { type: "REVERT", message: err.shortMessage };
  if (err?.reason) return { type: "REVERT", message: err.reason };
  if (err?.code) return { type: "RPC_ERROR", message: err.message };
  if (err?.message) return { type: "ERROR", message: err.message };

  return { type: "UNKNOWN", message: "Execution failed" };
}

function cleanupRevertMessage(message) {
  if (!message) return "Execution failed";
  const trimmed = String(message).trim();
  const strippedExecutionPrefix = trimmed.replace(/^execution reverted:?\s*/i, "");
  return strippedExecutionPrefix.replace(/^["']|["']$/g, "").trim() || "Execution failed";
}

export function parseRevertReason(err, iface) {
  const decoded = decodeEthersError(err, iface);
  if (decoded?.message) return cleanupRevertMessage(decoded.message);
  if (decoded?.name === "Error" && typeof decoded?.args?.[0] === "string") {
    return cleanupRevertMessage(decoded.args[0]);
  }
  if (decoded?.name) return decoded.name;
  return "Execution failed";
}

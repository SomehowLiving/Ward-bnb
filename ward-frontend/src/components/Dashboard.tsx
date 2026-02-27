import { useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { ethers } from "ethers";
import {
  CreditRequestState,
  CreditState,
  depositCollateral,
  getCreditRequestState,
  getCreditState,
  getMerchantStatus,
  getPocketNextNonce,
  MerchantStatus,
  relayPocketExecution,
  repayOnVault,
  requestCreditOnVault,
  signExecIntent
} from "../api";

declare global {
  interface Window {
    ethereum?: any;
  }
}

type RequestInfo = {
  requestId: string;
  pocket: string;
  dueDate: string;
};

export default function Dashboard() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();

  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [creditState, setCreditState] = useState<CreditState | null>(null);
  const [activeRequest, setActiveRequest] = useState<RequestInfo | null>(null);
  const [requestState, setRequestState] = useState<CreditRequestState | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [merchantStatus, setMerchantStatus] = useState<MerchantStatus | null>(null);

  const [depositAmount, setDepositAmount] = useState("1");
  const [merchantAddress, setMerchantAddress] = useState("");
  const [creditAmount, setCreditAmount] = useState("0.1");
  const [durationSeconds, setDurationSeconds] = useState("2592000");
  const [salt, setSalt] = useState(String(Date.now()));

  const [executeTarget, setExecuteTarget] = useState("");
  const [executeCalldata, setExecuteCalldata] = useState("0x");
  const [executeExpiryOffset, setExecuteExpiryOffset] = useState("600");

  useEffect(() => {
    if (!isConnected || !address) return;
    if (!window.ethereum) return;

    const init = async () => {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const s = await provider.getSigner();
      setSigner(s);
      await refreshCredit(address);
    };

    void init();
  }, [isConnected, address]);

  useEffect(() => {
    if (!ethers.isAddress(merchantAddress)) {
      setMerchantStatus(null);
      return;
    }
    void safeRun(() => refreshMerchantStatus(merchantAddress));
  }, [merchantAddress]);

  const creditLabel = useMemo(() => {
    if (!creditState) return "Disconnected";
    const deposited = BigInt(creditState.deposited);
    const borrowed = BigInt(creditState.borrowed);
    if (deposited === 0n) return "No deposit";
    if (borrowed === 0n) return "Has deposit";
    return "Borrowed > 0";
  }, [creditState]);

  const requestLabel = useMemo(() => {
    if (!requestState) return "No request loaded";
    if (requestState.repaid) return "Repaid";
    const now = Math.floor(Date.now() / 1000);
    if (Number(requestState.dueDate) < now) return "Defaulted";
    return "Pending execution";
  }, [requestState]);

  async function refreshCredit(user: string) {
    const state = await getCreditState(user);
    setCreditState(state);
  }

  async function refreshRequest(requestId: string) {
    const state = await getCreditRequestState(requestId);
    setRequestState(state);
  }

  async function onDeposit(e: React.FormEvent) {
    e.preventDefault();
    if (!signer || !address) return;
    setError("");
    setStatus("Submitting deposit...");
    await depositCollateral(signer, depositAmount);
    await refreshCredit(address);
    setStatus("Deposit confirmed.");
  }

  async function onRequestCredit(e: React.FormEvent) {
    e.preventDefault();
    if (!signer || !address) return;
    if (merchantStatus?.blocked) throw new Error("Merchant is blocked");

    setError("");
    setStatus("Requesting credit...");

    const created = await requestCreditOnVault(
      signer,
      merchantAddress,
      creditAmount,
      durationSeconds,
      salt
    );

    setActiveRequest(created);
    setExecuteTarget(merchantAddress);

    await Promise.all([refreshCredit(address), refreshRequest(created.requestId)]);
    setStatus("Credit requested and pocket created.");
  }

  async function refreshMerchantStatus(merchant: string) {
    if (!ethers.isAddress(merchant)) {
      setMerchantStatus(null);
      return;
    }
    const state = await getMerchantStatus(merchant);
    setMerchantStatus(state);
  }

  async function onExecute(e: React.FormEvent) {
    e.preventDefault();
    if (!signer || !activeRequest) return;

    setError("");
    setStatus("Preparing relayed execution...");

    const nonce = await getPocketNextNonce(activeRequest.pocket);
    const expiry = BigInt(Math.floor(Date.now() / 1000) + Number(executeExpiryOffset));
    const signature = await signExecIntent(
      signer,
      activeRequest.pocket,
      executeTarget,
      executeCalldata,
      nonce,
      expiry,
      chainId
    );

    const result = await relayPocketExecution({
      pocket: activeRequest.pocket,
      target: executeTarget,
      data: executeCalldata,
      nonce: nonce.toString(),
      expiry: expiry.toString(),
      signature
    });

    setStatus(`Execution relayed: ${result.txHash}`);
    await refreshRequest(activeRequest.requestId);
  }

  async function onRepay() {
    if (!signer || !address || !requestState) return;
    setError("");
    setStatus("Submitting repayment...");
    await repayOnVault(signer, requestState.requestId, requestState.amount);
    await Promise.all([refreshCredit(address), refreshRequest(requestState.requestId)]);
    setStatus("Repayment confirmed.");
  }

  const safeRun = (fn: () => Promise<void>) => fn().catch((err: any) => {
    setError(err?.message || "Action failed");
    setStatus("");
  });

  if (!isConnected) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem" }}>
        <h1>Ward Collateral</h1>
        <p>Connect your wallet to use direct Vault credit + relayed pocket execution.</p>
        <ConnectButton />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>
      <h1>Ward Collateral</h1>
      <p>Connected: {address}</p>
      <p>Chain ID: {chainId}</p>

      <section>
        <h2>Credit Dashboard</h2>
        <button onClick={() => address && safeRun(() => refreshCredit(address))}>Refresh</button>
        <div>Deposited: {creditState?.deposited ?? "-"}</div>
        <div>Borrowed: {creditState?.borrowed ?? "-"}</div>
        <div>Available Credit: {creditState?.availableCredit ?? "-"}</div>
        <div>Credit State: {creditLabel}</div>
      </section>

      <section>
        <h2>Deposit</h2>
        <form onSubmit={(e) => safeRun(() => onDeposit(e))}>
          <input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="Amount BNB" />
          <button type="submit" disabled={!signer}>Deposit</button>
        </form>
      </section>

      <section>
        <h2>Request Credit (User tx)</h2>
        <form onSubmit={(e) => safeRun(() => onRequestCredit(e))}>
          <input value={merchantAddress} onChange={(e) => setMerchantAddress(e.target.value)} placeholder="Merchant address" />
          <input value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="Amount BNB" />
          <input value={durationSeconds} onChange={(e) => setDurationSeconds(e.target.value)} placeholder="Duration seconds" />
          <input value={salt} onChange={(e) => setSalt(e.target.value)} placeholder="Salt" />
          <button type="button" onClick={() => safeRun(() => refreshMerchantStatus(merchantAddress))}>
            Check Merchant
          </button>
          <button type="submit" disabled={!signer || merchantStatus?.blocked}>Buy with Ward</button>
        </form>
        <div>Merchant Flag Count: {merchantStatus?.flagCount ?? "-"}</div>
        <div>Merchant Blocked: {merchantStatus ? String(merchantStatus.blocked) : "-"}</div>
        <div>requestId: {activeRequest?.requestId ?? "-"}</div>
        <div>pocket: {activeRequest?.pocket ?? "-"}</div>
        <div>dueDate: {activeRequest?.dueDate ?? "-"}</div>
      </section>

      <section>
        <h2>Request State</h2>
        {activeRequest && (
          <button onClick={() => safeRun(() => refreshRequest(activeRequest.requestId))}>Refresh Request</button>
        )}
        <div>Status: {requestLabel}</div>
        <div>Amount Owed: {requestState?.amount ?? "-"}</div>
        <div>Due Date: {requestState?.dueDate ?? "-"}</div>
        <div>Repaid: {String(requestState?.repaid ?? false)}</div>
      </section>

      <section>
        <h2>Execute (Relayed)</h2>
        <form onSubmit={(e) => safeRun(() => onExecute(e))}>
          <input value={executeTarget} onChange={(e) => setExecuteTarget(e.target.value)} placeholder="Target address" />
          <textarea value={executeCalldata} onChange={(e) => setExecuteCalldata(e.target.value)} placeholder="Calldata 0x..." rows={4} />
          <input value={executeExpiryOffset} onChange={(e) => setExecuteExpiryOffset(e.target.value)} placeholder="Expiry offset sec" />
          <button type="submit" disabled={!activeRequest || !signer}>Sign + Relay Execute</button>
        </form>
      </section>

      <section>
        <h2>Repay (User tx)</h2>
        <button onClick={() => safeRun(onRepay)} disabled={!requestState || requestState.repaid || !signer}>
          Repay Now
        </button>
      </section>

      {status && <p style={{ color: "green" }}>{status}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}

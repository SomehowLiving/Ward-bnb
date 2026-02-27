import { useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { ethers } from "ethers";
import {
  ActivityCredit,
  CreditRequestItem,
  ActivityExecution,
  ActivityPocket,
  ActivityRepayment,
  depositCollateral,
  getCreditActivity,
  getCreditRequests,
  getCreditRequestState,
  getCreditState,
  getExecutionActivity,
  getMerchantActivity,
  getMerchantStatus,
  getPocketNextNonce,
  getPocketActivity,
  getRepaymentActivity,
  MerchantActivity,
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
  nextDueDate: string;
};
const EXPECTED_CHAIN_ID = 97;
const BSC_TESTNET_TX_BASE = "https://testnet.bscscan.com/tx/";
const GOOD_MERCHANT = import.meta.env.VITE_MERCHANT_GOOD_ADDRESS;
const MALICIOUS_MERCHANT = import.meta.env.VITE_MERCHANT_MALICIOUS_ADDRESS;

type RawCreditState = {
  user: string;
  deposited: bigint;
  borrowed: bigint;
  availableCredit: bigint;
};

type RawRequestState = {
  requestId: string;
  exists: boolean;
  borrower: string;
  principal: bigint;
  remaining: bigint;
  installmentAmount: bigint;
  installmentDue: bigint;
  interval: bigint;
  nextDueDate: bigint;
  installmentsPaid: number;
  totalInstallments: number;
  defaulted: boolean;
  closed: boolean;
  pocket: string;
};

function formatTbnb(wei?: bigint) {
  if (wei === undefined) return "-";
  try {
    const value = ethers.formatEther(wei);
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return `${value} tBNB`;
    return `${numeric.toLocaleString(undefined, { maximumFractionDigits: 6 })} tBNB`;
  } catch {
    return "-";
  }
}

function formatDateTime(epochSeconds?: bigint) {
  if (epochSeconds === undefined) return "-";
  const n = Number(epochSeconds);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return new Date(n * 1000).toLocaleString();
}

function formatDuration(seconds?: bigint) {
  if (seconds === undefined) return "-";
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "-";
  if (n % 86400 === 0) return `${n / 86400} day(s)`;
  if (n % 3600 === 0) return `${n / 3600} hour(s)`;
  if (n % 60 === 0) return `${n / 60} min`;
  return `${n} sec`;
}

function formatAddress(address?: string) {
  if (!address || !ethers.isAddress(address)) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTxHash(hash?: string) {
  if (!hash) return "-";
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function mapCreditToRaw(state: Awaited<ReturnType<typeof getCreditState>>): RawCreditState {
  return {
    user: state.user,
    deposited: BigInt(state.deposited),
    borrowed: BigInt(state.borrowed),
    availableCredit: BigInt(state.availableCredit)
  };
}

function mapRequestToRaw(state: Awaited<ReturnType<typeof getCreditRequestState>>): RawRequestState {
  return {
    requestId: state.requestId,
    exists: state.exists,
    borrower: state.borrower,
    principal: BigInt(state.principal),
    remaining: BigInt(state.remaining),
    installmentAmount: BigInt(state.installmentAmount),
    installmentDue: BigInt(state.installmentDue),
    interval: BigInt(state.interval),
    nextDueDate: BigInt(state.nextDueDate),
    installmentsPaid: Number(state.installmentsPaid),
    totalInstallments: Number(state.totalInstallments),
    defaulted: state.defaulted,
    closed: state.closed,
    pocket: state.pocket
  };
}

function mapRequestToView(raw?: RawRequestState | null) {
  if (!raw) return null;
  return {
    principal: formatTbnb(raw.principal),
    remaining: formatTbnb(raw.remaining),
    installmentAmount: formatTbnb(raw.installmentAmount),
    installmentDue: formatTbnb(raw.installmentDue),
    interval: formatDuration(raw.interval),
    nextDue: formatDateTime(raw.nextDueDate),
    installmentsProgress: `${raw.installmentsPaid} / ${raw.totalInstallments}`,
    defaulted: raw.defaulted,
    closed: raw.closed
  };
}

export default function Dashboard() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();

  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [creditState, setCreditState] = useState<RawCreditState | null>(null);
  const [activeRequest, setActiveRequest] = useState<RequestInfo | null>(null);
  const [requestState, setRequestState] = useState<RawRequestState | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [merchantStatus, setMerchantStatus] = useState<MerchantStatus | null>(null);
  const [merchantActivity, setMerchantActivity] = useState<MerchantActivity | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [creditActivity, setCreditActivity] = useState<ActivityCredit[]>([]);
  const [creditRequests, setCreditRequests] = useState<CreditRequestItem[]>([]);
  const [repaymentActivity, setRepaymentActivity] = useState<ActivityRepayment[]>([]);
  const [pocketActivity, setPocketActivity] = useState<ActivityPocket[]>([]);
  const [executionActivity, setExecutionActivity] = useState<ActivityExecution[]>([]);

  const [depositAmount, setDepositAmount] = useState("1");
  const [merchantAddress, setMerchantAddress] = useState("");
  const [creditAmount, setCreditAmount] = useState("0.1");
  const [installmentCount, setInstallmentCount] = useState("4");
  const [intervalSeconds, setIntervalSeconds] = useState("604800");
  const [salt, setSalt] = useState(String(Date.now()));

  const [executeExpiryOffset, setExecuteExpiryOffset] = useState("600");

  useEffect(() => {
    if (!isConnected || !address || !window.ethereum) return;

    const init = async () => {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const s = await provider.getSigner();
      setSigner(s);
      await Promise.all([refreshCredit(address), refreshActivity(address)]);
    };

    void init();
  }, [isConnected, address]);

  useEffect(() => {
    if (!ethers.isAddress(merchantAddress)) {
      setMerchantStatus(null);
      setMerchantActivity(null);
      return;
    }
    void safeRun(() => refreshMerchantStatus(merchantAddress));
  }, [merchantAddress]);

  useEffect(() => {
    if (activeRequest || creditRequests.length === 0) return;
    const next = creditRequests.find((x) => !x.closed && !x.defaulted) ?? creditRequests[0];
    const req = { requestId: next.requestId, pocket: next.pocket, nextDueDate: next.nextDueDate };
    setActiveRequest(req);
    setMerchantAddress(next.merchant);
    void safeRun(async () => {
      await Promise.all([refreshRequest(next.requestId), refreshMerchantStatus(next.merchant)]);
    });
  }, [creditRequests, activeRequest]);

  const creditLabel = useMemo(() => {
    if (!creditState) return "Disconnected";
    if (creditState.deposited === 0n) return "No deposit";
    if (creditState.borrowed === 0n) return "Has deposit";
    return "Borrowed > 0";
  }, [creditState]);

  const requestLabel = useMemo(() => {
    if (!requestState) return "No request loaded";
    if (requestState.closed) return "Repaid";
    if (requestState.defaulted) return "Defaulted";
    const now = Math.floor(Date.now() / 1000);
    if (Number(requestState.nextDueDate) < now) return "Defaulted";
    return "Pending execution";
  }, [requestState]);

  const requestView = useMemo(() => mapRequestToView(requestState), [requestState]);

  async function refreshCredit(user: string) {
    const state = await getCreditState(user);
    setCreditState(mapCreditToRaw(state));
  }

  async function refreshRequest(requestId: string) {
    const state = await getCreditRequestState(requestId);
    setRequestState(mapRequestToRaw(state));
  }

  async function refreshActivity(user: string) {
    const [requests, credits, repayments, pockets, executions] = await Promise.allSettled([
      getCreditRequests(user),
      getCreditActivity(user),
      getRepaymentActivity(user),
      getPocketActivity(user),
      getExecutionActivity(user)
    ]);
    setCreditRequests(requests.status === "fulfilled" ? requests.value : []);
    setCreditActivity(credits.status === "fulfilled" ? credits.value : []);
    setRepaymentActivity(repayments.status === "fulfilled" ? repayments.value : []);
    setPocketActivity(pockets.status === "fulfilled" ? pockets.value : []);
    setExecutionActivity(executions.status === "fulfilled" ? executions.value : []);
  }

  async function onDeposit(e: React.FormEvent) {
    e.preventDefault();
    if (!signer || !address) return;
    if (chainId !== EXPECTED_CHAIN_ID) {
      throw new Error(`Wrong network: switch to BSC Testnet (${EXPECTED_CHAIN_ID})`);
    }
    setError("");
    setStatus("Submitting deposit...");
    await depositCollateral(signer, depositAmount);
    await Promise.all([refreshCredit(address), refreshActivity(address)]);
    setStatus("Deposit confirmed.");
  }

  async function onRequestCredit(e: React.FormEvent) {
    e.preventDefault();
    if (!signer || !address) return;
    if (chainId !== EXPECTED_CHAIN_ID) {
      throw new Error(`Wrong network: switch to BSC Testnet (${EXPECTED_CHAIN_ID})`);
    }
    if (merchantStatus?.blocked) throw new Error("Merchant is blocked");

    setError("");
    setStatus("Requesting credit...");

    const created = await requestCreditOnVault(
      signer,
      merchantAddress,
      creditAmount,
      installmentCount,
      intervalSeconds,
      salt
    );

    setActiveRequest(created);

    await Promise.all([refreshCredit(address), refreshRequest(created.requestId), refreshActivity(address)]);
    setStatus("Credit requested and pocket created.");
  }

  async function refreshMerchantStatus(merchant: string) {
    if (!ethers.isAddress(merchant)) {
      setMerchantStatus(null);
      return;
    }
    const state = await getMerchantStatus(merchant);
    setMerchantStatus(state);
    const activity = await getMerchantActivity(merchant);
    setMerchantActivity(activity);
  }

  async function resumeRequestFromActivity(item: ActivityCredit) {
    const request = {
      requestId: item.requestId,
      pocket: item.pocket,
      nextDueDate: item.dueDate
    };
    setActiveRequest(request);
    setMerchantAddress(item.merchant);
    await Promise.all([refreshRequest(item.requestId), refreshMerchantStatus(item.merchant)]);
  }

  async function executeForMerchant(target: string) {
    if (!signer || !activeRequest) return;
    if (chainId !== EXPECTED_CHAIN_ID) {
      throw new Error(`Wrong network: switch to BSC Testnet (${EXPECTED_CHAIN_ID})`);
    }
    if (!ethers.isAddress(target)) throw new Error("Invalid merchant target");

    setError("");
    setStatus("Preparing relayed execution...");

    const iface = new ethers.Interface(["function purchase()"]);
    const calldata = iface.encodeFunctionData("purchase");
    const nonce = await getPocketNextNonce(activeRequest.pocket);
    const expiry = BigInt(Math.floor(Date.now() / 1000) + Number(executeExpiryOffset));
    const signature = await signExecIntent(
      signer,
      activeRequest.pocket,
      target,
      calldata,
      nonce,
      expiry,
      chainId
    );

    const result = await relayPocketExecution({
      pocket: activeRequest.pocket,
      target,
      data: calldata,
      nonce: nonce.toString(),
      expiry: expiry.toString(),
      signature
    });

    setStatus(`Execution relayed: ${result.txHash}`);
    if (address) {
      await Promise.all([refreshRequest(activeRequest.requestId), refreshActivity(address)]);
    } else {
      await refreshRequest(activeRequest.requestId);
    }
  }

  async function onRepay() {
    if (!signer || !address || !requestState) return;
    if (chainId !== EXPECTED_CHAIN_ID) {
      throw new Error(`Wrong network: switch to BSC Testnet (${EXPECTED_CHAIN_ID})`);
    }
    if (requestState.defaulted) throw new Error("Loan is defaulted");
    if (requestState.closed) throw new Error("Loan already closed");

    setError("");
    setStatus("Submitting repayment...");
    await repayOnVault(signer, requestState.requestId, requestState.installmentDue.toString());
    await Promise.all([refreshCredit(address), refreshRequest(requestState.requestId), refreshActivity(address)]);
    setStatus("Repayment confirmed.");
  }

  const safeRun = (fn: () => Promise<void>) => fn().catch((err: any) => {
    setError(err?.message || "Action failed");
    setStatus("");
  });

  if (!isConnected) {
    return (
      <div className="container">
        <h1>Ward Collateral</h1>
        <p>Connect your wallet to use direct Vault credit + relayed pocket execution.</p>
        <ConnectButton />
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Ward Collateral</h1>
      <div className="card">
        <div><strong>Connected:</strong> {formatAddress(address ?? "")}</div>
        <div><strong>Wallet:</strong> {address}</div>
        <div><strong>Chain ID:</strong> {chainId} {chainId === EXPECTED_CHAIN_ID ? "(BSC Testnet)" : `(Wrong: expected ${EXPECTED_CHAIN_ID})`}</div>
      </div>

      <section className="card">
        <h2>Credit Dashboard</h2>
        <button onClick={() => address && safeRun(() => refreshCredit(address))}>Refresh</button>
        <div><strong>Deposited:</strong> {formatTbnb(creditState?.deposited)}</div>
        <div><strong>Borrowed:</strong> {formatTbnb(creditState?.borrowed)}</div>
        <div><strong>Available Credit:</strong> {formatTbnb(creditState?.availableCredit)}</div>
        <div><strong>Credit State:</strong> {creditLabel}</div>
      </section>

      <section className="card">
        <h2>Deposit</h2>
        <form onSubmit={(e) => safeRun(() => onDeposit(e))}>
          <input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="Amount tBNB" />
          <button type="submit" disabled={!signer}>Deposit</button>
        </form>
      </section>

      <section className="card">
        <h2>Request Credit (User tx)</h2>
        <form onSubmit={(e) => safeRun(() => onRequestCredit(e))}>
          <input value={merchantAddress} onChange={(e) => setMerchantAddress(e.target.value)} placeholder="Merchant address" />
          <input value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="Amount tBNB" />
          <input value={installmentCount} onChange={(e) => setInstallmentCount(e.target.value)} placeholder="Installment count" />
          <input value={intervalSeconds} onChange={(e) => setIntervalSeconds(e.target.value)} placeholder="Interval seconds" />
          <input value={salt} onChange={(e) => setSalt(e.target.value)} placeholder="Salt" />
          <button type="button" onClick={() => safeRun(() => refreshMerchantStatus(merchantAddress))}>
            Check Merchant
          </button>
          <button type="submit" disabled={!signer || merchantStatus?.blocked}>Buy with Ward</button>
        </form>
        <div><strong>Merchant Flag Count:</strong> {merchantStatus?.flagCount ?? "-"}</div>
        <div><strong>Merchant Blocked:</strong> {merchantStatus ? String(merchantStatus.blocked) : "-"}</div>
        <div><strong>Request ID:</strong> {activeRequest?.requestId ?? "-"}</div>
        <div><strong>Pocket:</strong> {activeRequest?.pocket ?? "-"}</div>
        <div><strong>Next Due:</strong> {activeRequest ? formatDateTime(BigInt(activeRequest.nextDueDate)) : "-"}</div>
      </section>

      <section className="card">
        <h2>Request State</h2>
        {activeRequest && (
          <button onClick={() => safeRun(() => refreshRequest(activeRequest.requestId))}>Refresh Request</button>
        )}
        <div>
          <label>
            <input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} /> Show raw values
          </label>
        </div>
        <div><strong>Status:</strong> {requestLabel}</div>
        <div><strong>Principal:</strong> {requestView?.principal ?? "-"}</div>
        {showRaw && <div><small>Raw principal: {requestState?.principal.toString() ?? "-"}</small></div>}
        <div><strong>Remaining:</strong> {requestView?.remaining ?? "-"}</div>
        {showRaw && <div><small>Raw remaining: {requestState?.remaining.toString() ?? "-"}</small></div>}
        <div><strong>Installment Amount:</strong> {requestView?.installmentAmount ?? "-"}</div>
        {showRaw && <div><small>Raw installment amount: {requestState?.installmentAmount.toString() ?? "-"}</small></div>}
        <div><strong>Installment Due Now:</strong> {requestView?.installmentDue ?? "-"}</div>
        {showRaw && <div><small>Raw installment due: {requestState?.installmentDue.toString() ?? "-"}</small></div>}
        <div><strong>Installments Paid:</strong> {requestView?.installmentsProgress ?? "-"}</div>
        <div><strong>Interval:</strong> {requestView?.interval ?? "-"}</div>
        {showRaw && <div><small>Raw interval: {requestState?.interval.toString() ?? "-"} sec</small></div>}
        <div><strong>Next Due Date:</strong> {requestView?.nextDue ?? "-"}</div>
        {showRaw && <div><small>Raw due epoch: {requestState?.nextDueDate.toString() ?? "-"}</small></div>}
        <div><strong>Defaulted:</strong> {String(requestView?.defaulted ?? false)}</div>
        <div><strong>Closed:</strong> {String(requestView?.closed ?? false)}</div>
      </section>

      <section className="card">
        <h2>Execute (Relayed)</h2>
        <input value={executeExpiryOffset} onChange={(e) => setExecuteExpiryOffset(e.target.value)} placeholder="Expiry offset sec" />
        <div><strong>Good Merchant:</strong> {GOOD_MERCHANT || "-"}</div>
        <div><strong>Malicious Merchant:</strong> {MALICIOUS_MERCHANT || "-"}</div>
        <button
          onClick={() => GOOD_MERCHANT && safeRun(() => executeForMerchant(GOOD_MERCHANT))}
          disabled={!activeRequest || !signer || !GOOD_MERCHANT}
        >
          Execute Good Merchant
        </button>
        <button
          onClick={() => MALICIOUS_MERCHANT && safeRun(() => executeForMerchant(MALICIOUS_MERCHANT))}
          disabled={!activeRequest || !signer || !MALICIOUS_MERCHANT}
        >
          Execute Malicious Merchant
        </button>
      </section>

      <section className="card">
        <h2>Repay (User tx)</h2>
        <button
          onClick={() => safeRun(onRepay)}
          disabled={!requestState || requestState.closed || requestState.defaulted || !signer}
        >
          Repay Installment ({requestView?.installmentDue ?? "-"})
        </button>
      </section>

      <section className="card">
        <h2>Activity</h2>
        <button onClick={() => address && safeRun(() => refreshActivity(address))}>Refresh Activity</button>

        <h3>Recent Credit Requests</h3>
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Merchant</th>
              <th>Amount</th>
              <th>Due</th>
              <th>Tx</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {creditRequests.slice(0, 10).map((item) => (
              <tr key={item.requestId}>
                <td>{item.requestId.slice(0, 10)}...</td>
                <td>{formatAddress(item.merchant)}</td>
                <td>{formatTbnb(BigInt(item.principal))}</td>
                <td>{formatDateTime(BigInt(item.nextDueDate))}</td>
                <td><a href={`${BSC_TESTNET_TX_BASE}${item.createdTxHash}`} target="_blank" rel="noreferrer">{formatTxHash(item.createdTxHash)}</a></td>
                <td>
                  <button
                    onClick={() =>
                      safeRun(() =>
                        resumeRequestFromActivity({
                          requestId: item.requestId,
                          merchant: item.merchant,
                          amount: item.principal,
                          pocket: item.pocket,
                          dueDate: item.nextDueDate,
                          txHash: item.createdTxHash,
                          blockNumber: item.createdBlockNumber,
                          timestamp: item.createdTimestamp
                        })
                      )
                    }
                  >
                    {item.closed ? "View" : item.defaulted ? "Defaulted" : "Continue"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Recent Repayments</h3>
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Amount</th>
              <th>When</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {repaymentActivity.slice(0, 10).map((item) => (
              <tr key={item.txHash}>
                <td>{item.requestId.slice(0, 10)}...</td>
                <td>{formatTbnb(BigInt(item.amount))}</td>
                <td>{new Date(item.timestamp * 1000).toLocaleString()}</td>
                <td><a href={`${BSC_TESTNET_TX_BASE}${item.txHash}`} target="_blank" rel="noreferrer">{formatTxHash(item.txHash)}</a></td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Recent Executions</h3>
        <table>
          <thead>
            <tr>
              <th>Merchant</th>
              <th>Type</th>
              <th>When</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {executionActivity.slice(0, 10).map((item) => (
              <tr key={item.txHash}>
                <td>{formatAddress(item.merchant)}</td>
                <td>{item.event}</td>
                <td>{new Date(item.timestamp * 1000).toLocaleString()}</td>
                <td><a href={`${BSC_TESTNET_TX_BASE}${item.txHash}`} target="_blank" rel="noreferrer">{formatTxHash(item.txHash)}</a></td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Merchant Activity</h3>
        <div><strong>Total Flags:</strong> {merchantActivity?.totalFlags ?? "-"}</div>
        <div><strong>Blocked:</strong> {merchantActivity ? String(merchantActivity.blocked) : "-"}</div>
        <div><strong>Total Executions:</strong> {merchantActivity?.totalExecutions ?? "-"}</div>
        <div><strong>Total Drained Attempts:</strong> {merchantActivity?.totalDrainedAttempts ?? "-"}</div>

        <h3>Pocket Creation History</h3>
        <table>
          <thead>
            <tr>
              <th>Pocket</th>
              <th>When</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {pocketActivity.slice(0, 10).map((item) => (
              <tr key={item.txHash}>
                <td>{formatAddress(item.pocket)}</td>
                <td>{new Date(item.timestamp * 1000).toLocaleString()}</td>
                <td><a href={`${BSC_TESTNET_TX_BASE}${item.txHash}`} target="_blank" rel="noreferrer">{formatTxHash(item.txHash)}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {status && <p><strong style={{ color: "green" }}>Status:</strong> {status}</p>}
      {error && <p><strong style={{ color: "red" }}>Error:</strong> {error}</p>}
    </div>
  );
}

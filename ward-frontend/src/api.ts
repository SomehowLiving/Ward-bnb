import { ethers } from "ethers";
import { API } from "./routes";

const VAULT_ADDRESS = import.meta.env.VITE_VAULT_ADDRESS;

const VAULT_ABI = [
  "function deposit() payable",
  "function requestCredit(address merchant,uint256 amount,uint256 installmentCount,uint256 interval,uint256 salt) returns (bytes32 requestId,address pocket)",
  "function repayInstallment(bytes32 requestId) payable",
  "event CreditRequested(bytes32 indexed requestId,address indexed user,address indexed merchant,address pocket,uint256 principal,uint256 installmentAmount,uint256 totalInstallments,uint256 interval,uint256 nextDueDate)"
];

export type CreditState = {
  user: string;
  deposited: string;
  borrowed: string;
  availableCredit: string;
};

export type CreditRequestState = {
  requestId: string;
  exists: boolean;
  borrower: string;
  principal: string;
  remaining: string;
  installmentAmount: string;
  installmentsPaid: string;
  totalInstallments: string;
  interval: string;
  nextDueDate: string;
  installmentDue: string;
  defaulted: boolean;
  closed: boolean;
  pocket: string;
};

export type ExecuteParams = {
  pocket: string;
  target: string;
  data: string;
  nonce: string;
  expiry: string;
  signature: string;
};

export type MerchantStatus = {
  merchant: string;
  flagCount: string;
  blocked: boolean;
};

export type ActivityCredit = {
  requestId: string;
  user: string;
  merchant: string;
  blockNumber: number;
  timestamp: number;
  principal: string;
  pocket: string;
};

export type ActivityRepayment = {
  requestId: string;
  user: string;
  amount: string;
  remaining: string;
  installmentsPaid: number;
  blockNumber: number;
  timestamp: number;
};

export type ActivityPocket = {
  pocket: string;
  owner: string;
  blockNumber: number;
  timestamp: number;
};

export type ActivityExecution = {
  merchant: string;
  buyer?: string;
  amount?: string;
  type: "purchase" | "attack";
  blockNumber: number;
  timestamp: number;
};

export type CreditRequestItem = {
  requestId: string;
  user: string;
  merchant: string;
  pocket: string;
  principal: string;
  nextDueDate: string;
  closed: boolean;
  defaulted: boolean;
  blockNumber: number;
  timestamp: number;
};

function requireVaultAddress() {
  if (!VAULT_ADDRESS || !ethers.isAddress(VAULT_ADDRESS)) {
    throw new Error("Missing or invalid VITE_VAULT_ADDRESS");
  }
  return VAULT_ADDRESS;
}

function getVaultContract(signer: ethers.Signer) {
  return new ethers.Contract(requireVaultAddress(), VAULT_ABI, signer);
}

function extractError(payload: any, fallback: string) {
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.error?.message === "string") return payload.error.message;
  return fallback;
}

export async function getCreditState(user: string): Promise<CreditState> {
  const res = await fetch(API.credit.state(user));
  const data = await res.json();
  if (!res.ok) throw new Error(extractError(data, "Failed to fetch credit state"));
  return data;
}

export async function getCreditRequestState(requestId: string): Promise<CreditRequestState> {
  const res = await fetch(API.credit.request(requestId));
  const data = await res.json();
  if (!res.ok) throw new Error(extractError(data, "Failed to fetch request state"));
  return data;
}

export async function getMerchantStatus(merchantAddress: string): Promise<MerchantStatus> {
  const res = await fetch(API.merchant.get(merchantAddress));
  const data = await res.json();
  if (!res.ok) throw new Error(extractError(data, "Failed to fetch merchant status"));
  return data;
}

export async function getPocketNextNonce(address: string): Promise<bigint> {
  const res = await fetch(API.pocket.nextNonce(address));
  const data = await res.json();
  if (!res.ok) throw new Error(extractError(data, "Failed to load nonce"));
  return BigInt(data.nextNonce);
}

export async function relayPocketExecution(params: ExecuteParams): Promise<{ txHash: string }> {
  const res = await fetch(API.pocket.execute, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(extractError(data, "Execution relay failed"));
  return data;
}

export async function depositCollateral(signer: ethers.Signer, amountEth: string) {
  const vault = getVaultContract(signer);
  const tx = await vault.deposit({ value: ethers.parseEther(amountEth) });
  return tx.wait();
}

export async function requestCreditOnVault(
  signer: ethers.Signer,
  merchant: string,
  amountEth: string,
  installmentCount: string,
  intervalSeconds: string,
  salt: string
): Promise<{ requestId: string; pocket: string; nextDueDate: string }> {
  const vault = getVaultContract(signer);
  const tx = await vault.requestCredit(
    merchant,
    ethers.parseEther(amountEth),
    BigInt(installmentCount),
    BigInt(intervalSeconds),
    BigInt(salt)
  );
  const receipt = await tx.wait();

  const iface = new ethers.Interface(VAULT_ABI);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name !== "CreditRequested") continue;
      return {
        requestId: parsed.args.requestId,
        pocket: parsed.args.pocket,
        nextDueDate: (parsed.args.nextDueDate as bigint).toString()
      };
    } catch {
      // ignore unrelated logs
    }
  }

  throw new Error("CreditRequested event not found in receipt");
}

export async function repayOnVault(signer: ethers.Signer, requestId: string, amountWei: string) {
  const vault = getVaultContract(signer);
  const tx = await vault.repayInstallment(requestId, { value: BigInt(amountWei) });
  return tx.wait();
}

export async function signExecIntent(
  signer: ethers.JsonRpcSigner,
  pocket: string,
  target: string,
  data: string,
  nonce: bigint,
  expiry: bigint,
  chainId: number
): Promise<string> {
  const domain = {
    name: "Ward Pocket",
    version: "1",
    chainId,
    verifyingContract: pocket
  };

  const types = {
    Exec: [
      { name: "pocket", type: "address" },
      { name: "target", type: "address" },
      { name: "dataHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" }
    ]
  };

  const value = {
    pocket,
    target,
    dataHash: ethers.keccak256(data),
    nonce,
    expiry
  };

  return signer.signTypedData(domain, types, value);
}
export async function getCreditRequests(user: string): Promise<CreditRequestItem[]> {
  const res = await fetch(API.activity.credits(user));
  const data = await res.json();
  if (!res.ok) throw new Error(extractError(data, "Failed to fetch credit activity"));
  return data.items || [];
}

export async function getCreditActivity(user: string): Promise<ActivityCredit[]> {
  const res = await fetch(API.activity.credits(user));
  const data = await res.json();
  if (!res.ok) throw new Error(extractError(data, "Failed to fetch credit activity"));
  return data.items || [];
}

export async function getRepaymentActivity(user: string): Promise<ActivityRepayment[]> {
  const res = await fetch(API.activity.repayments(user));
  const data = await res.json();
  if (!res.ok) throw new Error(extractError(data, "Failed to fetch repayment activity"));
  return data.items || [];
}

export async function getPocketActivity(user: string): Promise<ActivityPocket[]> {
  const res = await fetch(API.activity.pockets(user));
  const data = await res.json();
  if (!res.ok) throw new Error(extractError(data, "Failed to fetch pocket activity"));
  return data.items || [];
}

export async function getExecutionActivity(user: string): Promise<ActivityExecution[]> {
  const res = await fetch(API.activity.executions(user));
  const data = await res.json();
  if (!res.ok) throw new Error(extractError(data, "Failed to fetch execution activity"));
  return data.items || [];
}

export async function getMerchantActivity(merchant: string) {
  const res = await fetch(API.activity.merchant(merchant));
  const data = await res.json();
  if (!res.ok) throw new Error(extractError(data, "Failed to fetch merchant activity"));
  return data;
}
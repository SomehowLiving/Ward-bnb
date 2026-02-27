import { ethers } from "ethers";
import { API } from "./routes";

const VAULT_ADDRESS = import.meta.env.VITE_VAULT_ADDRESS;

const VAULT_ABI = [
  "function deposit() payable",
  "function requestCredit(address merchant,uint256 amount,uint256 duration,uint256 salt) returns (bytes32 requestId,address pocket)",
  "function repay(bytes32 requestId) payable",
  "event CreditRequested(bytes32 indexed requestId,address indexed user,address indexed merchant,address pocket,uint256 amount,uint256 dueDate)"
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
  amount: string;
  dueDate: string;
  repaid: boolean;
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
  durationSeconds: string,
  salt: string
): Promise<{ requestId: string; pocket: string; dueDate: string }> {
  const vault = getVaultContract(signer);
  const tx = await vault.requestCredit(
    merchant,
    ethers.parseEther(amountEth),
    BigInt(durationSeconds),
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
        dueDate: (parsed.args.dueDate as bigint).toString()
      };
    } catch {
      // ignore unrelated logs
    }
  }

  throw new Error("CreditRequested event not found in receipt");
}

export async function repayOnVault(signer: ethers.Signer, requestId: string, amountWei: string) {
  const vault = getVaultContract(signer);
  const tx = await vault.repay(requestId, { value: BigInt(amountWei) });
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

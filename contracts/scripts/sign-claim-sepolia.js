import { ethers } from "ethers";

async function signClaim() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const pocket = process.env.POCKET_ADDRESS;
  const target = process.env.TOKEN_ADDRESS;
  const data = "0x4e71d92d"; // claimAirdrop()
  const nonce = 1;
  const expiry = Math.floor(Date.now() / 1000) + 3600;

  const domain = {
    name: "Ward Pocket",
    version: "1",
    chainId: 11155111,
    verifyingContract: pocket,
  };

  const types = {
    Exec: [
      { name: "pocket", type: "address" },
      { name: "target", type: "address" },
      { name: "dataHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
    ],
  };

  const value = {
    pocket,
    target,
    dataHash: ethers.keccak256(data),
    nonce,
    expiry,
  };

  // 🔥 Use signTypedData (v6)
  const signature = await signer.signTypedData(domain, types, value);

  console.log("SIGNATURE:", signature);
  console.log("NONCE:", nonce);
  console.log("EXPIRY:", expiry);
}

signClaim().catch(console.error);

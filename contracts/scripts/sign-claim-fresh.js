const ethers = require('ethers');

async function signClaim() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY).connect(provider);

  const pocket = process.env.POCKET_ADDRESS;
  if (!ethers.isAddress(pocket)) {
    throw new Error(`Invalid POCKET_ADDRESS: ${pocket}`);
  }
  const target = process.env.TOKEN_ADDRESS;
  if (!ethers.isAddress(target)) {
    throw new Error(`Invalid TOKEN_ADDRESS: ${target}`);
  }

  const data = '0x5b88349d'; // claimAirdrop()
  const nonce = 1;
  const expiry = Math.floor(Date.now() / 1000) + 3600; // Fresh 1 hr from now

  const domain = {
    name: "Ward Pocket",
    version: "1",
    chainId: 11155111,
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

  const signature = await signer.signTypedData(domain, types, value);

  console.log('\n=== FRESH SIGNATURE ===');
  console.log('SIGNATURE:', signature);
  console.log('EXPIRY:', expiry);
  console.log('========================\n');

  console.log('Export and run:');
  console.log(`export SIGNATURE="${signature}"`);
  console.log(`export EXPIRY=${expiry}`);
  console.log(`cast send \\`);
  console.log(`  $CONTROLLER_ADDRESS \\`);
  console.log(`  "executeFromPocket(address,address,bytes,uint256,uint256,bytes)" \\`);
  console.log(`  $POCKET_ADDRESS \\`);
  console.log(`  $TOKEN_ADDRESS \\`);
  console.log(`  0x5b88349d \\`);
  console.log(`  1 \\`);
  console.log(`  $EXPIRY \\`);
  console.log(`  $SIGNATURE \\`);
  console.log(`  --rpc-url $RPC_URL \\`);
  console.log(`  --private-key $PRIVATE_KEY`);
}

signClaim().catch(console.error);

// WORKS NO MATTER WHAT:

// cast send \
//   $CONTROLLER_ADDRESS \
//   "executeFromPocket(address,address,bytes,uint256,uint256,bytes)" \
//   $POCKET_ADDRESS \
//   $TOKEN_ADDRESS \
//   0x5b88349d \
//   1 \
//   $EXPIRY \
//   $SIGNATURE \
//   --rpc-url $RPC_URL \
//   --private-key $PRIVATE_KEY

// TO CHECK IF NONCE USED:
// cast call $POCKET_ADDRESS "used()(bool)" --rpc-url $RPC_URL
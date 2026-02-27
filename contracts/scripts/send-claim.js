const ethers = require('ethers');

async function sendClaim() {
  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  const controller = new ethers.Contract(
    process.env.CONTROLLER_ADDRESS,
    ["function executeFromPocket(address,address,bytes,uint256,uint256,bytes)"],
    wallet
  );

  const tx = await controller.executeFromPocket(
    process.env.POCKET_ADDRESS,
    process.env.TOKEN_ADDRESS,
    '0x4e71d92d',
    1,
    1799999999,
    process.env.SIGNATURE
  );
  
  console.log('Transaction sent:', tx.hash);
  await tx.wait();
  console.log('Transaction confirmed');
}

sendClaim().catch(console.error);
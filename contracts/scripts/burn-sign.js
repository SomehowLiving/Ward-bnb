const ethers = require("ethers");

async function signBurn() {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const pocket = process.env.POCKET_ADDRESS;
    const nonce = 2; // MUST be unused
    const expiry = Math.floor(Date.now() / 1000) + 3600;

    const { chainId } = await provider.getNetwork();

    const domain = {
        name: "Ward Pocket",
        version: "1",
        chainId,
        verifyingContract: pocket,
    };

    const types = {
        Burn: [
            { name: "pocket", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "expiry", type: "uint256" },
        ],
    };

    const value = { pocket, nonce, expiry };

    const signature = await signer.signTypedData(domain, types, value);

    console.log("export BURN_NONCE=" + nonce);
    console.log("export BURN_EXPIRY=" + expiry);
    console.log(`export BURN_SIGNATURE="${signature}"`);
}

signBurn().catch(console.error);

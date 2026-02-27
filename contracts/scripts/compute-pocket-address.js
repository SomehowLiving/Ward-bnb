// # Use a new salt (timestamp is easiest)
// export SALT=$(date +%s)

// cast send $CONTROLLER_ADDRESS \
//   "createPocket(address,uint256)" \
//   $WALLET_ADDRESS $SALT \
//   --rpc-url $RPC_URL \
//   --private-key $PRIVATE_KEY

import {
  solidityPackedKeccak256,
  keccak256,
  AbiCoder,
  getCreate2Address
} from "ethers";
import fs from "fs";

const FACTORY = "0x2D09533dBfD323A16c38C63b11C8004650dF824B";
const CONTROLLER = "0xC72d22cF0DD6fd5571d47EEbe5fCd87B2478bFD7";
const OWNER = "0x14e0D556fFe746BC5ab12902423bDa63DeA08Bf9";
const SALT_UINT = 1770115241; // Example salt value

console.log("\n=== COMPUTE POCKET ADDRESS ===");

// 1️⃣ createSalt = keccak256(abi.encodePacked(owner, salt))
const createSalt = solidityPackedKeccak256(
  ["address", "uint256"],
  [OWNER, SALT_UINT]
);

// 2️⃣ init code = creation bytecode + constructor args
const artifact = JSON.parse(
  fs.readFileSync("out/Pocket.sol/Pocket.json", "utf8")
);

const abi = AbiCoder.defaultAbiCoder();
const initCode =
  artifact.bytecode.object +
  abi.encode(
    ["address", "address"],
    [CONTROLLER, OWNER]
  ).slice(2);

const initCodeHash = keccak256(initCode);

// 3️⃣ CREATE2 address
const pocket = getCreate2Address(
  FACTORY,
  createSalt,
  initCodeHash
);

console.log("Pocket Address:", pocket);
console.log("Factory:", FACTORY);
console.log("Owner:", OWNER);
console.log("Salt:", SALT_UINT);
console.log("Computed Salt (hex):", createSalt);
console.log("Init Code Hash:", initCodeHash);
console.log("\n🎯 Pocket Address:", pocket);
console.log("=====================================\n");

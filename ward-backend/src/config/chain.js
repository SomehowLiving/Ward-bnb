import { ethers } from "ethers";

import fs from "fs";
import path from "path";

import dotenv from "dotenv";
dotenv.config();

import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PocketABI = JSON.parse(
    fs.readFileSync(
        path.resolve(__dirname, "../abi/Pocket.json"),
        "utf8"
    )
);
const ControllerABI = JSON.parse(
    fs.readFileSync(
        path.resolve(__dirname, "../abi/PocketController.json"),
        "utf8"
    )
);
const required = ["RPC_URL", "CONTROLLER_PRIVATE_KEY", "CONTROLLER_ADDRESS"];
for (const key of required) {
    if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
}

export const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

export const controllerSigner = new ethers.Wallet(
    process.env.CONTROLLER_PRIVATE_KEY,
    provider
);

export const controller = new ethers.Contract(
    process.env.CONTROLLER_ADDRESS,
    ControllerABI.abi,
    controllerSigner
);

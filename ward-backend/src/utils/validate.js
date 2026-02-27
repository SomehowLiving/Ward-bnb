import { ethers } from "ethers";
import { controller } from "../config/chain.js";

export class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "ValidationError";
        this.statusCode = 400;
    }
}

export function requireAddress(value, name) {
    if (!ethers.isAddress(value)) {
        throw new ValidationError(`Invalid address: ${name}`);
    }
}

export async function requireValidPocket(pocket) { 
    const valid = await controller.validPocket(pocket); 
    if (!valid) { 
        throw new Error("Invalid or burned pocket"); 
    } 
}

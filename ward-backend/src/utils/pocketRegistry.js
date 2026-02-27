import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../data");
const registryFile = path.resolve(dataDir, "pocket-registry.json");

class PocketRegistry {
  constructor() {
    this.ownerToPockets = new Map();
    this.pocketToRecord = new Map();
    this.persistenceEnabled = true;
    this._init();
  }

  _init() {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      if (!fs.existsSync(registryFile)) {
        fs.writeFileSync(registryFile, JSON.stringify({}, null, 2));
      }
      const raw = fs.readFileSync(registryFile, "utf8");
      const parsed = raw ? JSON.parse(raw) : {};

      // Backward compatibility: old format was { [owner]: string[] }.
      const isLegacy =
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        !("owners" in parsed) &&
        !("pockets" in parsed);

      if (isLegacy) {
        for (const [owner, pockets] of Object.entries(parsed)) {
          if (!Array.isArray(pockets)) continue;
          for (const pocket of pockets) {
            try {
              this.addPocket(owner, pocket, null, false);
            } catch {
              // Ignore malformed legacy entries.
            }
          }
        }
        this._persist();
        return;
      }

      const owners = parsed?.owners ?? {};
      const pockets = parsed?.pockets ?? {};

      for (const [owner, pocketList] of Object.entries(owners)) {
        if (!Array.isArray(pocketList)) continue;
        const normalizedOwner = ethers.getAddress(owner);
        const set = this.ownerToPockets.get(normalizedOwner) ?? new Set();
        for (const p of pocketList) {
          try {
            set.add(ethers.getAddress(String(p)).toLowerCase());
          } catch {
            // ignore invalid pocket entry
          }
        }
        this.ownerToPockets.set(normalizedOwner, set);
      }

      for (const [pocketAddress, record] of Object.entries(pockets)) {
        try {
          const pocket = ethers.getAddress(pocketAddress).toLowerCase();
          const owner = ethers.getAddress(String(record?.owner));
          const createdBlock =
            record?.createdBlock === null || record?.createdBlock === undefined
              ? null
              : Number(record.createdBlock);
          this.pocketToRecord.set(pocket, {
            owner,
            createdBlock: Number.isFinite(createdBlock) && createdBlock >= 0 ? createdBlock : null
          });
        } catch {
          // Ignore malformed record.
        }
      }
    } catch (err) {
      this.persistenceEnabled = false;
      console.warn("[pocket-registry] persistence unavailable, using in-memory store only", {
        error: err?.message
      });
    }
  }

  _toObject() {
    const owners = {};
    for (const [owner, pockets] of this.ownerToPockets.entries()) {
      owners[owner] = Array.from(pockets);
    }

    const pockets = {};
    for (const [pocket, record] of this.pocketToRecord.entries()) {
      pockets[pocket] = {
        owner: record.owner,
        createdBlock: record.createdBlock
      };
    }

    return { owners, pockets };
  }

  _persist() {
    if (!this.persistenceEnabled) return;
    try {
      const tmpFile = `${registryFile}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(this._toObject(), null, 2));
      fs.renameSync(tmpFile, registryFile);
    } catch (err) {
      this.persistenceEnabled = false;
      console.warn("[pocket-registry] failed to persist; continuing in-memory", {
        error: err?.message
      });
    }
  }

  addPocket(ownerAddress, pocketAddress, createdBlock = null, persist = true) {
    const owner = ethers.getAddress(String(ownerAddress));
    const pocket = ethers.getAddress(String(pocketAddress)).toLowerCase();
    const existing = this.ownerToPockets.get(owner) ?? new Set();
    existing.add(pocket.toLowerCase());
    this.ownerToPockets.set(owner, existing);

    const normalizedCreatedBlock =
      createdBlock === null || createdBlock === undefined
        ? null
        : Number(createdBlock);
    const current = this.pocketToRecord.get(pocket);
    this.pocketToRecord.set(pocket, {
      owner,
      createdBlock:
        Number.isFinite(normalizedCreatedBlock) && normalizedCreatedBlock >= 0
          ? normalizedCreatedBlock
          : current?.createdBlock ?? null
    });

    if (persist) this._persist();
  }

  getPocketsByOwner(ownerAddress) {
    const owner = ethers.getAddress(String(ownerAddress));
    const found = this.ownerToPockets.get(owner);
    return found ? Array.from(found) : [];
  }

  getPocketRecord(pocketAddress) {
    const pocket = ethers.getAddress(String(pocketAddress)).toLowerCase();
    return this.pocketToRecord.get(pocket) ?? null;
  }

  getAllOwners() {
    return Array.from(this.ownerToPockets.keys());
  }
}

export const pocketRegistry = new PocketRegistry();

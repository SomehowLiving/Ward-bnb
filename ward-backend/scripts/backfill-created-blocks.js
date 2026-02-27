import dotenv from "dotenv";
import { backfillPocketCreatedBlocks } from "../src/utils/backfillPocketCreatedBlocks.js";

dotenv.config();

function parseFlag(args, name) {
  return args.includes(name);
}

function parseArgValue(args, key) {
  const withEquals = args.find((a) => a.startsWith(`${key}=`));
  if (withEquals) return withEquals.slice(key.length + 1);
  const idx = args.findIndex((a) => a === key);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const fromBlock = parseArgValue(args, "--from-block");
  const toBlock = parseArgValue(args, "--to-block");
  const dryRun = parseFlag(args, "--dry-run");

  const result = await backfillPocketCreatedBlocks({ fromBlock, toBlock, dryRun });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("[backfill-created-blocks] failed", err?.message || err);
  process.exit(1);
});


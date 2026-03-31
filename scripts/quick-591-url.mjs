#!/usr/bin/env node
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const rootDir = process.cwd();
const execFileAsync = promisify(execFile);

await main();

async function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));

    if (parsed.help || !parsed.region) {
      printUsage();
      process.exit(parsed.region ? 0 : 1);
    }

    const childArgs = [path.join("scripts", "resolve-591-url.mjs"), "--region", parsed.region];

    if (parsed.kind) {
      childArgs.push("--kind", parsed.kind);
    }

    if (parsed.section) {
      childArgs.push("--section", parsed.section);
    }

    if (parsed.circle) {
      childArgs.push("--circle", parsed.circle);
    }

    if (parsed.taxonomyFile) {
      childArgs.push("--taxonomy", parsed.taxonomyFile);
    }

    if (parsed.page > 1) {
      childArgs.push("--page", String(parsed.page));
    }

    const { stdout, stderr } = await execFileAsync(process.execPath, childArgs, {
      cwd: rootDir,
      encoding: "utf8",
      windowsHide: true,
    });

    if (stdout) {
      process.stdout.write(stdout);
    }

    if (stderr) {
      process.stderr.write(stderr);
    }
  } catch (error) {
    if (error?.stdout) {
      process.stdout.write(error.stdout);
    }
    if (error?.stderr) {
      process.stderr.write(error.stderr);
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function parseArgs(argv) {
  const parsed = {
    page: 1,
  };
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--circle":
        parsed.circle = argv[++index];
        break;
      case "--page":
        parsed.page = Number(argv[++index] || 1);
        break;
      case "--taxonomy":
        parsed.taxonomyFile = argv[++index];
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown argument: ${arg}`);
        }
        positionals.push(arg);
        break;
    }
  }

  if (positionals.length > 0) {
    const maybePage = Number(positionals.at(-1));
    if (Number.isFinite(maybePage) && maybePage > 0) {
      parsed.page = maybePage;
      positionals.pop();
    }
  }

  if (positionals.length > 3) {
    throw new Error("Quick mode accepts at most 4 positionals: region [kind] [section] [page]");
  }

  [parsed.region, parsed.kind, parsed.section] = positionals;
  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node scripts/quick-591-url.mjs <region> [kind] [section] [page]
  node scripts/quick-591-url.mjs <region> [kind] [section] [page] --circle <circle>

Positional order:
  1. region   required
  2. kind     optional
  3. section  optional
  4. page     optional number

Examples:
  node scripts/quick-591-url.mjs 台東縣 獨立套房 台東市 2
  node scripts/quick-591-url.mjs taitung studio taitungcity 2
  node scripts/quick-591-url.mjs taitung studio taitung 2
  node scripts/quick-591-url.mjs taitung parking --circle zhiben

Alias notes:
  taitung         -> 台東縣 as region, or 臺東市 as section inside 台東縣
  taitungcounty   -> 台東縣
  taitungcity     -> 臺東市
  ttcounty        -> 台東縣
  ttcity          -> 臺東市
  studio          -> 獨立套房
  apartment       -> 整層住家
  room            -> 雅房
  parking         -> 車位

For full list/search mode, use:
  node scripts/resolve-591-url.mjs --list sections --region taitung
`);
}

#!/usr/bin/env node
import { buildAppData, writeBuildOutputs } from "./lib/pipeline.mjs";

const rootDir = process.cwd();
const appData = await buildAppData(rootDir);
await writeBuildOutputs(rootDir, appData);

console.log(`Built ${appData.listingCount} listings from ${appData.rawFileCount} raw file(s).`);

#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const defaultTaxonomyFile = path.join(rootDir, "data", "591-taxonomy.generated.json");
const baseListUrl = "https://rent.591.com.tw/list";

const ROOT_ALIASES = {
  台北: ["taipei", "tp"],
  新北: ["newtaipei", "ntp", "ntpc"],
  桃園: ["taoyuan", "ty"],
  新竹: ["hsinchu", "hc"],
  宜蘭: ["yilan", "yl"],
  基隆: ["keelung", "kl"],
  台中: ["taichung", "tc"],
  彰化: ["changhua", "ch"],
  雲林: ["yunlin", "yln"],
  苗栗: ["miaoli", "ml"],
  南投: ["nantou", "nt"],
  高雄: ["kaohsiung", "kh"],
  台南: ["tainan", "tn"],
  嘉義: ["chiayi", "cy"],
  屏東: ["pingtung", "pt"],
  台東: ["taitung", "tt"],
  花蓮: ["hualien", "hl"],
  澎湖: ["penghu", "ph"],
  金門: ["kinmen", "km"],
  連江: ["lienchiang", "lc", "matsu"],
  綠島: ["greenisland"],
  蘭嶼: ["lanyu", "orchidisland"],
  延平: ["yanping"],
  卑南: ["beinan"],
  鹿野: ["luye"],
  關山: ["guanshan"],
  海端: ["haiduan"],
  池上: ["chishang"],
  東河: ["donghe"],
  成功: ["chenggong"],
  長濱: ["changbin"],
  太麻里: ["taimali", "taimalii"],
  金峰: ["jinfeng"],
  大武: ["dawu"],
  達仁: ["daren"],
  知本: ["zhiben", "chihpen"],
  溫泉: ["hotspring"],
};

const KIND_ALIASES = {
  1: ["apartment", "flat", "wholehome", "entirehome", "entireplace", "fullunit"],
  2: ["studio", "suite", "private-suite"],
  3: ["sharesuite", "sharedsuite", "split-suite", "subsuite"],
  4: ["room", "single-room"],
  8: ["parking", "carpark", "parkingspace"],
  24: ["other", "misc"],
};

const SECTION_EXTRA_ALIASES = {
  341: ["ttcity"],
};

const CIRCLE_EXTRA_ALIASES = {
  22295: ["zhibenhotspring", "chihpenhotspring"],
};

await main();

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
      printUsage();
      return;
    }

    const taxonomy = await loadTaxonomy(args.taxonomyFile || defaultTaxonomyFile);

    if (args.listType) {
      handleListMode(taxonomy, args);
      return;
    }

    handleUrlMode(taxonomy, args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function parseArgs(argv) {
  const parsed = {
    page: 1,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--taxonomy":
        parsed.taxonomyFile = argv[++index];
        break;
      case "--list":
        parsed.listType = argv[++index];
        break;
      case "--query":
        parsed.query = argv[++index];
        break;
      case "--region":
        parsed.region = argv[++index];
        break;
      case "--kind":
        parsed.kind = argv[++index];
        break;
      case "--section":
        parsed.section = argv[++index];
        break;
      case "--circle":
        parsed.circle = argv[++index];
        break;
      case "--page":
        parsed.page = Number(argv[++index] || 1);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

async function loadTaxonomy(filePath) {
  const resolvedPath = path.resolve(rootDir, filePath);

  try {
    const raw = await fs.readFile(resolvedPath, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed || !Array.isArray(parsed.regions) || !Array.isArray(parsed.kinds)) {
      throw new Error("taxonomy file shape is invalid");
    }

    return {
      ...parsed,
      regions: enrichItems("region", parsed.regions),
      kinds: enrichItems("kind", parsed.kinds),
      sections: enrichItems("section", parsed.sections),
      circles: enrichItems("circle", parsed.circles),
      filePath: resolvedPath,
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(
        `Taxonomy file not found at ${resolvedPath}. Run: npm run scrape-taxonomy -- '<591 list url>'`,
      );
    }
    throw error;
  }
}

function enrichItems(label, items) {
  return items.map((item) => ({
    ...item,
    aliases: buildAliases(label, item),
  }));
}

function buildAliases(label, item) {
  const aliasSet = new Set();
  const cleanedName = cleanChineseName(item.name);

  addAlias(aliasSet, item.name);

  const kindAliases = label === "kind" ? KIND_ALIASES[item.id] || [] : [];
  const sectionAliases = label === "section" ? SECTION_EXTRA_ALIASES[item.id] || [] : [];
  const circleAliases = label === "circle" ? CIRCLE_EXTRA_ALIASES[item.id] || [] : [];

  for (const alias of [...kindAliases, ...sectionAliases, ...circleAliases]) {
    addAlias(aliasSet, alias);
  }

  const suffixMatch = cleanedName.match(/(市|縣|區|鄉|鎮)$/);
  const suffix = suffixMatch?.[1] || "";
  const bareName = suffix ? cleanedName.slice(0, -1) : cleanedName;
  const rootAliases = ROOT_ALIASES[bareName] || ROOT_ALIASES[cleanedName] || [];

  for (const baseAlias of rootAliases) {
    addAlias(aliasSet, baseAlias);

    if (suffix === "市") {
      addAlias(aliasSet, `${baseAlias}city`);
    } else if (suffix === "縣") {
      addAlias(aliasSet, `${baseAlias}county`);
    } else if (suffix === "區") {
      addAlias(aliasSet, `${baseAlias}district`);
    } else if (suffix === "鄉") {
      addAlias(aliasSet, `${baseAlias}township`);
    } else if (suffix === "鎮") {
      addAlias(aliasSet, `${baseAlias}town`);
    }
  }

  if (label === "circle") {
    for (const token of cleanedName.replace(/商圈$/g, "").split(/(?=溫泉)/)) {
      const roots = ROOT_ALIASES[token] || [];
      for (const baseAlias of roots) {
        addAlias(aliasSet, baseAlias);
      }
    }
  }

  return [...aliasSet];
}

function handleListMode(taxonomy, args) {
  const listType = String(args.listType || "").toLowerCase();
  const regionFilter = args.region ? resolveOne("region", taxonomy.regions, args.region) : null;

  let items = [];

  switch (listType) {
    case "regions":
      items = taxonomy.regions;
      break;
    case "kinds":
      items = taxonomy.kinds;
      break;
    case "sections":
      items = taxonomy.sections;
      if (regionFilter) {
        items = items.filter((item) => item.regionId === regionFilter.id);
      }
      break;
    case "circles":
      items = taxonomy.circles;
      if (regionFilter) {
        items = items.filter((item) => item.regionId === regionFilter.id);
      }
      break;
    default:
      throw new Error("`--list` must be one of: regions, kinds, sections, circles");
  }

  if (args.query) {
    const needle = normalizeText(args.query);
    items = items.filter((item) => matchesQuery(item, needle));
  }

  if (items.length === 0) {
    console.log("No matches.");
    return;
  }

  console.log(`${capitalize(listType)} from ${path.relative(rootDir, taxonomy.filePath)}`);
  console.log(`Matches: ${items.length}`);

  for (const item of items) {
    console.log(formatListItem(listType, item));
  }
}

function handleUrlMode(taxonomy, args) {
  const region = args.region ? resolveOne("region", taxonomy.regions, args.region) : null;
  const kind = args.kind ? resolveOne("kind", taxonomy.kinds, args.kind) : null;
  const sectionPool = region
    ? taxonomy.sections.filter((item) => item.regionId === region.id)
    : taxonomy.sections;
  const circlePool = region
    ? taxonomy.circles.filter((item) => item.regionId === region.id)
    : taxonomy.circles;
  const section = args.section ? resolveOne("section", sectionPool, args.section) : null;
  const circle = args.circle ? resolveOne("circle", circlePool, args.circle) : null;

  if (!region) {
    throw new Error("URL mode requires at least `--region`.");
  }

  const url = new URL(baseListUrl);
  url.searchParams.set("region", String(region.id));

  if (kind) {
    url.searchParams.set("kind", String(kind.id));
  }

  if (section) {
    url.searchParams.set("section", String(section.id));
  }

  if (circle) {
    url.searchParams.set("circle", String(circle.id));
  }

  if (Number.isFinite(args.page) && args.page > 1) {
    url.searchParams.set("page", String(Math.trunc(args.page)));
  }

  console.log(`Taxonomy: ${path.relative(rootDir, taxonomy.filePath)}`);
  console.log(`Region: ${region.id} ${region.name}`);
  if (kind) {
    console.log(`Kind: ${kind.id} ${kind.name}`);
  }
  if (section) {
    console.log(`Section: ${section.id} ${section.name}`);
  }
  if (circle) {
    console.log(`Circle: ${circle.id} ${circle.name}`);
  }
  console.log(`URL: ${url.href}`);
}

function resolveOne(label, items, query) {
  const exactId = Number(query);
  if (Number.isFinite(exactId)) {
    const byId = items.find((item) => item.id === exactId);
    if (!byId) {
      throw new Error(`No ${label} found with id ${exactId}.`);
    }
    return byId;
  }

  const normalizedQuery = normalizeText(query);
  const exactMatches = items.filter((item) => matchesExact(item, normalizedQuery));

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  const fuzzyMatches = items.filter((item) => matchesQuery(item, normalizedQuery));

  if (fuzzyMatches.length === 1) {
    return fuzzyMatches[0];
  }

  const matches = exactMatches.length > 1 ? exactMatches : fuzzyMatches;

  if (matches.length === 0) {
    throw new Error(`No ${label} matched "${query}".`);
  }

  const preview = matches.slice(0, 10).map((item) => formatCandidate(label, item)).join("\n");
  throw new Error(
    `Ambiguous ${label} "${query}". Candidates:\n${preview}${matches.length > 10 ? "\n..." : ""}`,
  );
}

function matchesExact(item, normalizedQuery) {
  return (
    normalizeText(item.name) === normalizedQuery ||
    item.aliases.some((alias) => alias === normalizedQuery)
  );
}

function matchesQuery(item, normalizedQuery) {
  const values = [normalizeText(item.name), ...item.aliases];
  return values.some(
    (candidate) =>
      candidate.includes(normalizedQuery) || normalizedQuery.includes(candidate),
  );
}

function formatListItem(listType, item) {
  switch (listType) {
    case "regions":
      return `${item.id} | ${item.name} | ${item.group}`;
    case "kinds":
      return `${item.id} | ${item.name}`;
    case "sections":
      return `${item.id} | ${item.name} | ${item.regionName}`;
    case "circles":
      return `${item.id} | ${item.name} | ${item.regionName}`;
    default:
      return `${item.id} | ${item.name}`;
  }
}

function formatCandidate(label, item) {
  if (label === "section" || label === "circle") {
    return `- ${item.id} | ${item.name} | ${item.regionName}`;
  }
  return `- ${item.id} | ${item.name}`;
}

function addAlias(aliasSet, value) {
  const normalized = normalizeText(value);
  if (normalized) {
    aliasSet.add(normalized);
  }
}

function cleanChineseName(value) {
  return String(value || "").trim().replace(/\s+/g, "").replace(/臺/g, "台");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/臺/g, "台")
    .replace(/[._-]/g, "")
    .toLowerCase();
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function printUsage() {
  console.log(`Usage:
  node scripts/resolve-591-url.mjs --region <name-or-id> [--kind <name-or-id>] [--section <name-or-id>] [--circle <name-or-id>] [--page <n>]
  node scripts/resolve-591-url.mjs --list <regions|kinds|sections|circles> [--region <name-or-id>] [--query <text>]

What it accepts:
  - Chinese names: 台東縣, 臺東市, 知本溫泉商圈
  - English aliases: taitung, taitungcity, studio, parking
  - County / city shorthand: taitungcounty, ttcounty, taitungcity, ttcity
  - Numeric ids: 22, 341, 22295

Common kind aliases:
  apartment -> 整層住家
  studio -> 獨立套房
  room -> 雅房
  parking -> 車位

Examples:
  node scripts/resolve-591-url.mjs --region 台東縣 --kind 獨立套房 --section 台東市 --page 2
  node scripts/resolve-591-url.mjs --region taitung --kind studio --section taitungcity --page 2
  node scripts/resolve-591-url.mjs --list sections --region taitung
  node scripts/resolve-591-url.mjs --list circles --region taitung --query zhiben
`);
}

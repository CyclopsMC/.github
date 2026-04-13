#!/usr/bin/env node
/**
 * Regenerates the mod version table in profile/README.md based on the modpack pom.xml files.
 * For each loader entry, it also fetches CurseForge download links from the CyclopsMC/Versions repo.
 *
 * Usage: node scripts/generate-readme.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Map from groupId prefix (after "org.cyclops.") to CurseForge slug and display name
const MOD_INFO = {
  cyclopscore:       { slug: 'cyclops-core',        name: 'CyclopsCore',         github: 'CyclopsCore',         modrinth: 'Z9DM0LJ4' },
  flopper:           { slug: 'flopper',              name: 'Flopper',             github: 'Flopper',             modrinth: 'aTMAqQMY' },
  structuredcrafting:{ slug: 'structured-crafting',  name: 'StructuredCrafting',  github: 'StructuredCrafting',  modrinth: 'GTi2kHAW' },
  commoncapabilities:{ slug: 'common-capabilities',  name: 'CommonCapabilities',  github: 'CommonCapabilities',  modrinth: 'oFXrCkDI' },
  capabilityproxy:   { slug: 'capabilityproxy',      name: 'CapabilityProxy',     github: 'CapabilityProxy',     modrinth: '3mPgwv8n' },
  everlastingabilities:{ slug: 'everlastingabilities', name: 'EverlastingAbilities', github: 'EverlastingAbilities', modrinth: 'xDwJf4pi' },
  energeticsheep:    { slug: 'energeticsheep',       name: 'EnergeticSheep',      github: 'EnergeticSheep',      modrinth: 'TC6LFnue' },
  colossalchests:    { slug: 'colossal-chests',      name: 'ColossalChests',      github: 'ColossalChests',      modrinth: 'V8HM9qmm' },
  iconexporter:      { slug: 'iconexporter',         name: 'IconExporter',        github: 'IconExporter',        modrinth: '8KCmS7Bd' },
  integrateddynamics:{ slug: 'integrated-dynamics',  name: 'IntegratedDynamics',  github: 'IntegratedDynamics',  modrinth: 'yYzdQHJI' },
  integratedtunnels: { slug: 'integrated-tunnels',   name: 'IntegratedTunnels',   github: 'IntegratedTunnels',   modrinth: 'Etqy1Omb' },
  integratedcrafting:{ slug: 'integrated-crafting',  name: 'IntegratedCrafting',  github: 'IntegratedCrafting',  modrinth: 'qwpACdla' },
  integratedterminals:{ slug: 'integrated-terminals', name: 'IntegratedTerminals', github: 'IntegratedTerminals', modrinth: 'HmLJoQ1K' },
  integratedscripting:{ slug: 'integrated-scripting', name: 'IntegratedScripting', github: 'IntegratedScripting', modrinth: 'uDJkuFRe' },
  integratedrest:    { slug: 'integrated-rest',      name: 'IntegratedREST',      github: 'IntegratedREST',      modrinth: 'ovubcV3F' },
  integratedmekanism:{ slug: 'integrated-mekanism',  name: 'IntegratedMekanism',  github: 'IntegratedMekanism',  modrinth: 'NknNmkiU' },
  evilcraft:         { slug: 'evilcraft',            name: 'EvilCraft',           github: 'EvilCraft',           modrinth: '3ANq2btA' },
};

// Canonical mod display order
const MOD_ORDER = [
  'cyclopscore', 'flopper', 'structuredcrafting', 'commoncapabilities',
  'capabilityproxy', 'everlastingabilities', 'energeticsheep', 'colossalchests',
  'iconexporter', 'integrateddynamics', 'integratedtunnels', 'integratedcrafting',
  'integratedterminals', 'integratedscripting', 'integratedrest', 'integratedmekanism',
  'evilcraft',
];

// MC versions in display order with their branch label
const MC_VERSIONS = [
  { mc: '1.20.1', label: '`1.20-lts`' },
  { mc: '1.21.1', label: '`1.21-lts`' },
  { mc: '26.1.1', label: '`26`' },
];

const LOADERS = ['neoforge', 'forge', 'fabric'];

/**
 * Parse a pom.xml file and return a map of modKey -> { version, loader }.
 * Handles both new format (artifactId = "{mod}-{mc}-{loader}", version = "{semver}-{build}")
 * and old format (artifactId = "{mod}", version = "{mc}-{semver}-{build}").
 */
function parsePom(pomPath, loader) {
  let content;
  try {
    content = readFileSync(pomPath, 'utf-8');
  } catch {
    return null;
  }

  const deps = {};
  const depRegex = /<dependency>\s*<groupId>(org\.cyclops\.(\w+))<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*<version>([^<]+)<\/version>/g;
  let match;
  while ((match = depRegex.exec(content)) !== null) {
    const modKey = match[2]; // e.g. "cyclopscore"
    const artifactId = match[3]; // e.g. "cyclopscore-1.21.1-neoforge" or "cyclopscore"
    const rawVersion = match[4]; // e.g. "1.29.0-962" or "1.20.1-1.22.0-1"

    if (!MOD_INFO[modKey]) continue;

    let semver;
    // New format: artifactId contains "-{mc}-{loader}", version is "{semver}-{build}"
    if (artifactId.endsWith('-' + loader)) {
      semver = rawVersion.replace(/-\d+$/, ''); // strip trailing build number
    } else {
      // Old format: version is "{mc}-{semver}-{build}"
      // Strip leading "{mc}-" prefix and trailing "-{build}"
      semver = rawVersion.replace(/^\d+\.\d+[\d.]+-/, '').replace(/-\d+$/, '');
    }

    deps[modKey] = { semver, loader };
  }
  return deps;
}

/**
 * Fetch the CurseForge update JSON for a mod/loader from the CyclopsMC/Versions GitHub repo.
 * Returns the parsed JSON or null on failure.
 */
async function fetchVersionsJson(loaderType, slug) {
  const url = `https://raw.githubusercontent.com/CyclopsMC/Versions/master/${loaderType}_update/${slug}.json`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Look up a CurseForge download URL for a given MC version and mod semver.
 * The versionsJson is the parsed update JSON from CyclopsMC/Versions.
 */
function getCurseForgeUrl(versionsJson, mcVersion, semver) {
  if (!versionsJson) return null;
  const mcEntry = versionsJson[mcVersion];
  if (!mcEntry) return null;
  const entry = mcEntry[semver];
  if (!entry) return null;
  // Entry is like "Download and changelog available at https://www.curseforge.com/..."
  const urlMatch = entry.match(/https:\/\/www\.curseforge\.com\/[^\s]+/);
  return urlMatch ? urlMatch[0] : null;
}

/**
 * Collect all mod data across MC versions and loaders.
 * Returns: Map<modKey, Map<mcVersion, Map<loader, {semver, cfUrl}>>>
 */
async function collectModData() {
  // Step 1: Parse all pom files
  const rawData = {}; // modKey -> mcVersion -> loader -> semver
  for (const { mc } of MC_VERSIONS) {
    for (const loader of LOADERS) {
      const pomPath = join(ROOT, 'modpacks', 'cyclops-all', mc, loader, 'pom.xml');
      const deps = parsePom(pomPath, loader);
      if (!deps) continue;
      for (const [modKey, { semver }] of Object.entries(deps)) {
        if (!rawData[modKey]) rawData[modKey] = {};
        if (!rawData[modKey][mc]) rawData[modKey][mc] = {};
        rawData[modKey][mc][loader] = semver;
      }
    }
  }

  // Step 2: Fetch CurseForge URLs for all needed mod/loader/version combos
  // Collect unique (loaderType, slug, mcVersion, semver) combos
  const cfCache = {}; // "loaderType:slug" -> versionsJson

  async function getVersionsJson(loaderType, slug) {
    const key = `${loaderType}:${slug}`;
    if (!(key in cfCache)) {
      cfCache[key] = await fetchVersionsJson(loaderType, slug);
    }
    return cfCache[key];
  }

  // Fetch all needed JSONs in parallel
  const fetchPromises = [];
  for (const modKey of MOD_ORDER) {
    const info = MOD_INFO[modKey];
    if (!info) continue;
    for (const loaderType of ['forge', 'neoforge', 'fabric']) {
      fetchPromises.push(getVersionsJson(loaderType, info.slug));
    }
  }
  await Promise.all(fetchPromises);

  // Step 3: Build final data with CurseForge URLs
  const result = {}; // modKey -> mcVersion -> loader -> { semver, cfUrl }
  for (const modKey of MOD_ORDER) {
    const info = MOD_INFO[modKey];
    if (!info || !rawData[modKey]) continue;
    result[modKey] = {};
    for (const { mc } of MC_VERSIONS) {
      if (!rawData[modKey][mc]) continue;
      result[modKey][mc] = {};
      for (const loader of LOADERS) {
        const semver = rawData[modKey][mc]?.[loader];
        if (!semver) continue;
        const versionsJson = await getVersionsJson(loader, info.slug);
        const cfUrl = getCurseForgeUrl(versionsJson, mc, semver);
        result[modKey][mc][loader] = { semver, cfUrl };
      }
    }
  }

  return result;
}

/**
 * Format a cell value for the table, showing version with loader download links.
 * Example: "1.29.0 ([NeoForge](url), [Forge](url), [Fabric](url))"
 * If no CurseForge URL is available, falls back to the loader name without a link.
 */
function formatCell(mcVersionData) {
  if (!mcVersionData || Object.keys(mcVersionData).length === 0) return 'N/A';

  // Get the semver (should be the same across loaders, or use the first available)
  const semvers = new Set(Object.values(mcVersionData).map(d => d.semver));
  const semver = semvers.values().next().value;

  const loaderLabels = {
    neoforge: 'NeoForge',
    forge: 'Forge',
    fabric: 'Fabric',
  };

  const parts = [];
  for (const loader of LOADERS) {
    const data = mcVersionData[loader];
    if (!data) continue;
    const label = loaderLabels[loader];
    if (data.cfUrl) {
      parts.push(`[${label}](${data.cfUrl})`);
    } else {
      parts.push(label);
    }
  }

  return `${semver} (${parts.join(', ')})`;
}

/**
 * Generate the table rows for all mods.
 */
function generateTable(modData) {
  const mcHeaders = MC_VERSIONS.map(({ mc, label }) => `MC ${mc} (${label})`);
  const header = `| Mod name | ${mcHeaders.join(' | ')} |`;
  const separator = `| -------- | ${mcHeaders.map(() => '-------').join(' | ')} |`;

  const rows = [header, separator];

  for (const modKey of MOD_ORDER) {
    const info = MOD_INFO[modKey];
    if (!info) continue;

    const githubUrl = `https://github.com/CyclopsMC/${info.github}/`;
    const cfUrl = `https://www.curseforge.com/minecraft/mc-mods/${info.slug}`;
    const mrUrl = `https://modrinth.com/mod/${info.modrinth}`;
    const modName = `[${info.name}](${githubUrl}) ([CurseForge](${cfUrl}), [Modrinth](${mrUrl}))`;

    const cells = MC_VERSIONS.map(({ mc }) => {
      const mcData = modData[modKey]?.[mc];
      return formatCell(mcData);
    });

    rows.push(`| ${modName} | ${cells.join(' | ')} |`);
  }

  return rows.join('\n');
}

/**
 * Update the README.md file, replacing the table section.
 */
function updateReadme(table) {
  const readmePath = join(ROOT, 'profile', 'README.md');
  const content = readFileSync(readmePath, 'utf-8');

  // Replace everything from the first table line to just before "TODOs:"
  // The table starts with "| Mod name" and we replace up to the end of the file
  // (removing the TODO section as well)
  const tableStart = content.indexOf('| Mod name');
  if (tableStart === -1) {
    throw new Error('Could not find table start in README.md');
  }

  const newContent = content.slice(0, tableStart) + table + '\n';
  writeFileSync(readmePath, newContent, 'utf-8');
  console.log('README.md updated successfully.');
}

async function main() {
  console.log('Collecting mod data from pom.xml files...');
  const modData = await collectModData();

  console.log('Generating table...');
  const table = generateTable(modData);

  console.log('Updating README.md...');
  updateReadme(table);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

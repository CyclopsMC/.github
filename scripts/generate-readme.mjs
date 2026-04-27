#!/usr/bin/env node
/**
 * Regenerates the mod version table in profile/README.md based on the modpack pom.xml files.
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
  { mc: '26.1.2', label: '`26`' },
];

const LOADERS = ['neoforge', 'forge', 'fabric'];

const LOADER_TAGS = {
  neoforge: 'NeoForge',
  forge: 'Forge',
  fabric: 'Fabric',
};

/**
 * Parse a pom.xml file and return a map of modKey -> { displayVersion, cfVersion, loader }.
 * - displayVersion: full version string including build number (for display in the README)
 * - cfVersion: semver without build number (for matching against CurseForge file names)
 *
 * Handles both:
 *   - New format: artifactId = "{mod}-{mc}-{loader}", version = "{semver}-{build}"
 *   - Old format: artifactId = "{mod}", version = "{mc}-{semver}-{build}" or "{semver}-{build}"
 */
function parsePom(pomPath, loader, mc) {
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
    const rawVersion = match[4]; // e.g. "1.29.0-962" or "1.20.1-1.22.0-949"

    if (!MOD_INFO[modKey]) continue;

    let displayVersion, cfVersion;

    if (artifactId.endsWith('-' + loader)) {
      // New format: version is "{semver}-{build}"
      displayVersion = rawVersion;
      cfVersion = rawVersion.replace(/-\d+$/, ''); // strip trailing build number for CurseForge lookup
    } else {
      // Old format: version is either "{mc}-{semver}-{build}" or "{semver}-{build}"
      // Distinguish by checking whether the version actually starts with the known mc prefix.
      if (rawVersion.startsWith(mc + '-')) {
        const withoutMc = rawVersion.slice(mc.length + 1); // e.g. "1.22.0-949"
        displayVersion = withoutMc;
        cfVersion = withoutMc.replace(/-\d+$/, ''); // e.g. "1.22.0"
      } else {
        // Version is "{semver}-{build}" directly (e.g. IntegratedDynamics "1.21.2-735")
        displayVersion = rawVersion;
        cfVersion = rawVersion.replace(/-\d+$/, '');
      }
    }

    deps[modKey] = { displayVersion, cfVersion, loader };
  }
  return deps;
}

/**
 * Collect all mod data across MC versions and loaders.
 * Returns: Map<modKey, Map<mcVersion, Map<loader, { displayVersion, cfVersion }>>>
 */
function collectModData() {
  const result = {};
  for (const { mc } of MC_VERSIONS) {
    for (const loader of LOADERS) {
      const pomPath = join(ROOT, 'modpacks', 'cyclops-all', mc, loader, 'pom.xml');
      const deps = parsePom(pomPath, loader, mc);
      if (!deps) continue;
      for (const [modKey, { displayVersion, cfVersion }] of Object.entries(deps)) {
        if (!result[modKey]) result[modKey] = {};
        if (!result[modKey][mc]) result[modKey][mc] = {};
        result[modKey][mc][loader] = { displayVersion, cfVersion };
      }
    }
  }
  return result;
}

/**
 * Fetch all files for every mod from the cfwidget API.
 * Returns: Map<slug, files[]>
 */
async function fetchAllCurseForgeData() {
  const slugs = [...new Set(Object.values(MOD_INFO).map(i => i.slug))];
  const result = {};
  for (const slug of slugs) {
    const url = `https://api.cfwidget.com/minecraft/mc-mods/${slug}`;
    console.log(`  Fetching CurseForge data for ${slug}...`);
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`  Warning: could not fetch ${url} (${response.status})`);
      result[slug] = [];
      continue;
    }
    const data = await response.json();
    result[slug] = data.files || [];
  }
  return result;
}

/**
 * Find the exact CurseForge file page URL for a specific mod version + MC version + loader.
 * Falls back to the generic filtered files page if no exact match is found.
 */
function findFileUrl(files, mc, loader, cfVersion, slug) {
  const loaderTag = LOADER_TAGS[loader];
  const suffix = `-${cfVersion}.jar`.toLowerCase();

  for (const file of files) {
    const name = file.name.toLowerCase();
    if (!name.endsWith(suffix)) continue;
    if (!file.versions || !file.versions.includes(mc)) continue;
    if (loaderTag && file.versions.includes(loaderTag)) return file.url;
  }

  // Fallback: match by mc version and semver suffix, ignoring loader tag
  // (handles mods where files don't carry a loader version tag)
  for (const file of files) {
    const name = file.name.toLowerCase();
    if (name.endsWith(suffix) && file.versions && file.versions.includes(mc)) {
      return file.url;
    }
  }

  // Last resort: generic files page filtered by MC version
  return `https://www.curseforge.com/minecraft/mc-mods/${slug}/files?version=${mc}`;
}

/**
 * Format a cell value for the table, showing version with per-loader CurseForge links.
 * Example: "1.29.0-962 ([NeoForge](url1), [Forge](url2), [Fabric](url3))"
 */
function formatCell(mcVersionData, mc, slug, cfFiles) {
  if (!mcVersionData || Object.keys(mcVersionData).length === 0) return 'N/A';

  // Display version: use the first available (should be the same across loaders)
  const displayVersion = Object.values(mcVersionData)[0].displayVersion;

  const files = cfFiles[slug] || [];

  const parts = [];
  for (const loader of LOADERS) {
    const loaderData = mcVersionData[loader];
    if (!loaderData) continue;
    const url = findFileUrl(files, mc, loader, loaderData.cfVersion, slug);
    parts.push(`[${LOADER_TAGS[loader]}](${url})`);
  }

  return `${displayVersion} (${parts.join(', ')})`;
}

/**
 * Generate the table rows for all mods.
 */
function generateTable(modData, cfFiles) {
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
      return formatCell(mcData, mc, info.slug, cfFiles);
    });

    rows.push(`| ${modName} | ${cells.join(' | ')} |`);
  }

  // Totals row: count loader instances per MC version
  const totalCells = MC_VERSIONS.map(({ mc }) => {
    let count = 0;
    for (const modKey of MOD_ORDER) {
      const mcData = modData[modKey]?.[mc];
      if (mcData) count += Object.keys(mcData).length;
    }
    return `**${count}**`;
  });
  rows.push(`| **Total** | ${totalCells.join(' | ')} |`);

  return rows.join('\n');
}

/**
 * Update the README.md file, replacing the table section.
 */
function updateReadme(table) {
  const readmePath = join(ROOT, 'profile', 'README.md');
  const content = readFileSync(readmePath, 'utf-8');

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
  const modData = collectModData();

  console.log('Fetching CurseForge file data...');
  const cfFiles = await fetchAllCurseForgeData();

  console.log('Generating table...');
  const table = generateTable(modData, cfFiles);

  console.log('Updating README.md...');
  updateReadme(table);
}

main().catch(err => { console.error(err); process.exit(1); });

#!/usr/bin/env node

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  ARTIFACT_SPEC_V2,
  HOST_API_V1,
  generateArtifactManifest,
  isArtifactDefinition,
} from "./index.js";

function printUsage() {
  console.log(`crafter8-build

Usage:
  crafter8-build --entry <file> [--runtime-entry <file>] [--out-dir <dir>] [--version <version>] [--spec-version <n>] [--host-api <n>] [--legacy-uses] [--emit-community-datapack] [--publication-dir <dir>] [--stdout]

Examples:
  crafter8-build --entry ./src/index.js --out-dir ./dist
  crafter8-build --entry ./src/crafter8.js --out-dir ./dist
  crafter8-build --entry ./src/crafter8.js --runtime-entry ./src/index.js --out-dir ./dist
  crafter8-build --entry ./crafter8.mjs --emit-community-datapack --publication-dir .
  crafter8-build --entry ./src/crafter8.js --legacy-uses --out-dir ./dist
  crafter8-build --entry ./src/crafter8.js --version 1.2.0 --stdout
`);
}

function parseArgs(argv) {
  const options = {
    outDir: "dist",
    specVersion: ARTIFACT_SPEC_V2,
    hostApi: HOST_API_V1,
    stdout: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--stdout") {
      options.stdout = true;
      continue;
    }

    if (arg === "--legacy-uses") {
      options.legacyUses = true;
      continue;
    }

    if (arg === "--emit-community-datapack") {
      options.emitCommunityDatapack = true;
      continue;
    }

    const next = argv[index + 1];

    if (arg === "--entry") {
      options.entry = next;
      index += 1;
      continue;
    }

    if (arg === "--out-dir") {
      options.outDir = next;
      index += 1;
      continue;
    }

    if (arg === "--runtime-entry") {
      options.runtimeEntry = next;
      index += 1;
      continue;
    }

    if (arg === "--version") {
      options.version = next;
      index += 1;
      continue;
    }

    if (arg === "--publication-dir") {
      options.publicationDir = next;
      index += 1;
      continue;
    }

    if (arg === "--spec-version") {
      options.specVersion = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--host-api") {
      options.hostApi = Number(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function ensureFile(filePath, label) {
  if (!filePath) {
    throw new Error(`${label} is required.`);
  }

  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`${label} does not exist: ${absolutePath}`);
  }
  return absolutePath;
}

function findNearestPackageJson(startDir) {
  let currentDir = startDir;

  while (true) {
    const candidate = path.join(currentDir, "package.json");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function findNearestGitRoot(startDir) {
  let currentDir = startDir;

  while (true) {
    const candidate = path.join(currentDir, ".git");
    if (fs.existsSync(candidate)) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function relativePosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

function resolveVersion(entryPath, explicitVersion) {
  if (explicitVersion) {
    return explicitVersion;
  }

  const packageJsonPath = findNearestPackageJson(path.dirname(entryPath));
  if (!packageJsonPath) {
    throw new Error("Could not find package.json for declaration entry. Pass --version explicitly.");
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version.trim() === "") {
    throw new Error(`package.json is missing a valid version: ${packageJsonPath}`);
  }

  return packageJson.version.trim();
}

async function loadDefinition(entryPath) {
  const moduleUrl = pathToFileURL(entryPath).href;
  const loaded = await import(moduleUrl);
  const definition = loaded.default ?? loaded.artifact ?? loaded.definition;

  if (!isArtifactDefinition(definition)) {
    throw new Error(`Declaration module did not export a Crafter8 definition as default, artifact, or definition: ${entryPath}`);
  }

  return definition;
}

function packageNameFromSpecifier(specifier) {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
    return null;
  }
  if (/^[A-Za-z]:[\\/]/.test(specifier)) {
    return null;
  }
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return specifier.split("/")[0] || null;
}

function resolveLocalImport(importerPath, specifier) {
  const basePath = path.resolve(path.dirname(importerPath), specifier);
  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.jsx`,
    path.join(basePath, "index.js"),
    path.join(basePath, "index.mjs"),
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.jsx"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function collectImportSpecifiers(filePath, visited = new Set(), packageNames = new Set()) {
  const absolutePath = path.resolve(filePath);
  if (visited.has(absolutePath)) {
    return packageNames;
  }
  visited.add(absolutePath);

  const source = fs.readFileSync(absolutePath, "utf8");
  const patterns = [
    /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"'`]+)["']/g,
    /import\s*\(\s*["']([^"'`]+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const specifier = String(match[1] || "").trim();
      if (!specifier) continue;
      if (specifier.startsWith(".")) {
        const resolved = resolveLocalImport(absolutePath, specifier);
        if (resolved) {
          collectImportSpecifiers(resolved, visited, packageNames);
        }
        continue;
      }
      const packageName = packageNameFromSpecifier(specifier);
      if (packageName) {
        packageNames.add(packageName);
      }
    }
  }

  return packageNames;
}

async function readCrafter8DependencyDefinition(packageName, runtimeEntryPath) {
  if (!packageName || packageName === "@crafter8/sdk") {
    return null;
  }

  const requireFromEntry = createRequire(runtimeEntryPath);
  let crafter8EntryPath;
  try {
    crafter8EntryPath = requireFromEntry.resolve(`${packageName}/crafter8`);
  } catch {
    return null;
  }

  try {
    const source = fs.readFileSync(crafter8EntryPath, "utf8");
    const kind =
      source.includes("defineDatapack(")
        ? "datapack"
        : source.includes("defineModule(")
          ? "module"
          : source.includes("defineApp(")
            ? "app"
            : null;
    const idMatch = source.match(/\bid\s*:\s*["']([^"'`]+)["']/);
    if (kind && (kind === "datapack" || kind === "module")) {
      return {
        kind,
        id: idMatch?.[1]?.trim() || packageName,
      };
    }
  } catch {
    // Fall through to dynamic import.
  }

  const loaded = await import(pathToFileURL(crafter8EntryPath).href);
  const definition = loaded.default ?? loaded.artifact ?? loaded.definition;
  return isArtifactDefinition(definition) ? definition : null;
}

export async function extractCrafter8Dependencies(options) {
  if (!options?.runtimeEntry) {
    return { modules: [], datapacks: [] };
  }

  const runtimeEntryPath = ensureFile(options.runtimeEntry, "runtime entry");
  const packageNames = Array.from(collectImportSpecifiers(runtimeEntryPath));
  const dependencies = {
    modules: [],
    datapacks: [],
  };

  for (const packageName of packageNames) {
    const definition = await readCrafter8DependencyDefinition(packageName, runtimeEntryPath);
    if (!definition) {
      continue;
    }
    if (definition.kind === "module") {
      dependencies.modules.push(definition.id);
    }
    if (definition.kind === "datapack") {
      dependencies.datapacks.push(definition.id);
    }
  }

  return {
    modules: Array.from(new Set(dependencies.modules)).sort(),
    datapacks: Array.from(new Set(dependencies.datapacks)).sort(),
  };
}

function writeManifest(outDir, manifest) {
  const crafter8Dir = path.join(outDir, ".crafter8");
  fs.mkdirSync(crafter8Dir, { recursive: true });
  const manifestPath = path.join(crafter8Dir, "artifact.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

function inferDatapackContentType(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".json") return "application/json";
  if (ext === ".txt" || ext === ".md") return "text/plain";
  if (ext === ".csv") return "text/csv";
  if (ext === ".html") return "text/html";
  if (ext === ".css") return "text/css";
  if (ext === ".js" || ext === ".mjs") return "application/javascript";
  return "application/octet-stream";
}

function collectDatapackPublishEntries(rootDir) {
  const rows = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      const relativePath = relativePosix(rootDir, absolutePath);
      const key = relativePath.replace(/\.[^.]+$/u, "");
      rows.push({
        key,
        label: key,
        kind: "file",
        path: relativePath,
        contentType: inferDatapackContentType(relativePath),
        role: key === "manifest" ? "dataset-manifest" : "content",
      });
    }
  }

  walk(rootDir);
  return rows;
}

function buildCommunityDatapackManifestFromDefinition(definition, options) {
  if (definition.kind !== "datapack") {
    throw new Error("Community datapack publication can only be generated for datapack definitions.");
  }

  const entryPath = ensureFile(options.entry, "entry");
  const packageJsonPath = findNearestPackageJson(path.dirname(entryPath));
  if (!packageJsonPath) {
    throw new Error("Could not find package.json for datapack declaration entry.");
  }

  const packageDir = path.dirname(packageJsonPath);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (typeof packageJson.name !== "string" || packageJson.name.trim() === "") {
    throw new Error(`package.json is missing a valid name: ${packageJsonPath}`);
  }

  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : findNearestGitRoot(packageDir) ?? packageDir;
  const version = resolveVersion(entryPath, options.version);
  const packageName = packageJson.name.trim();
  const slug = packageName.split("/").pop();
  const contentsRoot = path.resolve(path.dirname(entryPath), definition.contents?.root || ".");
  if (!fs.existsSync(contentsRoot) || !fs.statSync(contentsRoot).isDirectory()) {
    throw new Error(`Datapack contents root does not exist: ${contentsRoot}`);
  }
  const payloadRoot = relativePosix(packageDir, contentsRoot);
  const publishEntries = collectDatapackPublishEntries(contentsRoot);
  const manifestEntryRelative =
    typeof definition.contents?.manifest === "string" && definition.contents.manifest.trim() !== ""
      ? relativePosix(contentsRoot, path.resolve(path.dirname(entryPath), definition.contents.manifest.trim()))
      : null;

  const contents = publishEntries.map((entry) =>
    manifestEntryRelative && entry.path === manifestEntryRelative
      ? {
          ...entry,
          key: "manifest",
          label: "manifest",
          role: "dataset-manifest",
        }
      : entry,
  );
  contents.sort((a, b) => {
    if (a.key === "manifest" && b.key !== "manifest") return -1;
    if (b.key === "manifest" && a.key !== "manifest") return 1;
    return String(a.key).localeCompare(String(b.key));
  });

  const manifest = {
    kind: "datapack",
    manifestVersion: 1,
    packageName,
    id: definition.id,
    slug,
    name: definition.name,
    description: definition.summary || definition.name,
    version,
    package: relativePosix(repoRoot, packageDir),
    capability: "datapacks.read",
    payloadRoot,
    provides: definition.provides || {},
    publish: {
      sourceRoot: payloadRoot,
      entries: contents.map((entry) => ({
        from: entry.path,
        to: entry.path,
      })),
    },
    contents,
  };

  const registry = [
    {
      kind: "datapack",
      packageName,
      id: definition.id,
      slug,
      name: definition.name,
      description: definition.summary || definition.name,
      version,
      capability: "datapacks.read",
      package: relativePosix(repoRoot, packageDir),
      manifestVersion: 1,
      manifestPath: `${relativePosix(repoRoot, packageDir)}/community-datapack.manifest.json`,
      payloadRoot: `${relativePosix(repoRoot, packageDir)}/${payloadRoot}`,
      generatedAt: new Date().toISOString(),
      contentKeys: contents.map((entry) => entry.key),
      ...(definition.provides?.profile ? { profile: definition.provides.profile } : {}),
    },
  ];

  return {
    manifest,
    registry,
    packageDir,
  };
}

function writeCommunityDatapackPublication(targetDir, publication) {
  fs.mkdirSync(targetDir, { recursive: true });
  const manifestPath = path.join(targetDir, "community-datapack.manifest.json");
  const registryPath = path.join(targetDir, "community-datapacks.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(publication.manifest, null, 2)}\n`);
  fs.writeFileSync(registryPath, `${JSON.stringify(publication.registry, null, 2)}\n`);
  return {
    manifestPath,
    registryPath,
  };
}

export async function buildArtifact(options) {
  const entryPath = ensureFile(options.entry, "entry");
  const version = resolveVersion(entryPath, options.version);
  const definition = await loadDefinition(entryPath);
  const dependencies = await extractCrafter8Dependencies({
    runtimeEntry: options.runtimeEntry || entryPath,
  });
  const manifest = generateArtifactManifest(definition, {
    version,
    specVersion: options.specVersion,
    hostApi: options.hostApi,
    dependencies,
    legacyUses: options.legacyUses === true,
  });

  if (options.stdout) {
    return { definition, dependencies, manifest, manifestPath: null, publication: null };
  }

  const outDir = path.resolve(options.outDir);
  const manifestPath = writeManifest(outDir, manifest);
  let publication = null;
  if (options.emitCommunityDatapack) {
    const builtPublication = buildCommunityDatapackManifestFromDefinition(definition, {
      ...options,
      entry: entryPath,
      version,
    });
    const publicationDir = path.resolve(options.publicationDir || builtPublication.packageDir);
    publication = {
      ...builtPublication,
      paths: writeCommunityDatapackPublication(publicationDir, builtPublication),
    };
  }
  return { definition, dependencies, manifest, manifestPath, publication };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const { manifest, manifestPath, publication } = await buildArtifact(options);

  if (options.stdout) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  console.log(`[crafter8-build] wrote ${manifestPath}`);
  if (publication?.paths?.manifestPath) {
    console.log(`[crafter8-build] wrote ${publication.paths.manifestPath}`);
  }
  if (publication?.paths?.registryPath) {
    console.log(`[crafter8-build] wrote ${publication.paths.registryPath}`);
  }
}

function resolveArgvEntrypointUrl(argvValue) {
  if (!argvValue) {
    return "";
  }

  try {
    return pathToFileURL(fs.realpathSync(argvValue)).href;
  } catch {
    return pathToFileURL(path.resolve(argvValue)).href;
  }
}

const isEntrypoint = import.meta.url === resolveArgvEntrypointUrl(process.argv[1]);
if (isEntrypoint) {
  main().catch((error) => {
    console.error(`[crafter8-build] Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

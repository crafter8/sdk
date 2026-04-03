# @crafter8/sdk

Första minimala SDK-paketet för Crafter8 artifacts.

Paketet innehåller:

- `defineApp(...)`
- `defineModule(...)`
- `defineDatapack(...)`
- `createCrafter8Client(...)`
- `createCrafter8HostServices(...)`
- `createEmbeddedCrafter8Environment(...)`
- `@crafter8/sdk/mock`
  - `createMockCrafter8Client(...)`
  - `createMockCrafter8HostServices(...)`
  - `createMockAppContext(...)`
- refs för `app`, `module`, `datapack`
- `generateArtifactManifest(...)` för V1/V2-manifest
- `crafter8-build` för att läsa en declaration entry och skriva `.crafter8/artifact.json`

Målet i denna första version är att ge:

- code-first declarations
- en kanonisk clientyta för data och compute
- separat hostyta för shellfunktioner
- generering av supersmala V1-manifest
- generering av V2-manifest med `capabilities`, generated `dependencies` och `provides`
- ett första körbart buildsteg som kan skriva manifest från en declaration-modul

Viktig dependency-riktning:

- generated `dependencies` är nu den primära sanningen i `.crafter8/artifact.json`
- handskriven `uses` finns kvar bara som transitional/legacy input
- `crafter8-build --legacy-uses` kan fortfarande skriva ut `uses` för kompatibilitet

Paketet är avsiktligt litet och speglar den nuvarande MVP-modellen i:

- `status/core/artifact-mvp-sdk-model.md`

Installera med:

```bash
npm install @crafter8/sdk
```

Kanoniskt repo:

- `https://github.com/crafter8/sdk`

## Docker development

För lokal SDK-utveckling i en isolerad container:

```bash
docker compose -f compose.sdk-dev.yml up -d sdk-dev
docker compose -f compose.sdk-dev.yml exec sdk-dev bash
```

Om du vill att containern ska kunna klona eller pusha mot `crafter8/sdk`, lägg en PAT i repo-roten `.env`:

```bash
CRAFTER8_SDK_GITHUB_PAT_TOKEN=...
```

Compose passerar då vidare den som:

- `CRAFTER8_SDK_GITHUB_PAT_TOKEN`
- `GITHUB_TOKEN`
- `GH_TOKEN`

och både `git` och `gh` i containern kan använda den utan att tokenen skrivs till disk som git-credentials.

Containern mountar hela repot under `/workspace` och startar i:

```bash
/workspace/packages/sdk
```

Vanliga kommandon därinne:

```bash
npm test
npm pack --dry-run
```

Det finns också en repo-förankrad devcontainer här:

- `.devcontainer/sdk/devcontainer.json`

Den är avsedd för lokal Dev Containers-användning och för ett senare Codespaces-spår.

## Export Till Separat SDK-repo

För att skriva ut ett fristående `crafter8/sdk`-repo från monorepot:

```bash
node ./scripts/export_sdk_repo.mjs --out-dir ./tmp/sdk-repo
```

För att även pusha innehållet till `crafter8/sdk`:

```bash
node ./scripts/export_sdk_repo.mjs --push
```

Pushflödet läser `CRAFTER8_SDK_GITHUB_PAT_TOKEN` från repo-roten `.env` eller från processens env.

Exempel:

```bash
crafter8-build --entry ./src/index.mjs --out-dir ./dist
```

Rekommenderad entry-modell:

- `app`
  - single-entry
  - samma entry exporterar `defineApp({ component })`
  - build/publish genererar intern `mountCommunityApp(...)`-shim
- `module`
  - declaration entry är fortfarande normalt
  - exempel: `./src/crafter8.mjs`
- `datapack`
  - declaration entry är fortfarande normalt
  - exempel: `./crafter8.mjs`

Exempel för module/datapack:

```bash
crafter8-build --entry ./src/crafter8.mjs --out-dir ./dist
```

För att också emit:a en minimal publicerad community-datapackrelease från ett SDK-datapack:

```bash
crafter8-build --entry ./crafter8.mjs --out-dir ./dist --emit-community-datapack --publication-dir .
```

Det skriver då ut:

- `.crafter8/artifact.json`
- `community-datapack.manifest.json`
- `community-datapacks.json`

När datapacket sedan publiceras i Crafter8s repo-interna publishsteg skrivs dess payload ut under:

- `/community-datapacks/<slug>/<version>/...`

och `client.datapacks.resolveContent(...)` kan då returnera en public static URL därifrån i stället för legacy inline-delivery via `/api/datapacks/:slug/content`.

Riktning för runtime:

- använd `Crafter8Client` för Crafter8-data och Crafter8-compute
- använd `Crafter8HostServices` för shellfunktioner som navigation
- behandla `HostRuntimeApi v1` som legacy/transitional embedded adaptering

Riktning för React-appar:

- använd `createCrafter8ReactBindings(React)` från `@crafter8/sdk/react`
- bindningarna returnerar:
  - `Crafter8Provider`
  - `useCrafter8Client()`
  - `useCrafter8Host()`
  - `useCrafter8Artifact()`
- publish-shimen wrappar component-appar automatiskt i providern

Riktning för standalone/dev-harness:

- använd `@crafter8/sdk/mock` för att skapa:
  - mockad `Crafter8Client`
  - mockade host services
  - mockad `AppContext`
- samma `defineApp({ component })`-entry kan då mountas både:
  - hostad i Crafter8
  - standalone i lokal dev/test

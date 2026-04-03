import { defineDatapack } from "../../index.js";

export default defineDatapack({
  id: "@leo/arcraiders-data",
  name: "ARC Raiders Data",
  summary: "Normalized ARC Raiders item and loot data",
  provides: {
    profile: "resource-production-graph/v1",
  },
  contents: {
    root: "./data",
    manifest: "./data/manifest.json",
  },
});

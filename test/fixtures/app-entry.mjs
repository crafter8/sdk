import { createDatapackRef, createModuleRef, defineApp } from "../../index.js";

export default defineApp({
  id: "@leo/stash-browser",
  name: "Stash Browser",
  summary: "Explore loot and crafting paths",
  capabilities: ["datapacks.read", "graph.read"],
  uses: {
    modules: [createModuleRef("@leo/graph-tools")],
    datapacks: [createDatapackRef("@leo/arcraiders-data")],
  },
  mount() {},
});

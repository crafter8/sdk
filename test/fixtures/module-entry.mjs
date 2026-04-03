import { createDatapackRef, createModuleRef, defineModule } from "../../index.js";

function plan() {}
function summarizeMap() {}

export default defineModule({
  id: "@leo/planner-core",
  name: "Planner Core",
  summary: "Planning helpers and operations",
  capabilities: ["graph.read"],
  uses: {
    modules: [createModuleRef("@leo/base-utils")],
    datapacks: [createDatapackRef("@leo/arcraiders-data")],
  },
  provides: {
    exports: {
      plan,
      summarizeMap,
    },
    operations: ["plan"],
  },
});

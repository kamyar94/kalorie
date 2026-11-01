// The contracts the app, the worker and the scripts share. Types and plain helpers only;
// implementations:
//   food search   lib/food/search.ts
//   foods         lib/food/custom-foods.ts, dishes.ts, memory.ts, off.ts (foods.ts lists them)
//   meals         lib/meals/service.ts, lib/meals/create.ts
//   analysis job  lib/analysis/handler.ts (pipeline in lib/analysis/pipeline.ts)
//   targets       lib/targets/service.ts
export * from "./analysis";
export * from "./food-search";
export * from "./foods";
export * from "./meals";
export * from "./nutrients";
export * from "./targets";

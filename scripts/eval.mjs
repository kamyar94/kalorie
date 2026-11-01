// Accuracy check on the owner's own weighed meals (docs/DESIGN.md section 13). Runs a folder of
// meals (photos plus a truth.json with the weighed grams and kcal) through one provider and model,
// exactly as the worker prompts and parses, and reports calorie and macro error, bias and latency.
// The folder format and the options are documented in lib/analysis/eval.ts.
//
//   CAL_EVAL_API_KEY=... corepack pnpm@11.11.0 eval --dir ./my-meals --provider google
//   CAL_EVAL_API_KEY=... corepack pnpm@11.11.0 eval --dir ./my-meals --provider openai \
//     --model gpt-6.1-sol --effort low --json results.json
//
// Each meal is one paid request to the provider. The key is read from the environment and never
// printed. Runs with tsx (a dev dependency), so it works from a checkout, not inside the image.
import { main } from "../lib/analysis/eval.ts";

process.exitCode = await main(process.argv.slice(2), process.env);

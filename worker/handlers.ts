// The handler registry: job kind -> handler (the meal analysis, medicine labels, push
// notifications), plus the hooks the worker sets once at start-up:
// planned Mealie recipes for the photo analysis (lib/analysis/planned.ts) and the push
// notification queued when an analysis finishes (lib/analysis/events.ts).
import { setAnalysisFinishedListener } from "@/lib/analysis/events";
import { analyzeMealHandler } from "@/lib/analysis/handler";
import { setPlannedRecipesSource } from "@/lib/analysis/planned";
import { ANALYZE_MEAL_JOB } from "@/lib/contracts/analysis";
import { READ_MEDICINE_LABEL_JOB } from "@/lib/contracts/medicines";
import { plannedRecipesForAnalysis } from "@/lib/integrations/mealie/service";
import { readMedicineLabelHandler } from "@/lib/medicines/label";
import { onAnalysisFinished, PUSH_JOB, sendPushHandler } from "@/lib/push/service";
import type { HandlerRegistry } from "@/lib/queue/worker";

export const jobHandlers: HandlerRegistry = {
  [ANALYZE_MEAL_JOB]: analyzeMealHandler,
  [READ_MEDICINE_LABEL_JOB]: readMedicineLabelHandler,
  [PUSH_JOB]: sendPushHandler,
};

/** Connects the analysis to Mealie and to notifications. Call once when the worker starts. */
export const installWorkerHooks = () => {
  setPlannedRecipesSource((userId, localDate) => plannedRecipesForAnalysis(userId, localDate));
  setAnalysisFinishedListener((event) => onAnalysisFinished(event));
};

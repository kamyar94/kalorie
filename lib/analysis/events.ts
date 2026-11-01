// The end of an analysis run, for whoever wants to know (Web Push registers a listener once at
// worker start-up in worker/handlers.ts). A failing listener never fails the
// job.
import type { AnalysisFinishedEvent, AnalysisFinishedListener } from "@/lib/contracts/analysis";

let listener: AnalysisFinishedListener | null = null;

/** Sets the one listener; null removes it. */
export const setAnalysisFinishedListener = (next: AnalysisFinishedListener | null) => {
  listener = next;
};

export const emitAnalysisFinished = async (
  event: AnalysisFinishedEvent,
  log: (message: string) => void = () => undefined,
) => {
  if (!listener) return;
  try {
    await listener(event);
  } catch (error) {
    log(`analysis listener failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

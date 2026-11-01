// Dictation through the browser's own speech recognition (Chrome, Edge, Safari including iOS).
// Nothing is sent to Cal's server as audio; the browser turns speech into text. Where the API is
// missing, the note button only offers typing. Browser only.

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type RecognitionConstructor = new () => Recognition;

const constructor = (): RecognitionConstructor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const speechSupported = () => constructor() !== null;

export type Dictation = { stop: () => void; abort: () => void };

/**
 * Starts listening. onText gets the whole text heard so far (final parts plus the current guess);
 * onEnd runs once with the final text. Returns null when dictation is not available.
 */
export const startDictation = (handlers: {
  lang?: string;
  onText: (text: string) => void;
  onEnd: (finalText: string) => void;
  onError?: (reason: "denied" | "no-speech" | "other") => void;
}): Dictation | null => {
  const Ctor = constructor();
  if (!Ctor) return null;
  let finalText = "";
  let ended = false;
  const recognition = new Ctor();
  recognition.lang = handlers.lang ?? (navigator.language || "en-US");
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]!;
      if (result.isFinal) finalText = `${finalText} ${result[0].transcript}`.trim();
      else interim += result[0].transcript;
    }
    handlers.onText(`${finalText} ${interim}`.trim());
  };
  recognition.onerror = (event) => {
    handlers.onError?.(
      event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "denied"
        : event.error === "no-speech"
          ? "no-speech"
          : "other",
    );
  };
  recognition.onend = () => {
    if (ended) return;
    ended = true;
    handlers.onEnd(finalText);
  };
  try {
    recognition.start();
  } catch {
    return null;
  }
  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        // Already stopped.
      }
    },
    abort: () => {
      ended = true;
      try {
        recognition.abort();
      } catch {
        // Already stopped.
      }
    },
  };
};

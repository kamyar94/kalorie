"use client";

import { Check, HelpCircle } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ANALYSIS_INPUT_LIMITS } from "@/lib/contracts/analysis";
import type { MealQuestionDto } from "@/lib/contracts/meals";

/** The answer field grows with the text from one line up to this many, then scrolls. */
export const ANSWER_MAX_LINES = 5;

/**
 * The analysis's open questions as answer chips (two to four suggested answers each), and a field
 * for an answer in the person's own words. Answered questions show the answer given.
 */
export const Questions = ({
  questions,
  disabled,
  onAnswer,
}: {
  questions: MealQuestionDto[];
  disabled?: boolean;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
}) => {
  if (!questions.length) return null;
  return (
    <section
      aria-labelledby="questions-heading"
      className="bg-warning-soft text-on-warning-soft rounded-[var(--radius-card)] p-4"
    >
      <h2 id="questions-heading" className="text-headline inline-flex items-center gap-2">
        <HelpCircle aria-hidden className="size-5" />
        {questions.some((q) => !q.answer) ? "Help Cal get this right" : "Your answers"}
      </h2>
      <div className="mt-3 flex flex-col gap-4">
        {questions.map((question) => (
          <Question
            key={question.id}
            question={question}
            disabled={disabled}
            onAnswer={(answer) => onAnswer(question.id, answer)}
          />
        ))}
      </div>
    </section>
  );
};

/** Sets a textarea's height to its text, between one line and ANSWER_MAX_LINES lines. */
const fitToText = (field: HTMLTextAreaElement) => {
  const style = window.getComputedStyle(field);
  const line = parseFloat(style.lineHeight) || 22;
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  // border-box: the height holds the text (scrollHeight counts the padding) and the borders.
  field.style.height = "auto";
  const content = field.scrollHeight + borders;
  const max = line * ANSWER_MAX_LINES + padding + borders;
  field.style.height = `${Math.ceil(Math.min(max, Math.max(line + padding + borders, content)))}px`;
  field.style.overflowY = content > max + 1 ? "auto" : "hidden";
};

const Question = ({
  question,
  disabled,
  onAnswer,
}: {
  question: MealQuestionDto;
  disabled?: boolean;
  onAnswer: (answer: string) => Promise<void>;
}) => {
  const [pending, setPending] = useState<string | null>(null);
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  // The field follows its text: one line when empty, up to five lines, then it scrolls.
  useLayoutEffect(() => {
    if (field.current) fitToText(field.current);
  }, [text]);

  const answer = async (value: string) => {
    if (!value.trim()) return false;
    setPending(value.trim());
    try {
      await onAnswer(value.trim());
      return true;
    } finally {
      setPending(null);
    }
  };

  const busy = disabled || pending !== null;
  return (
    <div role="group" aria-labelledby={`${id}-q`} className="flex flex-col gap-3">
      <p id={`${id}-q`} className="text-body font-medium" dir="auto">
        {question.text}
      </p>
      <div className="flex flex-wrap gap-2">
        {question.answers.map((option) => {
          const chosen = question.answer === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={chosen}
              disabled={busy}
              onClick={() => void answer(option)}
              className={cn(
                "text-label inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 transition-colors disabled:opacity-60",
                chosen
                  ? "bg-primary text-on-primary border-transparent"
                  : "bg-surface text-text hover:bg-surface-2 border-current/25",
              )}
            >
              {chosen && <Check aria-hidden className="size-4" />}
              <span dir="auto">{option}</span>
            </button>
          );
        })}
      </div>
      {question.answer && !question.answers.includes(question.answer) && (
        <p className="text-caption" dir="auto">
          Your answer: {question.answer}
        </p>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void answer(text).then((sent) => {
            if (sent) setText("");
          });
        }}
      >
        <label htmlFor={`${id}-own`} className="text-caption font-semibold">
          Or answer in your own words
        </label>
        {/* Enter starts a new line; the Answer button sends. */}
        <textarea
          ref={field}
          id={`${id}-own`}
          dir="auto"
          rows={1}
          maxLength={ANALYSIS_INPUT_LIMITS.answerChars}
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          className="bg-surface text-text block w-full min-w-0 resize-none rounded-2xl border border-current/25 px-3 py-2.5 text-base leading-[1.4] focus:outline-none focus-visible:outline-3 focus-visible:outline-[var(--focus)] disabled:opacity-60"
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            className="rounded-full px-5"
            disabled={busy || !text.trim()}
            loading={pending !== null && pending === text.trim()}
          >
            Answer
          </Button>
        </div>
      </form>
    </div>
  );
};

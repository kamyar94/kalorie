"use client";

import { Check, HelpCircle } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { MealQuestionDto } from "@/lib/contracts/meals";

/**
 * The analysis's open questions as answer chips (two to four suggested answers each), with
 * "Other" for an answer in the person's own words. Answered questions show the answer given.
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
  const [other, setOther] = useState(false);
  const [text, setText] = useState("");
  const id = useId();

  const answer = async (value: string) => {
    if (!value.trim()) return;
    setPending(value);
    try {
      await onAnswer(value.trim());
    } finally {
      setPending(null);
    }
  };

  return (
    <div role="group" aria-labelledby={`${id}-q`}>
      <p id={`${id}-q`} className="text-body font-medium" dir="auto">
        {question.text}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {question.answers.map((option) => {
          const chosen = question.answer === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={chosen}
              disabled={disabled || pending !== null}
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
        {!other && (
          <button
            type="button"
            disabled={disabled || pending !== null}
            onClick={() => setOther(true)}
            className="text-label bg-surface text-text hover:bg-surface-2 min-h-11 rounded-full border border-current/25 px-4 disabled:opacity-60"
          >
            Other…
          </button>
        )}
      </div>
      {question.answer && !question.answers.includes(question.answer) && (
        <p className="text-caption mt-2" dir="auto">
          Your answer: {question.answer}
        </p>
      )}
      {other && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void answer(text).then(() => {
              setOther(false);
              setText("");
            });
          }}
        >
          <label htmlFor={`${id}-other`} className="sr-only">
            Your answer
          </label>
          <input
            id={`${id}-other`}
            dir="auto"
            autoFocus
            maxLength={120}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="border-border bg-surface text-body text-text min-h-11 flex-1 rounded-full border px-4 focus:outline-none focus-visible:outline-3 focus-visible:outline-[var(--focus)]"
          />
          <Button type="submit" disabled={!text.trim()} loading={pending === text.trim()}>
            Answer
          </Button>
        </form>
      )}
    </div>
  );
};

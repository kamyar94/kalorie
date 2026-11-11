"use client";

import { CircleCheck, KeyRound, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import {
  deleteKeyAction,
  saveKeyAction,
  saveTaskAction,
  testKeyAction,
} from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { useToast } from "@/components/ui/toast";
import {
  AI_PROVIDER_NAMES,
  AI_PROVIDERS,
  AI_TASK_LABELS,
  AI_TASKS,
  REASONING_EFFORTS,
  type AiProvider,
  type AiTask,
} from "@/lib/ai/types";

export type KeyViewDto = { provider: AiProvider; hasKey: boolean; keyLastFour: string | null };
export type TaskSettingDto = {
  task: AiTask;
  provider: AiProvider | null;
  model: string | null;
  reasoning: string | null;
};
export type UsageRowDto = {
  provider: string;
  model: string;
  task: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
};

const KEY_HELP: Record<AiProvider, string> = {
  google: "Google AI Studio, API keys",
  openai: "OpenAI platform, API keys",
  anthropic: "Claude Console, API keys",
};

const KeyCard = ({ initial }: { initial: KeyViewDto }) => {
  const { show } = useToast();
  const [view, setView] = useState(initial);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "delete" | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  const id = useId();
  const name = AI_PROVIDER_NAMES[view.provider];

  const save = async () => {
    if (!value.trim()) return;
    setBusy("save");
    const result = await saveKeyAction(view.provider, value);
    setBusy(null);
    // The typed key leaves the page either way; only the masked view comes back.
    setValue("");
    if (!result.ok) return show({ title: "Key not saved", body: result.error, tone: "error" });
    const { retried, ...saved } = result.data;
    setView(saved);
    setTested(null);
    show({
      title: `${name} key saved`,
      body:
        retried > 0
          ? `${retried === 1 ? "1 meal that" : `${retried} meals that`} stopped without a working key will be analysed again.`
          : undefined,
      tone: "success",
    });
  };

  const test = async () => {
    setBusy("test");
    const result = await testKeyAction(view.provider);
    setBusy(null);
    if (!result.ok) {
      setTested(null);
      return show({
        title: "The key did not work",
        body: result.error,
        tone: "error",
        duration: 0,
      });
    }
    setTested(result.data.model);
  };

  const remove = async () => {
    setBusy("delete");
    const result = await deleteKeyAction(view.provider);
    setBusy(null);
    if (result.ok) {
      setView(result.data);
      setTested(null);
      show({ title: `${name} key removed`, tone: "neutral" });
    }
  };

  return (
    <li className="border-border rounded-2xl border p-3.5" data-provider={view.provider}>
      <div className="flex items-center gap-2">
        <KeyRound aria-hidden className="text-muted size-4" />
        <h4 className="text-label flex-1">{name}</h4>
        <p className="text-caption text-muted" data-testid={`key-state-${view.provider}`}>
          {view.hasKey ? (
            <span className="tabular">Saved key ••••{view.keyLastFour}</span>
          ) : (
            "No key"
          )}
        </p>
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label htmlFor={id} className="sr-only">
          {view.hasKey ? `Replace the ${name} key` : `${name} API key`}
        </label>
        <input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={view.hasKey ? "Paste a new key to replace it" : "Paste your API key"}
          className="border-border bg-surface text-body placeholder:text-muted focus:border-primary min-h-11 min-w-0 flex-1 rounded-xl border px-3 focus:outline-none focus-visible:outline-3 focus-visible:outline-[var(--focus)]"
        />
        <Button type="submit" loading={busy === "save"} disabled={!value.trim()}>
          Save
        </Button>
      </form>
      <p className="text-caption text-muted mt-1">Get one in {KEY_HELP[view.provider]}.</p>
      {view.hasKey && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="secondary" loading={busy === "test"} onClick={() => void test()}>
            Test
          </Button>
          <Button
            variant="ghost"
            className="text-danger"
            loading={busy === "delete"}
            onClick={() => void remove()}
          >
            <Trash2 aria-hidden className="size-4" /> Remove
          </Button>
          {tested && (
            <p className="text-caption text-primary inline-flex items-center gap-1" role="status">
              <CircleCheck aria-hidden className="size-4" /> Works with {tested}
            </p>
          )}
        </div>
      )}
    </li>
  );
};

const TaskRow = ({
  initial,
  suggestions,
  defaults,
}: {
  initial: TaskSettingDto;
  suggestions: Record<AiProvider, string[]>;
  defaults: Record<AiProvider, string>;
}) => {
  const { show } = useToast();
  const [provider, setProvider] = useState<string>(initial.provider ?? "");
  const [model, setModel] = useState(initial.model ?? "");
  const [reasoning, setReasoning] = useState(initial.reasoning ?? "");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const label = AI_TASK_LABELS[initial.task];
  const chosen = provider ? (provider as AiProvider) : null;

  const save = async () => {
    if (!chosen) return;
    setBusy(true);
    const result = await saveTaskAction({ task: initial.task, provider: chosen, model, reasoning });
    setBusy(false);
    if (!result.ok) return show({ title: "Not saved", body: result.error, tone: "error" });
    show({ title: `${label.name} settings saved`, tone: "success" });
  };

  return (
    <li className="flex flex-col gap-3">
      <div>
        <h4 className="text-label">{label.name}</h4>
        <p className="text-caption text-muted">{label.detail}</p>
      </div>
      <SelectField
        label="Provider"
        value={provider}
        onChange={(e) => {
          setProvider(e.target.value);
          setModel("");
        }}
        options={[
          { value: "", label: "Automatic (the first provider with a key)" },
          ...AI_PROVIDERS.map((p) => ({ value: p, label: AI_PROVIDER_NAMES[p] })),
        ]}
      />
      {chosen && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${id}-model`} className="text-label">
              Model
            </label>
            <input
              id={`${id}-model`}
              list={`${id}-models`}
              value={model}
              spellCheck={false}
              onChange={(e) => setModel(e.target.value)}
              placeholder={`Default: ${defaults[chosen]}`}
              className="border-border bg-surface text-body placeholder:text-muted focus:border-primary min-h-12 w-full min-w-0 rounded-[var(--radius-control)] border px-3.5 focus:outline-none focus-visible:outline-3 focus-visible:outline-[var(--focus)]"
            />
            <datalist id={`${id}-models`}>
              {suggestions[chosen].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <SelectField
            label="Thinking"
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            options={[
              { value: "", label: "Default" },
              ...REASONING_EFFORTS.map((r) => ({
                value: r,
                label: r[0]!.toUpperCase() + r.slice(1),
              })),
            ]}
          />
        </div>
      )}
      {chosen && (
        <Button
          variant="secondary"
          loading={busy}
          onClick={() => void save()}
          className="self-start"
        >
          Save {label.name.toLowerCase()} settings
        </Button>
      )}
    </li>
  );
};

/**
 * AI settings: a key per provider (saved keys are only ever shown masked), the provider, model
 * and thinking effort per task, a key test, and the tokens used in the last 30 days.
 */
export const AiSection = ({
  keys,
  tasks,
  usage,
  suggestions,
  defaults,
}: {
  keys: KeyViewDto[];
  tasks: TaskSettingDto[];
  usage: UsageRowDto[];
  suggestions: Record<AiProvider, string[]>;
  defaults: Record<AiProvider, Record<AiTask, string>>;
}) => (
  <Card
    as="section"
    id="ai"
    aria-labelledby="ai-heading"
    className="flex scroll-mt-4 flex-col gap-4"
  >
    <div>
      <h2 id="ai-heading" className="text-headline">
        AI
      </h2>
      <p className="text-caption text-muted">
        Kal uses your own key with the provider you choose. Photos go only to that provider, only
        for the analysis.
      </p>
    </div>
    <div>
      <h3 className="text-label mb-2">API keys</h3>
      <ul className="flex flex-col gap-2">
        {keys.map((key) => (
          <KeyCard key={key.provider} initial={key} />
        ))}
      </ul>
    </div>
    <div className="border-border border-t pt-4">
      <h3 className="sr-only">Provider and model per task</h3>
      <ul className="flex flex-col gap-5">
        {AI_TASKS.map((task) => (
          <TaskRow
            key={task}
            initial={
              tasks.find((t) => t.task === task) ?? {
                task,
                provider: null,
                model: null,
                reasoning: null,
              }
            }
            suggestions={suggestions}
            defaults={
              Object.fromEntries(AI_PROVIDERS.map((p) => [p, defaults[p][task]])) as Record<
                AiProvider,
                string
              >
            }
          />
        ))}
      </ul>
    </div>
    <div className="border-border border-t pt-4">
      <h3 className="text-label mb-1">Usage, last 30 days</h3>
      {usage.length ? (
        <table className="text-caption w-full border-collapse" data-testid="usage">
          <caption className="sr-only">AI usage in the last 30 days</caption>
          <thead>
            <tr className="text-muted">
              <th scope="col" className="py-1 text-left font-medium">
                Model
              </th>
              <th scope="col" className="py-1 text-left font-medium">
                Task
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Requests
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Tokens in / out
              </th>
            </tr>
          </thead>
          <tbody>
            {usage.map((row) => (
              <tr
                key={`${row.provider}-${row.model}-${row.task}`}
                className="border-border border-t"
              >
                <th scope="row" className="py-1.5 text-left font-normal">
                  {row.model}
                </th>
                <td className="py-1.5">{row.task}</td>
                <td className="tabular py-1.5 text-right">
                  {row.requests.toLocaleString("en-US")}
                </td>
                <td className="tabular py-1.5 text-right">
                  {row.inputTokens.toLocaleString("en-US")} /{" "}
                  {row.outputTokens.toLocaleString("en-US")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-caption text-muted">No AI requests yet.</p>
      )}
    </div>
  </Card>
);

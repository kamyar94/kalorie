"use client";

import { CalendarDays, Dumbbell, Link2, Unlink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import type { IntegrationStatusDto } from "@/lib/contracts/integrations";

const INFO = {
  mealie: {
    name: "Mealie",
    icon: CalendarDays,
    text: "Planned meals on the Today screen, one-tap logging, recipe nutrition and meal plan suggestions.",
  },
  opengym: {
    name: "openGym",
    icon: Dumbbell,
    text: "Body weight for your targets and trends, and workouts with an energy estimate. Kal only reads from openGym.",
  },
} as const;

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

const StatusLine = ({ status }: { status: IntegrationStatusDto }) => {
  if (!status.available)
    return (
      <p className="text-caption text-muted" data-testid={`${status.kind}-status`}>
        Not set up on this server. An admin sets its address in the server configuration.
      </p>
    );
  if (!status.connected)
    return (
      <p className="text-caption text-muted" data-testid={`${status.kind}-status`}>
        Not connected
      </p>
    );
  return (
    <p
      className={
        status.status === "error"
          ? "text-caption text-danger inline-flex items-start gap-1"
          : "text-caption inline-flex items-start gap-1"
      }
      data-testid={`${status.kind}-status`}
      role={status.status === "error" ? "alert" : undefined}
    >
      <Link2 aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      {status.status === "error"
        ? (status.message ?? "Connected, but the last check failed.")
        : `Connected${status.lastSyncAt ? `, last checked ${when(status.lastSyncAt)}` : ""}`}
    </p>
  );
};

const Item = ({ status, children }: { status: IntegrationStatusDto; children?: ReactNode }) => {
  const info = INFO[status.kind];
  const Icon = info.icon;
  return (
    <li
      className="border-border flex flex-col gap-3 rounded-2xl border p-3.5"
      data-integration={status.kind}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="bg-surface-2 grid size-10 shrink-0 place-items-center rounded-full"
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-label">{info.name}</h3>
          <p className="text-caption text-muted">{info.text}</p>
          <StatusLine status={status} />
        </div>
      </div>
      {children}
    </li>
  );
};

/** Runs an action with a busy flag, a toast for failures and a refresh after success. */
const useAction = () => {
  const router = useRouter();
  const { show } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (name: string, action: () => Promise<unknown>, success: string) => {
    setBusy(name);
    try {
      await action();
      show({ title: success, tone: "success" });
      router.refresh();
      return true;
    } catch (error) {
      show({ title: "That did not work", body: (error as Error).message, tone: "error" });
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
};

const MealieControls = ({ status }: { status: IntegrationStatusDto }) => {
  const { busy, run } = useAction();
  const [token, setToken] = useState("");
  if (!status.available) return null;
  if (!status.connected) {
    const connect = async (event: FormEvent) => {
      event.preventDefault();
      if (await run("connect", () => api.connectMealie(token.trim()), "Mealie connected"))
        setToken("");
    };
    return (
      <form onSubmit={(e) => void connect(e)} className="flex flex-col gap-3">
        <Field
          label="Mealie API token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          hint="In Mealie, open your profile, then API Tokens, and create one for Kal. Kal keeps it encrypted."
        />
        <Button type="submit" loading={busy === "connect"} disabled={token.trim().length < 10}>
          Test and connect
        </Button>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="secondary">
        <Link href="/plan">
          <CalendarDays aria-hidden className="size-4" /> Plan meals
        </Link>
      </Button>
      <Button
        variant="secondary"
        loading={busy === "test"}
        onClick={() => void run("test", api.testMealie, "Mealie answers and accepts the token")}
      >
        Test connection
      </Button>
      <Button
        variant="ghost"
        loading={busy === "disconnect"}
        onClick={() => void run("disconnect", api.disconnectMealie, "Mealie disconnected")}
      >
        <Unlink aria-hidden className="size-4" /> Disconnect
      </Button>
    </div>
  );
};

const OpenGymControls = ({ status }: { status: IntegrationStatusDto }) => {
  const { busy, run } = useAction();
  const [code, setCode] = useState("");
  if (!status.available) return null;
  if (!status.connected) {
    const pair = async (event: FormEvent) => {
      event.preventDefault();
      if (await run("pair", () => api.pairOpenGym(code.trim()), "openGym paired")) setCode("");
    };
    return (
      <form onSubmit={(e) => void pair(e)} className="flex flex-col gap-3">
        <ol className="text-caption text-muted list-decimal pl-5">
          <li>In openGym, open Settings and choose to pair the mobile app.</li>
          <li>Paste the 8-character code here within 5 minutes.</li>
        </ol>
        <Field
          label="Pairing code"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button type="submit" loading={busy === "pair"} disabled={code.trim().length < 8}>
          Pair openGym
        </Button>
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {status.latestWeight && (
        <p className="text-caption" data-testid="opengym-weight">
          Latest weigh-in {status.latestWeight.kg} kg on {status.latestWeight.date}. Your targets
          use it.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          loading={busy === "sync"}
          onClick={() => void run("sync", api.syncOpenGym, "openGym data read")}
        >
          Read now
        </Button>
        <Button
          variant="ghost"
          loading={busy === "disconnect"}
          onClick={() => void run("disconnect", api.disconnectOpenGym, "openGym disconnected")}
        >
          <Unlink aria-hidden className="size-4" /> Disconnect
        </Button>
      </div>
    </div>
  );
};

/** Mealie and openGym (docs/DESIGN.md section 8): connect, test, read, disconnect. */
export const IntegrationsSection = ({ statuses }: { statuses: IntegrationStatusDto[] }) => (
  <Card
    as="section"
    id="integrations"
    aria-labelledby="integrations-heading"
    className="flex flex-col gap-3"
  >
    <h2 id="integrations-heading" className="text-headline">
      Connected apps
    </h2>
    <ul className="flex flex-col gap-2">
      {statuses.map((status) => (
        <Item key={status.kind} status={status}>
          {status.kind === "mealie" ? (
            <MealieControls status={status} />
          ) : (
            <OpenGymControls status={status} />
          )}
        </Item>
      ))}
    </ul>
  </Card>
);

"use client";

import { Ban, Copy, KeyRound, LockOpen, Send, ShieldCheck, UserCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createInviteAction,
  resetCodeAction,
  revokeInviteAction,
  setDisabledAction,
  unlockAction,
} from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { useToast } from "@/components/ui/toast";

export type InviteRow = {
  id: number;
  note: string;
  role: string;
  createdAt: string;
  expiresAt: string;
};
export type UserRow = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  disabled: boolean;
  locked: boolean;
  createdAt: string;
  activeSessions: number;
  meals: number;
};
export type UsageRow = {
  userId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
};

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** A link shown once, with a copy button. */
const OneTimeLink = ({
  title,
  link,
  expiresAt,
  onDone,
}: {
  title: string;
  link: string;
  expiresAt: string;
  onDone: () => void;
}) => {
  const { show } = useToast();
  return (
    <div
      role="status"
      className="bg-primary-soft text-on-primary-soft flex flex-col gap-2 rounded-2xl p-3.5"
      data-testid="one-time-link"
    >
      <p className="text-label">{title}</p>
      <p className="text-caption">
        Send this link to the person. It is shown only now and works until {dateText(expiresAt)}.
      </p>
      <input
        readOnly
        aria-label="Link"
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        className="bg-surface text-text text-caption tabular min-h-11 w-full rounded-xl px-3 font-mono"
      />
      <div className="flex gap-2">
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              show({ title: "Link copied", tone: "success" });
            } catch {
              show({ title: "Copy the link from the field above", tone: "neutral" });
            }
          }}
        >
          <Copy aria-hidden className="size-4" /> Copy link
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
};

/** The admin page: invites, accounts and usage totals. No meals, photos or keys of anyone. */
export const AdminView = ({
  invites,
  users,
  usage,
  selfId,
}: {
  invites: InviteRow[];
  users: UserRow[];
  usage: UsageRow[];
  selfId: string;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const [role, setRole] = useState("member");
  const [note, setNote] = useState("");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ title: string; link: string; expiresAt: string } | null>(null);

  const origin = () => window.location.origin;

  const run = async <T,>(
    key: string,
    action: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>,
  ) => {
    setBusy(key);
    try {
      const result = await action();
      if (!result.ok) {
        show({ title: "Not done", body: result.error, tone: "error" });
        return null;
      }
      router.refresh();
      return result.data;
    } finally {
      setBusy(null);
    }
  };

  const usageByUser = new Map(usage.map((u) => [u.userId, u]));
  const totalRequests = usage.reduce((s, u) => s + u.requests, 0);

  return (
    <>
      <h1 className="text-title inline-flex items-center gap-2">
        <ShieldCheck aria-hidden className="text-primary size-7" /> Admin
      </h1>
      <p className="text-caption text-muted mt-1">
        Invites, accounts and usage totals. Nobody&apos;s meals or photos are shown here.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
        <Card as="section" aria-labelledby="invites-heading" className="flex flex-col gap-4">
          <h2 id="invites-heading" className="text-headline">
            Invites
          </h2>
          {link ? (
            <OneTimeLink {...link} onDone={() => setLink(null)} />
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={async (event) => {
                event.preventDefault();
                const data = await run("invite", () =>
                  createInviteAction({ role, note, days: Number(days) }),
                );
                if (data) {
                  setNote("");
                  setLink({
                    title: "Invite created",
                    link: `${origin()}/invite?code=${encodeURIComponent(data.code)}`,
                    expiresAt: data.expiresAt,
                  });
                }
              }}
            >
              <Field
                label="Who is it for? (only you see this)"
                maxLength={80}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  label="Role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  options={[
                    { value: "member", label: "Member" },
                    { value: "admin", label: "Admin" },
                  ]}
                />
                <SelectField
                  label="Valid for"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  options={["1", "2", "3", "7"].map((d) => ({
                    value: d,
                    label: d === "1" ? "1 day" : `${d} days`,
                  }))}
                />
              </div>
              <Button type="submit" loading={busy === "invite"} className="self-start">
                <Send aria-hidden className="size-4" /> Create invite
              </Button>
            </form>
          )}
          <div>
            <h3 className="text-label mb-1">Open invites</h3>
            {invites.length ? (
              <ul className="flex flex-col" data-testid="open-invites">
                {invites.map((invite) => (
                  <li
                    key={invite.id}
                    className="border-border flex min-h-14 items-center gap-3 border-b last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-body truncate" dir="auto">
                        {invite.note || "No note"}
                      </p>
                      <p className="text-caption text-muted">
                        {invite.role === "admin" ? "Admin" : "Member"} · until{" "}
                        {dateText(invite.expiresAt)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      className="text-danger"
                      loading={busy === `revoke-${invite.id}`}
                      onClick={() =>
                        void run(`revoke-${invite.id}`, () => revokeInviteAction(invite.id))
                      }
                      aria-label={`Revoke the invite${invite.note ? ` for ${invite.note}` : ""}`}
                    >
                      <X aria-hidden className="size-4" /> Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-caption text-muted">No open invites.</p>
            )}
          </div>
        </Card>

        <Card as="section" aria-labelledby="users-heading" className="flex flex-col gap-3">
          <h2 id="users-heading" className="text-headline">
            Accounts
          </h2>
          <ul className="flex flex-col" data-testid="users">
            {users.map((user) => {
              const used = usageByUser.get(user.id);
              return (
                <li
                  key={user.id}
                  className="border-border flex flex-col gap-2 border-b py-3 last:border-b-0"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-medium" dir="auto">
                        {user.displayName}{" "}
                        <span className="text-caption text-muted font-normal">
                          @{user.username}
                        </span>
                      </p>
                      <p className="text-caption text-muted">
                        {user.role === "admin" ? "Admin" : "Member"} · since{" "}
                        {dateText(user.createdAt)} · {user.meals} meals · {used?.requests ?? 0} AI
                        requests
                      </p>
                    </div>
                    {(user.disabled || user.locked) && (
                      <span className="bg-danger-soft text-on-danger-soft text-caption shrink-0 rounded-full px-2 py-0.5">
                        {user.disabled ? "Blocked" : "Locked"}
                      </span>
                    )}
                  </div>
                  {user.id !== selfId && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        loading={busy === `disable-${user.id}`}
                        onClick={() =>
                          void run(`disable-${user.id}`, () =>
                            setDisabledAction(user.id, !user.disabled),
                          )
                        }
                      >
                        {user.disabled ? (
                          <>
                            <UserCheck aria-hidden className="size-4" /> Allow
                          </>
                        ) : (
                          <>
                            <Ban aria-hidden className="size-4" /> Block
                          </>
                        )}
                      </Button>
                      <Button
                        variant="secondary"
                        loading={busy === `reset-${user.id}`}
                        onClick={async () => {
                          const data = await run(`reset-${user.id}`, () =>
                            resetCodeAction(user.id),
                          );
                          if (data)
                            setLink({
                              title: `Password reset for ${user.displayName}`,
                              link: `${origin()}/reset?code=${encodeURIComponent(data.code)}`,
                              expiresAt: data.expiresAt,
                            });
                        }}
                      >
                        <KeyRound aria-hidden className="size-4" /> Reset code
                      </Button>
                      {user.locked && (
                        <Button
                          variant="secondary"
                          loading={busy === `unlock-${user.id}`}
                          onClick={() => void run(`unlock-${user.id}`, () => unlockAction(user.id))}
                        >
                          <LockOpen aria-hidden className="size-4" /> Unlock
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card as="section" aria-labelledby="usage-heading" className="md:col-span-2">
          <h2 id="usage-heading" className="text-headline">
            AI usage, last 30 days
          </h2>
          <p className="text-caption text-muted mb-2">
            {totalRequests.toLocaleString("en-US")} requests in all. Each person pays for their own
            key.
          </p>
          <table className="text-caption w-full border-collapse" data-testid="usage-totals">
            <caption className="sr-only">AI requests and tokens per account</caption>
            <thead>
              <tr className="text-muted">
                <th scope="col" className="py-1 text-left font-medium">
                  Account
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Requests
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Tokens in
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Tokens out
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const used = usageByUser.get(user.id);
                return (
                  <tr key={user.id} className="border-border border-t">
                    <th scope="row" className="py-1.5 text-left font-normal">
                      @{user.username}
                    </th>
                    <td className="tabular py-1.5 text-right">
                      {(used?.requests ?? 0).toLocaleString("en-US")}
                    </td>
                    <td className="tabular py-1.5 text-right">
                      {(used?.inputTokens ?? 0).toLocaleString("en-US")}
                    </td>
                    <td className="tabular py-1.5 text-right">
                      {(used?.outputTokens ?? 0).toLocaleString("en-US")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
};

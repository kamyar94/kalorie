"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";

import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import type { WaterEntryDto, WaterPatch } from "@/lib/contracts/water";
import { sortWaterEntries, waterEntriesOf, waterMealOf } from "@/lib/meals/water";
import { deviceTimeZone } from "@/lib/photos/client";
import { fromLocalInputValue } from "@/lib/ui/format";
import { EARLIER_DAY_TIME, oneTapTime } from "@/lib/ui/log-time";
import { whenSpoken } from "@/lib/ui/when";

import { WaterSheet } from "./water-sheet";

type WaterDay = {
  /** The day's water entries, oldest first, with the changes made here already in. */
  entries: WaterEntryDto[];
  date: string;
  today: string;
  /** The amount of a quick button being logged. */
  busy: number | null;
  /** Logs water at once: now on today's screen, else at 12:00 of the day shown. */
  logNow: (ml: number) => Promise<void>;
  /** The water sheet: an entry to change, or null for new water ("+ Other amount"). */
  openSheet: (entry: WaterEntryDto | null) => void;
};

const WaterDayContext = createContext<WaterDay | null>(null);

/** The day's water on the Today screen, for the Water card and the timeline (null elsewhere). */
export const useWaterDay = () => useContext(WaterDayContext);

/** "250 ml of water". */
const amount = (ml: number) => `${ml.toLocaleString("en-US")} ml of water`;

/**
 * The water of the day on the Today screen (board 29): the entries the Water card lists and its
 * total, the water sheet (opened from the card and from a water-only card of the timeline), and
 * logging, changing and removing water. A change shows at once (the entries here), then the page
 * refreshes from the server and its entries take over again.
 */
export const WaterDayProvider = ({
  entries: fromServer,
  date,
  today,
  children,
}: {
  entries: WaterEntryDto[];
  date: string;
  today: string;
  children: ReactNode;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const [entries, setEntries] = useState(fromServer);
  const [synced, setSynced] = useState(fromServer);
  if (fromServer !== synced) {
    setSynced(fromServer);
    setEntries(fromServer);
  }
  const [busy, setBusy] = useState<number | null>(null);
  const [sheet, setSheet] = useState<{ entry: WaterEntryDto | null; start: Date | null }>({
    entry: null,
    start: null,
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  // The control that opened the sheet; when it is gone after a change, focus goes to the card.
  const opener = useRef<HTMLElement | null>(null);

  /** Puts entries in (those of this day) and takes a meal's out, at once. */
  const change = (added: WaterEntryDto[], removedMealId?: string) =>
    setEntries((list) =>
      sortWaterEntries([
        ...list.filter(
          (e) => e.mealId !== removedMealId && !added.some((a) => a.mealId === e.mealId),
        ),
        ...added.filter((e) => e.localDate === date),
      ]),
    );

  const failed = (title: string, error: unknown) =>
    show({ title, body: error instanceof Error ? error.message : undefined, tone: "error" });

  /** A meal of plain water, as the card's buttons always made it. */
  const createWater = async (ml: number, eatenAt: string, tz: string) => {
    const meal = await api.createManualMeal({
      eatenAt,
      tz,
      title: "Water",
      items: [{ name: "Water", kind: "drink", ml, grams: ml, nutrients: { energy: 0, water: ml } }],
    });
    change(waterEntriesOf(waterMealOf(meal)));
    router.refresh();
    return meal;
  };

  const removeMeal = (mealId: string) =>
    api.deleteMeal(mealId).then(() => {
      change([], mealId);
      router.refresh();
    });

  const logged = (ml: number, mealId: string) =>
    show({
      title: `${amount(ml)} logged`,
      tone: "success",
      action: {
        label: "Undo",
        onClick: () => void removeMeal(mealId).catch((error) => failed("Not undone", error)),
      },
    });

  const logNow = async (ml: number) => {
    const tz = deviceTimeZone();
    setBusy(ml);
    try {
      const meal = await createWater(ml, oneTapTime(date, today, tz), tz);
      logged(ml, meal.id);
    } catch (error) {
      failed("Water not logged", error);
    } finally {
      setBusy(null);
    }
  };

  const openSheet = (entry: WaterEntryDto | null) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const tz = deviceTimeZone();
    // New water on an earlier day starts at 12:00 of that day, like the quick buttons.
    const noon = fromLocalInputValue(`${date}T${EARLIER_DAY_TIME}`, tz);
    setSheet({ entry, start: date === today || !noon ? null : new Date(noon) });
    setSheetOpen(true);
  };

  const save = async (ml: number, at: Date | null) => {
    const { entry } = sheet;
    if (!entry) {
      const tz = deviceTimeZone();
      const meal = await createWater(ml, (at ?? new Date()).toISOString(), tz);
      logged(ml, meal.id);
      return;
    }
    const patch: WaterPatch = {};
    // "Now" in the When sheet is the moment Save is pressed.
    const eatenAt = at ?? new Date();
    if (eatenAt.getTime() !== Date.parse(entry.eatenAt)) {
      patch.eatenAt = eatenAt.toISOString();
      patch.tz = entry.tz;
    }
    if (ml !== entry.waterMl) patch.ml = ml;
    if (patch.ml === undefined && patch.eatenAt === undefined) return;
    const saved = await api.updateWater(entry.mealId, patch);
    // Moved to another day: it leaves this day's list.
    change([saved]);
    router.refresh();
    show({
      title: "Water changed",
      body:
        saved.localDate === date
          ? `${amount(saved.waterMl)} at ${saved.localTime}`
          : `${amount(saved.waterMl)}, moved to ${whenSpoken(new Date(saved.eatenAt), new Date(), saved.tz)}`,
      tone: "success",
    });
  };

  const remove = async () => {
    const { entry } = sheet;
    if (!entry) return;
    await removeMeal(entry.mealId);
    show({
      title: `${amount(entry.waterMl)} at ${entry.localTime} removed`,
      action: {
        label: "Undo",
        onClick: () =>
          void createWater(entry.waterMl, entry.eatenAt, entry.tz).catch((error) =>
            failed("Not undone", error),
          ),
      },
    });
  };

  return (
    <WaterDayContext.Provider value={{ entries, date, today, busy, logNow, openSheet }}>
      {children}
      <WaterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        entry={sheet.entry}
        start={sheet.start}
        timeZone={sheet.entry?.tz ?? deviceTimeZone()}
        onSave={save}
        onRemove={remove}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) return;
          // The row it came from is gone (removed, or moved to another day): the card instead.
          const other = document.getElementById("water-other");
          if (!other) return;
          event.preventDefault();
          other.focus();
        }}
      />
    </WaterDayContext.Provider>
  );
};

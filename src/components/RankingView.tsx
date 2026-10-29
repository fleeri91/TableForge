import { ArrowLeft } from "lucide-react";
import { CELL_COLORS } from "../config/cellColors";
import { POINTS, rankRaces } from "../lib/ranking";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ── Ranking view ───────────────────────────────────────────────────────────
// One card per race, listing its horses from most to fewest points. Opened
// from the toolbar; it replaces the table until "Tillbaka" is clicked.

const COLOR_LABELS = new Map(CELL_COLORS.map((c) => [c.value, c.label]));

export function RankingView({
  snapshot,
  accentColor,
  onBack,
}: {
  snapshot: Record<string, unknown> | null;
  accentColor: string;
  onBack: () => void;
}) {
  const races = rankRaces(snapshot);

  return (
    <div
      className="w-full max-w-6xl flex flex-col gap-4 animate-in fade-in duration-300"
      style={{ "--tf-accent": accentColor } as React.CSSProperties}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={onBack} className="print:hidden">
          <ArrowLeft />
          Tillbaka till tabellen
        </Button>
        <p className="text-xs text-muted-foreground">
          Emoji {POINTS.perEmoji} p · Toppval {POINTS.topPick} p · Färg{" "}
          {CELL_COLORS.map(
            (c) => `${c.label} ${POINTS.color[c.value] ?? 0}`,
          ).join(" / ")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {races.map((race) => (
          <section
            key={race.id}
            aria-label={race.name}
            className="break-inside-avoid rounded-xl border border-border border-t-[3px] border-t-(--tf-accent) bg-card shadow-sm"
          >
            <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <h2 className="font-display text-sm font-bold tracking-tight text-foreground">
                {race.name}
              </h2>
              <div className="flex gap-1">
                <Badge variant="secondary" title="Distans">
                  {race.distance}
                </Badge>
                <Badge variant="secondary" title="Startmetod">
                  {race.startMethod}
                </Badge>
              </div>
            </header>

            {race.horses.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">
                Alla hästar är strukna.
              </p>
            ) : (
              <ol className="py-1">
                {race.horses.map((h) => (
                  <li
                    key={h.number}
                    className={[
                      "flex items-center gap-2.5 px-3 py-1.5 text-sm",
                      h.place === null ? "opacity-45" : "",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "w-6 shrink-0 text-right font-display font-bold tabular-nums",
                        h.place === 1
                          ? "text-(--tf-accent)"
                          : "text-muted-foreground",
                      ].join(" ")}
                      aria-label={
                        h.place === null ? "Ej rankad" : `Placering ${h.place}`
                      }
                    >
                      {h.place ?? "–"}
                    </span>
                    <span
                      className="size-3 shrink-0 rounded-full border border-border"
                      style={{ backgroundColor: h.color ?? "transparent" }}
                      title={
                        h.color
                          ? (COLOR_LABELS.get(h.color) ?? "Färg")
                          : "Ingen färg"
                      }
                    />
                    <span className="w-12 shrink-0 font-medium tabular-nums text-foreground">
                      Nr {h.number}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-wrap gap-1 text-base leading-none">
                      {h.emojis.map((e) => (
                        <span
                          key={e}
                          data-top-pick={h.topPicks.includes(e) || undefined}
                        >
                          {e}
                        </span>
                      ))}
                    </span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                      {h.points} p
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

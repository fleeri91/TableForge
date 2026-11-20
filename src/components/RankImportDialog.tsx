import { useMemo, useState } from "react";
import { parseRankHtml, type ImportedStart } from "../lib/rankImport";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export interface RaceImport {
  raceId: string;
  starts: ImportedStart[];
}

// One parsed race resolved against the table: which column it lands in (null
// when the card has more races than the table has columns).
interface PlannedRace {
  key: string;
  label: string;
  raceId: string | null;
  raceName: string | null;
  starts: ImportedStart[];
}

// A dialog for filling cell colors from gratistravtips.se start lists pasted
// as HTML. Pasting the whole tab-content fills every race at once (race N goes
// to column N).
// Shows a preview of the parsed colors before anything is applied.
export function RankImportDialog({
  open,
  onOpenChange,
  races,
  rowCount,
  accentVars,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  races: { id: string; name: string }[];
  // Start numbers above this have no row in the table and are skipped.
  rowCount: number;
  accentVars: React.CSSProperties;
  onImport: (imports: RaceImport[], markScratched: boolean) => void;
}) {
  const [html, setHtml] = useState("");
  const [markScratched, setMarkScratched] = useState(true);
  const parsed = useMemo(() => parseRankHtml(html), [html]);

  const planned: PlannedRace[] = parsed.map((r, i) => {
    const target = races[r.raceNumber - 1];
    return {
      key: `${r.raceNumber}-${i}`,
      label: r.label,
      raceId: target?.id ?? null,
      raceName: target?.name ?? null,
      starts: r.starts,
    };
  });

  const imports: RaceImport[] = planned.flatMap((p) => {
    const starts = p.starts.filter((s) => s.startNumber <= rowCount);
    return p.raceId && starts.length > 0 ? [{ raceId: p.raceId, starts }] : [];
  });
  const startCount = imports.reduce((n, r) => n + r.starts.length, 0);
  const skippedStarts = planned.reduce(
    (n, p) => n + (p.raceId ? p.starts.filter((s) => s.startNumber > rowCount).length : 0),
    0,
  );
  const skippedRaces = planned.filter((p) => !p.raceId).length;

  const close = (next: boolean) => {
    if (!next) setHtml("");
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="sm:max-w-md border-t-[3px] border-t-(--tf-accent)"
        style={accentVars}
      >
        <DialogHeader>
          <DialogTitle className="font-display font-bold">
            Importera färger
          </DialogTitle>
          <DialogDescription>
            Klistra in hela startlistan (tab-content) som HTML så fylls alla
            lopp på en gång. Rank A blir grön, B blå, C gul och D röd.
          </DialogDescription>
        </DialogHeader>

        <details className="group rounded-md border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-display text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Så hämtar du startlistan
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>
              Gå till{" "}
              <a
                href="https://www.gratistravtips.se/"
                target="_blank"
                rel="noreferrer"
                className="text-(--tf-accent) underline underline-offset-2"
              >
                gratistravtips.se
              </a>{" "}
              och välj spelet du vill importera färgerna från (t.ex. V85).
            </li>
            <li>
              Högerklicka på en häst i startlistan och välj{" "}
              <strong>Granska</strong> (Inspect).
            </li>
            <li>
              Leta uppåt i elementträdet tills du hittar{" "}
              <code className="font-mono text-xs">{'<div class="tab-content">'}</code>{" "}
              – den markerar alla lopp på sidan.
            </li>
            <li>
              Högerklicka på den raden och välj{" "}
              <strong>Kopiera → Kopiera element</strong> (Copy → Copy element).
            </li>
            <li>Klistra in här nedanför.</li>
          </ol>
        </details>

        <Textarea
          autoFocus
          spellCheck={false}
          placeholder={'<div class="tab-content">…</div>'}
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          className="h-32 field-sizing-fixed resize-none font-mono text-xs"
        />

        {html.trim() !== "" &&
          (parsed.length === 0 ? (
            <p className="text-sm text-destructive">
              Hittade inga hästar med rank i det inklistrade.
            </p>
          ) : (
            <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
              {planned.map((p) => (
                <div
                  key={p.key}
                  className={["flex flex-col gap-1", p.raceId ? "" : "opacity-40"].join(" ")}
                >
                  <span className="font-display text-xs font-semibold text-muted-foreground">
                    {p.label} → {p.raceName ?? "ingen kolumn"}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {p.starts.map((s) => (
                      <span
                        key={s.startNumber}
                        title={`${s.startNumber}: ${s.rank.toUpperCase()}${s.scratched ? " (struken)" : ""}`}
                        className={[
                          "flex size-7 items-center justify-center rounded-md font-display text-xs font-bold tabular-nums text-black/80",
                          s.startNumber > rowCount ? "opacity-30" : "",
                          s.scratched ? "line-through" : "",
                        ].join(" ")}
                        style={{ backgroundColor: s.color }}
                      >
                        {s.startNumber}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}

        {(skippedStarts > 0 || skippedRaces > 0) && (
          <p className="text-xs text-muted-foreground">
            {[
              skippedRaces > 0 &&
                `${skippedRaces} ${skippedRaces === 1 ? "lopp saknar" : "lopp saknar"} kolumn i tabellen`,
              skippedStarts > 0 &&
                `${skippedStarts} ${skippedStarts === 1 ? "häst saknar" : "hästar saknar"} rad i tabellen`,
            ]
              .filter(Boolean)
              .join(", ")}{" "}
            och hoppas över.
          </p>
        )}

        {parsed.some((r) => r.starts.some((s) => s.scratched)) && (
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span>Markera strukna hästar</span>
            <Switch
              checked={markScratched}
              onCheckedChange={setMarkScratched}
              className="data-checked:bg-(--tf-accent)"
            />
          </label>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Avbryt</DialogClose>
          <Button
            disabled={startCount === 0}
            onClick={() => {
              onImport(imports, markScratched);
              close(false);
            }}
          >
            Importera{" "}
            {imports.length > 1 ? `${imports.length} lopp` : startCount > 0 ? startCount : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

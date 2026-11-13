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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// A dialog for filling one race's cell colors from its start list, pasted as
// HTML from gratistravtips.se. Shows a preview of the parsed colors per start
// number before anything is applied.
export function RankImportDialog({
  open,
  onOpenChange,
  races,
  raceId,
  onRaceChange,
  rowCount,
  accentVars,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  races: { id: string; name: string }[];
  raceId: string;
  onRaceChange: (id: string) => void;
  // Start numbers above this have no row in the table and are skipped.
  rowCount: number;
  accentVars: React.CSSProperties;
  onImport: (starts: ImportedStart[], markScratched: boolean) => void;
}) {
  const [html, setHtml] = useState("");
  const [markScratched, setMarkScratched] = useState(true);
  const starts = useMemo(() => parseRankHtml(html), [html]);
  const fitting = starts.filter((s) => s.startNumber <= rowCount);
  const skipped = starts.length - fitting.length;

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
            Välj lopp och klistra in loppets tabell som HTML. Rank A blir grön,
            B blå, C gul och D röd.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <span className="font-display text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Lopp
          </span>
          <Select
            items={Object.fromEntries(races.map((r) => [r.id, r.name]))}
            value={raceId}
            onValueChange={(v) => {
              if (v) onRaceChange(v as string);
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {races.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Textarea
          autoFocus
          spellCheck={false}
          placeholder="<tbody>…</tbody>"
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          className="h-32 field-sizing-fixed resize-none font-mono text-xs"
        />

        {html.trim() !== "" &&
          (starts.length === 0 ? (
            <p className="text-sm text-destructive">
              Hittade inga hästar med rank i det inklistrade.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1">
                {starts.map((s) => (
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
              {skipped > 0 && (
                <p className="text-xs text-muted-foreground">
                  {skipped} {skipped === 1 ? "häst saknar" : "hästar saknar"}{" "}
                  rad i tabellen och hoppas över.
                </p>
              )}
            </div>
          ))}

        {starts.some((s) => s.scratched) && (
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
            disabled={fitting.length === 0}
            onClick={() => {
              onImport(fitting, markScratched);
              close(false);
            }}
          >
            Importera {fitting.length > 0 ? fitting.length : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

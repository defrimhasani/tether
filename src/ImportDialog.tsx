import { FileUp, TriangleAlert } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { designTitle, parseSpec, stringifySpec } from "./design";
import { describe, detectAndParse, type ImportResult } from "./importers";

export function ImportDialog({ initialText = "", onImport, onDesign, onClose }: { initialText?: string; onImport: (r: ImportResult) => void; onDesign?: (spec: string, name: string) => void; onClose: () => void }) {
  const [text, setText] = useState(initialText);
  const [file, setFile] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const result = useMemo(() => (text.trim() ? detectAndParse(text) : null), [text]);
  const good = result && !("error" in result) ? result : null;

  const load = async (f: File | undefined) => {
    if (!f) return;
    setFile(f.name);
    setText(await f.text());
  };

  return (
    <div className="overlay" onMouseDown={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form
        className={`import-dialog ${over ? "over" : ""}`}
        role="dialog"
        aria-label="Import requests"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (good) onImport(good); }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }}
      >
        <h2>Import</h2>
        <p className="muted">Paste a cURL command, or drop a Postman, Insomnia or OpenAPI file.</p>
        <textarea
          autoFocus spellCheck={false} value={text} aria-label="Content to import"
          placeholder={"curl https://api.example.com/users \\\n  -H 'Authorization: Bearer …'"}
          onChange={(e) => { setText(e.target.value); setFile(null); }}
        />
        <div className="import-status" role="status" aria-live="polite">
          {result === null && <span className="muted">Nothing to import yet.</span>}
          {result && "error" in result && <span className="bad"><TriangleAlert size={13} aria-hidden /> {result.error}</span>}
          {good && <span><b>{good.source}</b>: {describe(good)}{file ? ` from ${file}` : ""}.</span>}
        </div>
        {good && good.warnings.length > 0 && (
          <ul className="import-warn">
            {good.warnings.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}
            {good.warnings.length > 4 && <li>and {good.warnings.length - 4} more.</li>}
          </ul>
        )}
        <div className="import-foot">
          <input ref={picker} type="file" accept=".json,.yaml,.yml,.txt,.sh,.curl" hidden onChange={(e) => load(e.target.files?.[0])} />
          <button type="button" className="ghost small" onClick={() => picker.current?.click()}><FileUp size={13} /> Choose file…</button>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          {good && onDesign && good.source.startsWith("OpenAPI") && (
            <button type="button" className="ghost" onClick={() => { const spec = stringifySpec(parseSpec(text).doc); onDesign(spec, designTitle(spec)); }} title="Edit this spec in the API designer instead of creating requests">Open as design</button>
          )}
          <button type="submit" className="primary" disabled={!good}>Import</button>
        </div>
      </form>
    </div>
  );
}

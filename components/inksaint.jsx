"use client";

import { useState, useRef, useEffect, useMemo } from "react";

/* Persistent storage — localStorage in the deployed app (same async
   shape the studio has always used, so everything else is unchanged). */
const appStorage = {
  async get(k) {
    const v = localStorage.getItem(k);
    if (v === null) throw new Error("not found");
    return { key: k, value: v };
  },
  async set(k, v) { localStorage.setItem(k, v); return { key: k, value: v }; },
  async delete(k) { localStorage.removeItem(k); return { key: k, deleted: true }; },
};

/* ============================================================
   INKSAINT v2 — a dark fiction universe console
   Write · Series · Cast · Craft · Launch · Content settings
   ============================================================ */

const HOUSE_STYLE = `HOUSE STYLE (non-negotiable): Humanized dialogue and inner monologue written as fragments, not literary reflection. No purple prose, no overused romance phrasing ("breath she didn't know she was holding," "electricity," "shattered," etc). Grounded sensory specificity over scenic sweep. Voice-forward, contemporary, adult. All lyrics and quotes must be fully original.`;

async function callClaude(prompt, { system = "" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          system: `${system}\n\n${HOUSE_STYLE}`.trim(),
        }),
      });
      const data = await response.json();
      if (data.error) {
        const type = `${data.error.type || ""} ${data.error.message || ""}`;
        if (attempt === 0 && /overloaded|rate|busy|529|500|503/i.test(type)) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        throw new Error(data.error.message || "The engine stalled.");
      }
      return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error("The engine stalled.");
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 1200)); continue; }
    }
  }
  throw lastErr;
}

const stripFences = (t) => t.replace(/```json|```/g, "").trim();

/* Forgiving JSON: trims preamble/postamble, neutralizes raw control chars
   (legal between tokens, so a blanket replace also rescues unescaped
   newlines inside strings), and repairs truncated arrays. */
function extractJson(raw) {
  const t = stripFences(raw);
  const starts = [t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0);
  if (!starts.length) throw new Error("no json found");
  const s = Math.min(...starts);
  const open = t[s];
  const close = open === "{" ? "}" : "]";
  const e = t.lastIndexOf(close);
  let body = (e > s ? t.slice(s, e + 1) : t.slice(s)).replace(/[\u0000-\u001F]+/g, " ");
  try { return JSON.parse(body); } catch (err) {
    if (open === "[") {
      const cut = body.lastIndexOf("}");
      if (cut > 0) { try { return JSON.parse(body.slice(0, cut + 1) + "]"); } catch (e2) {} }
    }
    throw err;
  }
}
async function callClaudeJson(prompt, { system = "", tries = 2 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const raw = await callClaude(
        prompt + (i ? "\n\nREMINDER: respond with ONLY minified valid JSON on a single line. Escape any newline inside a string as \\n." : ""),
        { system: `${system} You respond with ONLY minified valid JSON on a single line — no prose, no markdown fences, and no literal line breaks inside string values (use \\n escapes).`.trim() }
      );
      return extractJson(raw);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
const asStr = (v) => (typeof v === "string" ? v : Array.isArray(v) ? v.map(asStr).join("\n") : v == null ? "" : typeof v === "object" ? Object.values(v).map(asStr).join("\n") : String(v));

/* ---------- content rules from NSFW settings ---------- */
function contentRules(nsfw, heat) {
  if (!nsfw.enabled)
    return `CONTENT RULES: Closed-door only. No explicit sexual content — build tension and cut away. Heat register: ${heat}.`;
  const never = nsfw.neverInclude.trim();
  return [
    `CONTENT RULES: This is adult fiction between adult characters. Explicit content is permitted up to the ceiling "${nsfw.ceiling}". Current book heat register: ${heat}. Do not soften below the register; do not exceed the ceiling.`,
    never && `Hard limits — never include: ${never}.`,
    nsfw.warnings.trim() && `Standing content warnings for marketing copy: ${nsfw.warnings.trim()}.`,
  ].filter(Boolean).join("\n");
}

/* ---------- shared context ---------- */
function buildContext({ profile, presets, characters, series, universe, themes, nsfw, dict, ledger, reveals, motifs, knowledge }) {
  const p = profile;
  const L = [
    series.title && `Series: ${series.title} — genre tags: ${series.genreTags || "—"}; theme tags: ${series.themeTags || "—"}; tone tags: ${series.toneTags || "—"}`,
    series.books.length && `Books in series: ${series.books.map((b, i) => `#${i + 1} ${b.title || "Untitled"} [${b.status}]${b.hook ? ` — ${b.hook}` : ""}`).join(" | ")}`,
    p.title && `Current book: ${p.title}`,
    p.genre && `Genre: ${p.genre}`,
    p.trope && `Core trope: ${p.trope}`,
    p.tone && `Tone: ${p.tone}`,
    p.pov && `POV: ${p.pov}`,
    p.chapters && `Chapter count: ${p.chapters}`,
    p.wordGoal && `Word count goal: ${p.wordGoal}`,
    p.reader && `Target reader: ${p.reader}`,
    `Format: ${p.series}`,
    p.premise && `Working premise: ${p.premise}`,
    presets.length && `Active dark-mode presets: ${presets.join(", ")}`,
    characters.length &&
      "Cast: " + characters.map((c) => `${c.name || "Unnamed"} (${c.role || "role tbd"} — goal: ${c.goal || "?"}; wound: ${c.wound || "?"}; secret: ${c.secret || "?"})`).join(" | "),
    universe.length &&
      "Universe registry: " + universe.map((u) => `${u.name} [${u.kind}]${u.books ? ` in ${u.books}` : ""}${u.tags ? ` — ${u.tags}` : ""}`).join(" | "),
    themes.length &&
      "Theme layer: " + themes.map((t) => `${t.name}${t.statement ? ` — ${t.statement}` : ""}`).join(" | "),
    ledger && ledger.length &&
      "Scene ledger: " + ledger.map((s) => `ch${s.chapter || "?"} "${s.title}"${s.location ? ` @${s.location}` : ""} [C${s.conflict || 0}/R${s.romance || 0}/T${s.threat || 0}/Rv${s.reveal || 0}]${s.cast ? ` cast: ${s.cast}` : ""}${s.purpose ? ` — ${s.purpose}` : ""}`).join(" | "),
    reveals && reveals.some((r) => r.secret.trim()) &&
      "Reveal tracker: " + reveals.filter((r) => r.secret.trim()).map((r) => `"${r.secret}" [${r.status}] planted ch${r.planted || "?"} → revealed ch${r.revealed || "?"} → payoff ch${r.payoff || "?"}`).join(" | "),
    motifs && motifs.some((m) => m.name.trim()) &&
      "Motifs: " + motifs.filter((m) => m.name.trim()).map((m) => `"${m.name}" (${m.meaning || "meaning tbd"}, ${m.freq || 0} uses, payoff: ${m.payoff || "unset"})`).join(" | "),
    knowledge && knowledge.tags.length &&
      "Knowledge tags: " + knowledge.tags.map((t) => `${t.name} [${t.cat || "Lore"}]`).join(", "),
    dict && dict.lexicon.some((l) => l.term.trim()) &&
      "House lexicon (use these exact spellings and meanings): " + dict.lexicon.filter((l) => l.term.trim()).map((l) => `${l.term}${l.meaning ? ` = ${l.meaning}` : ""}`).join(" | "),
    dict && dict.banned.some((b) => b.phrase.trim()) &&
      "PROHIBITED words & phrases — never write any of these, in any form: " + dict.banned.filter((b) => b.phrase.trim()).map((b) => `"${b.phrase}"`).join(", "),
    contentRules(nsfw, p.heat),
  ].filter(Boolean);
  return L.join("\n");
}

/* ---------- ui atoms ---------- */
function Field({ label, children, hint }) {
  return (
    <label className="ik-field">
      <span className="ik-label">{label}</span>
      {children}
      {hint && <span className="ik-hint">{hint}</span>}
    </label>
  );
}
const TextInput = (props) => <input className="ik-input" {...props} />;
const Area = (props) => <textarea className="ik-input ik-area" {...props} />;
function PickSelect({ value, onChange, labels }) {
  return (
    <select className="ik-input ik-select" value={value} onChange={onChange}>
      {labels.map((l, i) => <option key={i} value={i}>{l}</option>)}
    </select>
  );
}
function Select({ options, ...props }) {
  return (
    <select className="ik-input ik-select" {...props}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

const FLAMES = ["Sweet", "Sensual", "Steamy", "Explicit", "Dark / Explicit"];
function HeatDial({ value, onChange, flames = FLAMES }) {
  const idx = flames.indexOf(value);
  return (
    <div className="ik-heat" role="radiogroup" aria-label="Heat level">
      {flames.map((f, i) => (
        <button key={f} type="button" role="radio" aria-checked={value === f} className={"ik-flame" + (i <= idx ? " lit" : "")} onClick={() => onChange(f)} title={f}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M12 2c1 4-4 5.5-4 10a4.5 4.5 0 0 0 9 0c0-2-1-3.4-2-4.6-.3 1.2-1 2-2 2.4.6-2.6-.2-5.6-1-7.8z"
              fill={i <= idx ? "url(#fl)" : "none"} stroke={i <= idx ? "none" : "var(--faint)"} strokeWidth="1.4" />
          </svg>
        </button>
      ))}
      <svg width="0" height="0" aria-hidden="true"><defs>
        <linearGradient id="fl" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#8E2B3E" /><stop offset="1" stopColor="#C8A15B" /></linearGradient>
      </defs></svg>
      <span className="ik-heat-name">{value}</span>
    </div>
  );
}

const SealButton = ({ onClick, children, busy, disabled }) => (
  <button className="ik-seal" onClick={onClick} disabled={busy || disabled}>{busy ? "Working…" : children}</button>
);
const GhostButton = ({ onClick, children, active }) => (
  <button className={"ik-ghost" + (active ? " on" : "")} onClick={onClick}>{children}</button>
);

function Output({ title, text, busy, error, onClear }) {
  const [copied, setCopied] = useState(false);
  if (!text && !busy && !error) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch (e) {}
  };
  return (
    <div className="ik-output">
      <div className="ik-output-bar">
        <span className="ik-eyebrow">{title}</span>
        <span className="ik-output-actions">
          {text && <button className="ik-mini" onClick={copy}>{copied ? "Copied" : "Copy"}</button>}
          {(text || error) && <button className="ik-mini" onClick={onClear}>Clear</button>}
        </span>
      </div>
      {busy && <div className="ik-busy"><span className="ik-pulse" /> The ink is still wet…</div>}
      {error && <div className="ik-error">{error} — try again.</div>}
      {text && <pre className="ik-prose">{text}</pre>}
    </div>
  );
}

function useGen() {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [label, setLabel] = useState("Output");
  const run = async (title, prompt, opts) => {
    setBusy(true); setError(""); setText(""); setLabel(title);
    try { setText(await callClaude(prompt, opts)); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return { busy, text, error, label, run, clear: () => { setText(""); setError(""); } };
}

/* ---------- generic sheet editor (rows of structured records) ---------- */
function Sheet({ rows, setRows, cols, blank, addLabel, emptyLine, visible }) {
  const update = (i, k, v) => { const n = rows.slice(); n[i] = { ...n[i], [k]: v }; setRows(n); };
  return (
    <div className="ik-sheet-wrap">
      {rows.length > 0 && (
        <div className="ik-sheet" style={{ gridTemplateColumns: cols.map((c) => c.w || "1fr").join(" ") + " 28px" }}>
          {cols.map((c) => <span key={c.key} className="ik-label ik-sheet-head">{c.label}</span>)}
          <span />
          {rows.map((r, i) => (
            (visible && !visible(r)) ? null :
            <SheetRow key={i} row={r} i={i} cols={cols} update={update} remove={() => setRows(rows.filter((_, x) => x !== i))} />
          ))}
        </div>
      )}
      {!rows.length && emptyLine && <p className="ik-empty">{emptyLine}</p>}
      <div className="ik-actions"><GhostButton onClick={() => setRows([...rows, { ...blank }])}>+ {addLabel}</GhostButton></div>
    </div>
  );
}
function SheetRow({ row, i, cols, update, remove }) {
  return (
    <>
      {cols.map((c) =>
        c.type === "select" ? (
          <Select key={c.key} value={row[c.key]} options={c.options} onChange={(e) => update(i, c.key, e.target.value)} />
        ) : c.type === "area" ? (
          <Area key={c.key} rows={1} value={row[c.key]} onChange={(e) => update(i, c.key, e.target.value)} placeholder={c.ph || ""} />
        ) : (
          <TextInput key={c.key} value={row[c.key]} onChange={(e) => update(i, c.key, e.target.value)} placeholder={c.ph || ""} inputMode={c.type === "num" ? "numeric" : undefined} />
        )
      )}
      <button className="ik-x" onClick={remove} title="Remove row" aria-label="Remove row">×</button>
    </>
  );
}

function ModuleHead({ title, blurb }) {
  return (
    <header className="ik-modhead">
      <h2>{title}</h2>
      <p>{blurb}</p>
    </header>
  );
}
function SmartRow({ tools, gen, ctx, extra = "" }) {
  return (
    <div className="ik-toolgrid">
      {tools.map(([name, instruction]) => (
        <button key={name} className="ik-tool" disabled={gen.busy} onClick={() => gen.run(name, `${instruction}\n\nStory context:\n${ctx}${extra ? `\n\n${extra}` : ""}`)}>
          {name}
        </button>
      ))}
    </div>
  );
}

/* ============================================================
   WRITE — Story Builder, Chapter Studio, Plot Engine,
           Script Board, Song Grid, Publishing
   ============================================================ */
function StoryBuilder({ profile, setProfile, ctx }) {
  const gen = useGen();
  const set = (k) => (e) => setProfile({ ...profile, [k]: e.target.value });
  return (
    <section>
      <ModuleHead title="Story Builder" blurb="Set the terms of the book once. Every engine downstream reads from this page." />
      <div className="ik-grid2">
        <Field label="Story title"><TextInput value={profile.title} onChange={set("title")} placeholder="Signed in Synn" /></Field>
        <Field label="Genre"><TextInput value={profile.genre} onChange={set("genre")} placeholder="Dark romance / crime thriller" /></Field>
        <Field label="Core trope"><TextInput value={profile.trope} onChange={set("trope")} placeholder="Forbidden protection" /></Field>
        <Field label="Tone"><TextInput value={profile.tone} onChange={set("tone")} placeholder="Velvet menace, slow-bleed tension" /></Field>
        <Field label="POV"><Select value={profile.pov} onChange={set("pov")} options={["Dual first person", "Rotating multi-first", "Single first person", "Third limited", "Third — multi POV"]} /></Field>
        <Field label="Series or standalone"><Select value={profile.series} onChange={set("series")} options={["Standalone", "Series opener", "Mid-series entry", "Series finale", "Interconnected standalone"]} /></Field>
        <Field label="Chapter count"><TextInput value={profile.chapters} onChange={set("chapters")} placeholder="52" inputMode="numeric" /></Field>
        <Field label="Word count goal"><TextInput value={profile.wordGoal} onChange={set("wordGoal")} placeholder="95,000" /></Field>
      </div>
      <Field label="Target reader"><TextInput value={profile.reader} onChange={set("reader")} placeholder="Adult dark-romance readers who want morally gray, high heat, real consequences" /></Field>
      <Field label="Heat level" hint="The register for this book. The ceiling and hard limits live in Content Settings.">
        <HeatDial value={profile.heat} onChange={(h) => setProfile({ ...profile, heat: h })} />
      </Field>
      <Field label="Working premise (optional — the Plot Engine can forge one)">
        <Area rows={3} value={profile.premise} onChange={set("premise")} placeholder="One to three sentences of raw idea. Rough is fine." />
      </Field>
      <div className="ik-actions">
        <SealButton busy={gen.busy} onClick={() => gen.run("Story bible seed", `Using this story profile, write a compact story bible seed: (1) a sharpened premise paragraph, (2) the central dramatic question, (3) three pressure points that will break the protagonist, (4) what the ending must cost.\n\n${ctx}`)}>
          Forge story bible seed
        </SealButton>
      </div>
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

const STUDIO_TOOLS = [
  ["Write next chapter", "Using the pasted text as the most recent material, write the opening 500–700 words of the next chapter. Match voice and POV exactly."],
  ["Rewrite with more emotion", "Rewrite the pasted passage with deeper interiority and rawer emotion. Fragments over reflection. Do not add length for its own sake."],
  ["Add suspense", "Rewrite the pasted passage to tighten suspense: withhold, delay, shorten sentences at pressure points, end on unease."],
  ["Humanize grammar", "Rewrite the pasted passage so it reads human, not literary: contractions, fragments, interrupted thoughts, natural rhythm."],
  ["Expand scene", "Expand the pasted scene by roughly 60%: more beats, more sensory grounding, more subtext in the silences. No filler."],
  ["Make dialogue sharper", "Rewrite the dialogue in the pasted passage: cut pleasantries, sharpen subtext, give each speaker a distinct rhythm, trim tags."],
  ["Reduce exposition", "Rewrite the pasted passage converting exposition into action, dialogue, or implication. Cut what the reader can infer."],
  ["Add sensory detail", "Rewrite the pasted passage layering in grounded sensory specificity — smell, texture, temperature, sound."],
  ["Strengthen ending hook", "Rewrite only the final paragraph of the pasted passage so the chapter ends on a hook. Show 3 options."],
];
function ChapterStudio({ ctx, logWords }) {
  const [draft, setDraft] = useState("");
  const [logged, setLogged] = useState(false);
  const gen = useGen();
  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  return (
    <section>
      <ModuleHead title="Chapter Studio" blurb="Paste the page. Pick the knife." />
      <Field label="Working text"><Area rows={10} value={draft} onChange={(e) => { setDraft(e.target.value); setLogged(false); }} placeholder="Paste a scene, a chapter, or the last page you wrote…" /></Field>
      <div className="ik-wordbar">
        <span>{words.toLocaleString()} words · ~{Math.max(1, Math.round(words / 250))} min read</span>
        {words > 0 && <button className="ik-mini" onClick={() => { logWords(words); setLogged(true); }} disabled={logged}>{logged ? "Logged to Writing Goals" : "Log to Writing Goals"}</button>}
      </div>
      <div className="ik-toolgrid">
        {STUDIO_TOOLS.map(([name, instruction]) => (
          <button key={name} className="ik-tool" disabled={gen.busy || !draft.trim()} onClick={() => gen.run(name, `${instruction}\n\nStory context:\n${ctx}\n\nPASTED TEXT:\n${draft}`)}>{name}</button>
        ))}
      </div>
      {!draft.trim() && <p className="ik-empty">The studio needs pages. Paste text above to unlock the tools.</p>}
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

const PLOT_TOOLS = [
  ["Premise", "Write 3 alternate premise paragraphs for this book. Each a different angle of attack. Number them."],
  ["Logline", "Write 5 loglines. One sentence each. Protagonist, want, obstacle, stakes. No taglines, no rhetorical questions."],
  ["Three-act outline", "Write a three-act outline. Act headers, then beats as short punchy lines. Mark the midpoint reversal and the all-is-lost moment explicitly."],
  ["Chapter outline", "Write a chapter-by-chapter outline matching the chapter count in the profile (default 30 if unset). One line per chapter: POV tag, what happens, what turns. End every 5th chapter on a hook."],
  ["Scene cards", "Write 8 scene cards for the next stretch of the book. Each card: SLUG (location/time), IN (emotional state entering), TURN (what changes), OUT (state leaving), HOOK (last image or line)."],
  ["Plot twist bank", "Generate 10 plot twists ranked from grounded to nuclear. For each: the twist, the earliest chapter it could detonate, and the one clue to plant beforehand."],
  ["Cliffhanger endings", "Write 8 chapter-ending cliffhangers as the final 2–3 lines of prose that would close the chapter, in the book's voice."],
  ["Series arc", "Map a series arc across the books implied by the profile and series map. For each book: the promise, the betrayal, the price, and the thread left burning for the next."],
  ["Reader hook", "Write the first 150 words of the book — the open that makes the target reader unable to put it down. Then a one-line note on why it works."],
];
function PlotEngine({ ctx }) {
  const gen = useGen();
  return (
    <section>
      <ModuleHead title="Plot Engine" blurb="Structure on demand. Every generator reads the full profile, series map, cast, themes, and content rules." />
      <SmartRow tools={PLOT_TOOLS} gen={gen} ctx={ctx} />
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ---------- Script Board ---------- */
const SCRIPT_TOOLS = [
  ["Prose → screenplay", "Convert the pasted prose into properly formatted screenplay pages: sluglines, action lines (present tense, lean), character cues, dialogue, parentheticals only when essential."],
  ["Beat board", "Break this book (or the pasted material) into a screen beat board: teaser + 4 acts, each beat one line, marked with the emotional turn."],
  ["Cold open", "Write a 1–2 page cold open in screenplay format that drops the viewer into the world mid-tension. End on a smash cut."],
  ["Pilot outline", "Outline a pilot episode adapting this book: A/B/C plots, act breaks, button scenes, final-image hook."],
  ["Dialogue pass", "Rewrite the dialogue in the pasted screenplay pages: subtext up, exposition out, distinct rhythm per character. Keep the format."],
  ["Trailer scenes", "Write 6 short screenplay-formatted moments engineered to cut into a series trailer. Each 3–6 lines."],
]; 
function ScriptBoard({ ctx }) {
  const [draft, setDraft] = useState("");
  const gen = useGen();
  return (
    <section>
      <ModuleHead title="Script Board" blurb="The book, seen through a lens. Prose in, screenplay out." />
      <Field label="Working material (prose or script — optional for outline tools)">
        <Area rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Paste prose to adapt, or script pages to polish…" />
      </Field>
      <SmartRow tools={SCRIPT_TOOLS} gen={gen} ctx={ctx} extra={draft.trim() ? `PASTED MATERIAL:\n${draft}` : ""} />
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ---------- Song Grid ---------- */
const SONG_COLS = [
  { key: "title", label: "Track", ph: "Velvet & Vice" },
  { key: "mood", label: "Mood", ph: "Smoked-out, aching" },
  { key: "tempo", label: "Tempo", ph: "68 bpm slow grind", w: ".7fr" },
  { key: "pov", label: "POV", ph: "Lola, after ch. 12", w: ".8fr" },
  { key: "beat", label: "Story beat it scores", ph: "The first betrayal" },
  { key: "hook", label: "Hook concept", ph: "A promise repeated until it curdles" },
  { key: "scene", label: "Scene link", ph: "Ch. 12 — dressing room", w: ".7fr" },
];
const BLANK_SONG = { title: "", mood: "", tempo: "", pov: "", beat: "", hook: "", scene: "", emotions: "", themesT: "", sound: "", lyricMotifs: "", structure: "", verse: "", chorus: "", bridge: "", ctags: "" };
const SONG_DETAIL = [
  ["emotions", "Emotion tags", "ache, defiance, want"],
  ["themesT", "Theme tags", "loyalty as a weapon, bought silence"],
  ["sound", "Sound reference", "68bpm dark R&B, sparse 808s, choir pads"],
  ["lyricMotifs", "Lyric motifs", "ink, signatures, red thread"],
  ["structure", "Song structure", "V1 – PC – C – V2 – PC – C – B – C"],
  ["verse", "Verse summary", "What each verse argues"],
  ["chorus", "Chorus hook", "The line the song lives or dies on"],
  ["bridge", "Bridge turn", "Where the song changes its mind"],
  ["ctags", "Connection tags", "Lola arc / ch.12 / Testimony track 4"],
];
function SongGrid({ songs, setSongs, ctx }) {
  const gen = useGen();
  const [selRaw, setSel] = useState(0);
  const sel = Math.min(selRaw, Math.max(songs.length - 1, 0));
  const gridText = songs.map((s, i) => `Track ${i + 1}: ${s.title || "Untitled"} — mood: ${s.mood}; tempo: ${s.tempo}; POV: ${s.pov}; scores: ${s.beat}; hook concept: ${s.hook}`).join("\n");
  return (
    <section>
      <ModuleHead title="Songwriting Connectivity Grid" blurb="The album inside the book — every track wired to its scene, character, emotion, and theme. All lyrics fully original." />
      <Sheet rows={songs} setRows={setSongs} cols={SONG_COLS} blank={BLANK_SONG} addLabel="Add a track" emptyLine="No tracks yet. The record starts with one." />
      {songs.length > 0 && songs[sel] && (
        <div className="ik-card open" style={{ padding: 16, margin: "10px 0 4px" }}>
          <span className="ik-eyebrow">Connectivity — {songs[sel].title || `Track ${sel + 1}`}</span>
          <div className="ik-grid2" style={{ marginTop: 12 }}>
            {SONG_DETAIL.map(([k, label, ph]) => (
              <Field key={k} label={label}>
                <Area rows={2} value={songs[sel][k] ?? ""} onChange={(e) => { const n = songs.slice(); n[sel] = { ...n[sel], [k]: e.target.value }; setSongs(n); }} placeholder={ph} />
              </Field>
            ))}
          </div>
        </div>
      )}
      {songs.length > 0 && (
        <div className="ik-actions">
          <Field label="Work on track">
            <PickSelect value={sel} onChange={(e) => setSel(Number(e.target.value))} labels={songs.map((s, i) => s.title || `Track ${i + 1}`)} />
          </Field>
          <SealButton busy={gen.busy} onClick={() => gen.run(`Lyric draft — ${songs[sel]?.title || "Track " + (sel + 1)}`,
            `Write a fully ORIGINAL lyric draft for this track (verse 1, pre, chorus, verse 2, bridge). Match the mood, tempo, POV and story beat. Contemporary dark R&B register unless the grid says otherwise. Never imitate or quote any existing song.\n\nTrack: ${JSON.stringify(songs[sel])}\n\nFull album grid:\n${gridText}\n\nStory context:\n${ctx}`)}>
            Draft original lyric
          </SealButton>
          <GhostButton onClick={() => gen.run("Hook options", `Write 8 original hook/chorus concepts for this track — 2 lines each, no existing-song echoes.\n\nTrack: ${JSON.stringify(songs[sel])}\n\nStory context:\n${ctx}`)}>Hook options</GhostButton>
          <GhostButton onClick={() => gen.run("Album sequence", `Sequence this album for maximum emotional arc alongside the book. Give the running order, one line on why each track sits where it does, and where the act breaks fall.\n\n${gridText}\n\nStory context:\n${ctx}`)}>Build soundtrack order</GhostButton>
          <GhostButton onClick={() => gen.run("Song Sync map", `Build the Song Sync map: for each track, name the scene/chapter it belongs to (use its scene link if set, propose one if not), the character whose interiority it carries, the emotional-arc moment it scores, and for the selected track give a verse summary, chorus hook line, and bridge turn — all original.\n\nAlbum grid:\n${gridText}\n\nSelected track: ${JSON.stringify(songs[Math.min(sel, songs.length - 1)])}\n\nStory context:\n${ctx}`)}>Song Sync</GhostButton>
          <GhostButton onClick={() => gen.run("Hooks from scenes", `Generate song hooks from the scene ledger in context: pick the 6 scenes with the most musical charge and write 2 original hook/chorus concepts for each (2 lines apiece), tagged with the scene and the character POV that should sing it.\n\nStory context:\n${ctx}`)}>Hooks from scenes</GhostButton>
          <GhostButton onClick={() => gen.run("Match songs to arcs", `Match every track on this album to a character arc: which character's interior movement it scores, which arc stage (before/during/after their break), and any track that belongs to no one — plus the arc moment that still has no song.\n\nAlbum grid:\n${gridText}\n\nFull track data: ${JSON.stringify(songs)}\n\nStory context:\n${ctx}`)}>Match to character arcs</GhostButton>
          <GhostButton onClick={() => gen.run("Lyric symbol tracker", `Track the repeated lyric symbols across the album using each track's lyric motifs, hooks, verse/chorus/bridge notes: which symbols recur, which tracks carry them, which are overused, and which motif deserves to close the record. Full track data: ${JSON.stringify(songs)}\n\nStory context:\n${ctx}`)}>Track lyric symbols</GhostButton>
        </div>
      )}
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

const PUB_TOOLS = [
  ["Book description", "Write a retail book description: hook line, 2 short paragraphs, tropes list, a content-warning line built from the standing content warnings."],
  ["Amazon blurb", "Write an Amazon blurb for dark romance browsers: bolded hook, short punchy paragraphs, one-line trope stack, a dare to the reader at the end."],
  ["Back cover copy", "Write back cover copy: 120–160 words, present tense, ends on the central dramatic question."],
  ["Author bio", "Write 3 author bios (50, 100, 150 words) for a dark romance/thriller author. Confident, a little dangerous, zero clichés about coffee."],
  ["Series page copy", "Write series page copy: the world in one paragraph, then a one-line teaser per book in the series map."],
  ["TikTok caption", "Write 6 BookTok captions with hooks and hashtag sets. Each under 150 characters before tags. Reader-to-reader voice."],
  ["Trailer script", "Write a 45-second book trailer script: VO lines, on-screen text cards, music/mood cues, final title card."],
  ["Playlist", "Build a 12-track playlist concept: mood descriptor, tempo, and the story beat each slot scores. Describe sound and feeling only — do not name real songs or quote lyrics."],
  ["Character quote cards", "Write 8 original in-character quotes for shareable quote cards, attributed to cast members. Short, brutal, save-worthy."],
  ["Email launch copy", "Write a 3-email launch sequence: tease, cover/preorder reveal, release day. Subject lines + body. Voice matches the book."],
];
function Publishing({ ctx }) {
  const gen = useGen();
  return (
    <section>
      <ModuleHead title="Publishing Toolkit" blurb="The book after the book. Everything a launch needs, in the book's own voice." />
      <SmartRow tools={PUB_TOOLS} gen={gen} ctx={ctx} />
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

const PRESETS = ["Slow burn", "Enemies to lovers", "Forbidden romance", "Betrayal", "Obsession", "Second chance", "Southern gothic", "Dark R&B mood", "New Orleans suspense", "High tension dual POV"];
function DarkModes({ presets, setPresets, custom, setCustom, ctx }) {
  const gen = useGen();
  const [draft, setDraft] = useState("");
  const toggle = (p) => setPresets(presets.includes(p) ? presets.filter((x) => x !== p) : [...presets, p]);
  const addCustom = () => {
    const v = draft.trim();
    setDraft("");
    if (!v || [...PRESETS, ...custom].some((p) => p.toLowerCase() === v.toLowerCase())) return;
    setCustom([...custom, v]); setPresets([...presets, v]);
  };
  const removeCustom = (p) => { setCustom(custom.filter((x) => x !== p)); setPresets(presets.filter((x) => x !== p)); };
  return (
    <section>
      <ModuleHead title="Dark Modes" blurb="Standing atmospheres. Light the ones this book lives in — every generator obeys them." />
      <div className="ik-presets">{PRESETS.map((p) => <GhostButton key={p} active={presets.includes(p)} onClick={() => toggle(p)}>{p}</GhostButton>)}</div>
      {custom.length > 0 && (
        <>
          <span className="ik-eyebrow" style={{ display: "block", margin: "10px 0 8px" }}>Your modes</span>
          <div className="ik-presets">
            {custom.map((p) => (
              <span key={p} className="ik-custommode">
                <GhostButton active={presets.includes(p)} onClick={() => toggle(p)}>{p}</GhostButton>
                <button className="ik-x" onClick={() => removeCustom(p)} title={`Remove "${p}"`} aria-label={`Remove ${p}`}>×</button>
              </span>
            ))}
          </div>
        </>
      )}
      <div className="ik-actions" style={{ marginTop: 10 }}>
        <TextInput value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }} placeholder="Forge a custom mode — e.g. Bayou noir, Vegas neon dread…" style={{ maxWidth: 380 }} />
        <GhostButton onClick={addCustom}>+ Add mode</GhostButton>
      </div>
      <div className="ik-actions">
        <SealButton busy={gen.busy} disabled={!presets.length}
          onClick={() => gen.run("Mood bible", `Write a one-page mood bible fusing these presets into one coherent atmosphere: ${presets.join(", ")}. Cover: the emotional weather, the pacing rule, three recurring images, what the narration never does, and one line of prose demonstrating the register.\n\nStory context:\n${ctx}`)}>
          Fuse into a mood bible
        </SealButton>
      </div>
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ============================================================
   SERIES — Series Map, Book Bible, Universe Web,
            Interconnectivity Chart
   ============================================================ */
const BOOK_COLS = [
  { key: "title", label: "Book title", ph: "Signed in Synn" },
  { key: "status", label: "Status", type: "select", options: ["Concept", "Outlining", "Drafting", "Revising", "Done"], w: ".6fr" },
  { key: "hook", label: "One-line hook", ph: "What this book promises" },
];
const SERIES_SMART = [
  ["Detect repeated themes", "Analyze the series map, book list, theme layer and cast. Surface the themes that repeat across books — named plainly — and say whether each repeat reads as intentional resonance or accidental echo. Suggest one sharpening move per theme."],
  ["Flag missing links", "Audit the series map: which books lack character links, location links, motif links, or timeline anchors? List each gap as BOOK → MISSING LINK → cheapest fix."],
  ["Show unresolved arcs", "Cross-reference the book list, cast, and universe registry. List every arc, secret, or thread that opens somewhere in the series and never visibly closes. Rank by how loudly a reader would notice."],
  ["Suggest future book hooks", "Propose 5 future books for this series. For each: title concept, whose story it is, the wound it reopens, the hook line, and which existing threads it inherits."],
];
function SeriesMap({ series, setSeries, ctx }) {
  const gen = useGen();
  const set = (k) => (e) => setSeries({ ...series, [k]: e.target.value });
  return (
    <section>
      <ModuleHead title="Series Map" blurb="The whole universe at a glance. Tags, books, and the connective tissue between them." />
      <div className="ik-grid2">
        <Field label="Series title"><TextInput value={series.title} onChange={set("title")} placeholder="Sovereign Dark Universe" /></Field>
        <Field label="Genre tags"><TextInput value={series.genreTags} onChange={set("genreTags")} placeholder="dark romance, crime thriller, dark fantasy" /></Field>
        <Field label="Theme tags"><TextInput value={series.themeTags} onChange={set("themeTags")} placeholder="loyalty as a weapon, inherited sin, bought silence" /></Field>
        <Field label="Tone tags"><TextInput value={series.toneTags} onChange={set("toneTags")} placeholder="velvet menace, slow bleed, southern gothic" /></Field>
      </div>
      <Field label="Book list"><Sheet rows={series.books} setRows={(b) => setSeries({ ...series, books: b })} cols={BOOK_COLS} blank={{ title: "", status: "Concept", hook: "" }} addLabel="Add a book" emptyLine="No books mapped yet." /></Field>
      <div className="ik-grid2">
        <Field label="Character links" hint="Who crosses between books"><Area rows={2} value={series.charLinks} onChange={set("charLinks")} placeholder="Iceland Jones: cameo in Book 1 → lead in Book 4…" /></Field>
        <Field label="Location links"><Area rows={2} value={series.locLinks} onChange={set("locLinks")} placeholder="The Parish appears in Books 1, 3, 5…" /></Field>
        <Field label="Motif links"><Area rows={2} value={series.motifLinks} onChange={set("motifLinks")} placeholder="The signed contract motif; red thread; hymn fragments…" /></Field>
        <Field label="Timeline links"><Area rows={2} value={series.timeLinks} onChange={set("timeLinks")} placeholder="Book 2 runs concurrent with Book 1 ch. 20–35…" /></Field>
      </div>
      <SmartRow tools={SERIES_SMART} gen={gen} ctx={ctx} extra={`SERIES LINKS:\nCharacters: ${series.charLinks}\nLocations: ${series.locLinks}\nMotifs: ${series.motifLinks}\nTimeline: ${series.timeLinks}`} />
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ---------- Book Bible ---------- */
const BIBLE_FIELDS = [
  ["themes", "Main themes", 2], ["question", "Core question", 2], ["summary", "Book summary", 3],
  ["conflict", "Main conflict", 2], ["subplots", "Subplots", 3], ["arcs", "Character arcs", 3],
  ["locations", "Locations", 2], ["secrets", "Secrets", 3], ["reveals", "Reveals (with intended chapter)", 3],
  ["threads", "Unresolved threads", 2], ["hook", "Ending hook", 2],
];
const BLANK_BIBLE = Object.fromEntries(BIBLE_FIELDS.map(([k]) => [k, ""]));
const BIBLE_SMART = [
  ["Track reveal timing", "Audit the reveals against the chapter count. Map each reveal to its chapter, judge the spacing (clustered? starved stretches?), and propose a corrected reveal schedule."],
  ["Prevent early spoilers", "Scan the bible for information that, if shown on the page before its reveal chapter, spoils a secret. List each risk as SECRET → WHERE IT COULD LEAK → HOW TO GUARD IT."],
  ["Link secrets to payoff", "Pair every secret with its payoff. For any secret without a reveal, propose one. For any reveal without a planted secret, propose the plant and its chapter."],
  ["Character knowledge by chapter", "Build a who-knows-what table: for each secret, list which characters know it, at which chapter each learns it, and who must NEVER learn it. Flag any scene-level contradictions this implies."],
];
function BookBible({ series, bibles, setBibles, ctx }) {
  const bookTitles = series.books.map((b) => b.title || "Untitled");
  const [selBook, setSelBook] = useState(bookTitles[0] || "Standalone");
  const options = bookTitles.length ? bookTitles : ["Standalone"];
  const bible = bibles[selBook] || BLANK_BIBLE;
  const set = (k) => (e) => setBibles({ ...bibles, [selBook]: { ...bible, [k]: e.target.value } });
  const gen = useGen();
  const bibleText = BIBLE_FIELDS.map(([k, label]) => `${label}: ${bible[k] || "—"}`).join("\n");
  return (
    <section>
      <ModuleHead title="Book Bible" blurb="The master reference for each book. Secrets, reveals, and who's allowed to know what, when." />
      <Field label="Book"><Select value={selBook} onChange={(e) => setSelBook(e.target.value)} options={options} /></Field>
      <div className="ik-grid2">
        {BIBLE_FIELDS.map(([k, label, rows]) => (
          <Field key={k} label={label}><Area rows={rows} value={bible[k]} onChange={set(k)} /></Field>
        ))}
      </div>
      <SmartRow tools={BIBLE_SMART} gen={gen} ctx={ctx} extra={`BOOK BIBLE — ${selBook}:\n${bibleText}`} />
      <div className="ik-actions">
        <SealButton busy={gen.busy} onClick={() => gen.run(`Bible draft — ${selBook}`, `Draft a complete book bible for "${selBook}" covering: main themes, core question, book summary, main conflict, subplots, character arcs, locations, secrets, reveals with chapter placement, unresolved threads, and the ending hook. Build around anything the author already filled:\n${bibleText}\n\nStory context:\n${ctx}`)}>
          Draft the full bible
        </SealButton>
      </div>
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ---------- Universe Web ---------- */
const UNI_COLS = [
  { key: "name", label: "Name", ph: "Safehouse Nine" },
  { key: "kind", label: "Kind", type: "select", options: ["Location", "Organization", "Motif", "Event", "Artifact", "Family"], w: ".7fr" },
  { key: "books", label: "Appears in", ph: "Book 1, Book 3", w: ".8fr" },
  { key: "tags", label: "Tags / notes", ph: "neutral ground, no blood spilled inside" },
];
const UNI_SMART = [
  ["Consistency check", "Audit the universe registry against the series map and cast. Flag contradictions, duplicate entities under different names, and entities whose rules are never stated. Fix each in one line."],
  ["Crossover suggestions", "Suggest 6 crossover moves: an entity from one book surfacing in another in a way that rewards series readers without confusing new ones. Name the entity, the books, and the moment."],
  ["Expand the web", "Propose 8 new universe entities (locations, organizations, motifs, events) that this world is clearly missing, each with a one-line rule that makes it dangerous."],
];
function UniverseWeb({ universe, setUniverse, ctx }) {
  const gen = useGen();
  const [q, setQ] = useState("");
  const [scanText, setScanText] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [busyScan, setBusyScan] = useState(false);
  const [scanErr, setScanErr] = useState("");
  const match = (u) => !q.trim() || `${u.name} ${u.kind} ${u.books} ${u.tags}`.toLowerCase().includes(q.toLowerCase());
  const exists = (name) => universe.some((u) => u.name.trim().toLowerCase() === name.trim().toLowerCase());
  const scan = async () => {
    setBusyScan(true); setScanErr("");
    try {
      const arr = await callClaudeJson(
        `Scan this manuscript text and extract world-building entities worth registering. Respond ONLY with a JSON array of objects {"name": string, "kind": "Location"|"Organization"|"Motif"|"Event"|"Artifact"|"Family", "tags": string (one short line: what it is / its rule)}. Max 10. Only include entities that actually appear in the text. Skip characters — they belong in the vault.\n\nAlready registered (skip these): ${universe.map((u) => u.name).join(", ") || "none"}\n\nTEXT:\n${scanText}`
      );
      setSuggestions((Array.isArray(arr) ? arr : []).map((s) => ({ name: String(s.name || ""), kind: UNI_COLS[1].options.includes(s.kind) ? s.kind : "Location", tags: String(s.tags || "") })).filter((s) => s.name && !exists(s.name)));
    } catch (e) { setScanErr("The scan failed twice — wait a beat and run it again."); }
    finally { setBusyScan(false); }
  };
  const accept = (s) => { if (!exists(s.name)) setUniverse([...universe, { name: s.name, kind: s.kind, books: "", tags: s.tags }]); setSuggestions(suggestions.filter((x) => x !== s)); };
  return (
    <section>
      <ModuleHead title="Universe Web" blurb="Every place, power, motif, and event in the world — and the rules that make them dangerous." />
      {universe.length > 3 && (
        <Field label="Search the web"><TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, kind, tag, or book…" /></Field>
      )}
      <Sheet rows={universe} setRows={setUniverse} cols={UNI_COLS} blank={{ name: "", kind: "Location", books: "", tags: "" }} addLabel="Add an entity" emptyLine="The web is empty. Add the first strand." visible={match} />
      <Field label="Auto-tagging — scan pages for entities" hint="Paste chapter text; the engine finds locations, organizations, motifs, events and offers them for the registry.">
        <Area rows={4} value={scanText} onChange={(e) => setScanText(e.target.value)} placeholder="Paste a chapter or scene to mine…" />
      </Field>
      <div className="ik-actions" style={{ marginTop: 4 }}>
        <SealButton busy={busyScan} disabled={!scanText.trim()} onClick={scan}>Scan for entities</SealButton>
        {suggestions.length > 1 && <GhostButton onClick={() => { const add = suggestions.filter((s) => !exists(s.name)).map((s) => ({ name: s.name, kind: s.kind, books: "", tags: s.tags })); setUniverse([...universe, ...add]); setSuggestions([]); }}>Add all {suggestions.length}</GhostButton>}
      </div>
      {scanErr && <div className="ik-error">{scanErr}</div>}
      {suggestions.length > 0 && (
        <div className="ik-suggest">
          {suggestions.map((s, i) => (
            <button key={i} className="ik-chip" onClick={() => accept(s)} title={s.tags}>
              + {s.name} <em>{s.kind}</em>
            </button>
          ))}
        </div>
      )}
      <SmartRow tools={UNI_SMART} gen={gen} ctx={ctx} />
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ---------- Interconnectivity Chart ---------- */
function Interconnectivity({ series, universe, characters, ctx }) {
  const gen = useGen();
  const books = series.books.map((b) => b.title || "Untitled");
  const rows = universe.filter((u) => u.name.trim());
  const hit = (u, b) => u.books.toLowerCase().includes(b.toLowerCase()) && b.trim();
  return (
    <section>
      <ModuleHead title="Interconnectivity Chart" blurb="Which strands touch which books. Filled automatically from the Universe Web's 'appears in' column." />
      {books.length && rows.length ? (
        <div className="ik-matrix" style={{ gridTemplateColumns: `minmax(140px,1.2fr) repeat(${books.length}, minmax(70px,1fr))` }}>
          <span className="ik-label ik-sheet-head">Entity</span>
          {books.map((b) => <span key={b} className="ik-label ik-sheet-head ik-center">{b}</span>)}
          {rows.map((u) => (
            <MatrixRow key={u.name} u={u} books={books} hit={hit} />
          ))}
        </div>
      ) : (
        <p className="ik-empty">The chart draws itself once the Series Map has books and the Universe Web has entities with an "appears in" column.</p>
      )}
      <SmartRow gen={gen} ctx={ctx} tools={[
        ["Find crossover gaps", "Look at which universe entities appear in which books. Identify books that are under-connected to the wider universe and propose the single strongest connection to add to each."],
        ["Easter egg plan", "Design 8 easter eggs — small planted details connecting books — each with: the detail, where it's planted, where it pays off, and what a series reader feels when they catch it."],
        ["New-reader safety audit", "Check the interconnections for anything that would confuse a reader who starts mid-series. Flag each risk and give the one-line on-page fix."],
      ]} />
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}
function MatrixRow({ u, books, hit }) {
  return (
    <>
      <span className="ik-matrix-name">{u.name}<em>{u.kind}</em></span>
      {books.map((b) => (
        <span key={b} className="ik-center">{hit(u, b) ? <span className="ik-dot" title={`${u.name} appears in ${b}`} /> : <span className="ik-dot off" />}</span>
      ))}
    </>
  );
}

/* ============================================================
   CAST — Character Vault, Profile Deep Dive, Character Network
   ============================================================ */
const BLANK_CHAR = { name: "", age: "", role: "", goal: "", fear: "", flaw: "", arcStage: "", wound: "", secret: "", voice: "", relationships: "", conflicts: "", dialogue: "", visual: "" };
const CHAR_FIELDS = [
  ["name", "Name"], ["age", "Age"], ["role", "Role"], ["goal", "Goal / desire"], ["fear", "Fear"], ["flaw", "Flaw"], ["arcStage", "Arc stage"], ["wound", "Wound"], ["secret", "Secret"],
  ["voice", "Voice style"], ["relationships", "Relationship map"], ["conflicts", "Conflict history"], ["dialogue", "Dialogue sample"], ["visual", "Visual prompt"],
];
function CharacterVault({ characters, setCharacters, ctx }) {
  const [openIdx, setOpenIdx] = useState(characters.length ? 0 : -1);
  const [busyIdx, setBusyIdx] = useState(-1);
  const [err, setErr] = useState("");
  const [vq, setVq] = useState("");
  const add = () => { setCharacters([...characters, { ...BLANK_CHAR }]); setOpenIdx(characters.length); };
  const update = (i, k, v) => { const n = characters.slice(); n[i] = { ...n[i], [k]: v }; setCharacters(n); };
  const remove = (i) => { setCharacters(characters.filter((_, x) => x !== i)); setOpenIdx(-1); };
  const generate = async (i) => {
    setBusyIdx(i); setErr("");
    try {
      const parsed = await callClaudeJson(
        `Build a complete character profile for a dark fiction cast. Respond ONLY with a JSON object with exactly these string keys: name, age, role, goal, fear, flaw, arcStage, wound, secret, voice, relationships, conflicts, dialogue, visual. "arcStage" = where they are in their arc (e.g. denial, unraveling, reckoning).\n- "voice" = how they talk and think\n- "relationships" = ties to the rest of the cast\n- "conflicts" = conflict history that still bleeds into the present\n- "dialogue" = a 4-line dialogue sample in their voice, lines separated by \\n escapes\n- "visual" = a vivid visual/casting prompt.\nKeep it tight: every value under 35 words; relationships and conflicts under 55 words. Keep any fields the author already filled and build the rest around them.\n\nStory context:\n${ctx}\n\nAuthor's partial profile: ${JSON.stringify(characters[i])}`,
        { system: "Every value is a plain string." }
      );
      const n = characters.slice();
      n[i] = { ...BLANK_CHAR, ...characters[i], ...Object.fromEntries(Object.entries(parsed).filter(([k]) => k in BLANK_CHAR).map(([k, v]) => [k, asStr(v)])) };
      setCharacters(n);
    } catch (e) { setErr("The vault jammed twice in a row — that's usually a traffic spike. Give it a beat and forge again."); }
    finally { setBusyIdx(-1); }
  };
  return (
    <section>
      <ModuleHead title="Character Vault" blurb="Every soul in the book, on one shelf. Fill what you know; the vault forges the rest around it." />
      {err && <div className="ik-error" style={{ marginBottom: 12 }}>{err}</div>}
      {characters.length > 3 && (
        <Field label="Search the vault"><TextInput value={vq} onChange={(e) => setVq(e.target.value)} placeholder="Filter by name or role…" /></Field>
      )}
      <div className="ik-vault">
        {characters.map((c, i) => (
          (vq.trim() && !`${c.name} ${c.role}`.toLowerCase().includes(vq.toLowerCase())) ? null :
          <div key={i} className={"ik-card" + (openIdx === i ? " open" : "")}>
            <button className="ik-card-head" onClick={() => setOpenIdx(openIdx === i ? -1 : i)}>
              <span className="ik-card-name">{c.name || "Unnamed"}</span>
              <span className="ik-card-role">{c.role || "role tbd"}</span>
            </button>
            {openIdx === i && (
              <div className="ik-card-body">
                <div className="ik-grid2">
                  {CHAR_FIELDS.map(([k, label]) => (
                    <Field key={k} label={label}>
                      {["relationships", "conflicts", "dialogue", "visual"].includes(k)
                        ? <Area rows={3} value={c[k] ?? ""} onChange={(e) => update(i, k, e.target.value)} />
                        : <TextInput value={c[k] ?? ""} onChange={(e) => update(i, k, e.target.value)} />}
                    </Field>
                  ))}
                </div>
                <div className="ik-actions">
                  <SealButton busy={busyIdx === i} onClick={() => generate(i)}>Forge full profile</SealButton>
                  <GhostButton onClick={() => remove(i)}>Remove</GhostButton>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="ik-actions"><GhostButton onClick={add}>+ Add a soul to the vault</GhostButton></div>
      {!characters.length && <p className="ik-empty">The vault is empty. Add your first character to start the map.</p>}
    </section>
  );
}

/* ---------- Profile Deep Dive ---------- */
const DIVE_TOOLS = [
  ["Psychology workup", "Write a psychology workup for this character: attachment style in behavior (not labels lectured at the reader), defense mechanisms as observable habits, what intimacy costs them, the lie they believe, and the moment that could break the lie."],
  ["Backstory timeline", "Build a backstory timeline: 8–12 dated beats from birth to page one, each one line, each leaving a visible scar on present behavior."],
  ["Voice guide", "Write a voice guide: sentence rhythm, vocabulary register, what they never say, verbal tells under pressure, how their inner monologue differs from their spoken voice — plus 5 original sample lines."],
  ["Arc across the series", "Map this character's arc across every book in the series map: where they start, what each appearance costs them, where they end — and the one scene per book that carries the arc."],
  ["Breaking point scene", "Write a 300-word scene sketch of this character at their breaking point, in the book's POV style."],
];
function ProfileDive({ characters, ctx }) {
  const gen = useGen();
  const [selRaw, setSel] = useState(0);
  const sel = Math.min(selRaw, Math.max(characters.length - 1, 0));
  const c = characters[sel];
  return (
    <section>
      <ModuleHead title="Profile Deep Dive" blurb="Pick a soul from the vault and go deeper than the sheet allows." />
      {characters.length ? (
        <>
          <Field label="Character">
            <PickSelect value={sel} onChange={(e) => setSel(Number(e.target.value))} labels={characters.map((c, i) => `${c.name || "Unnamed"} — ${c.role || "role tbd"}`)} />
          </Field>
          <p className="ik-empty" style={{ marginTop: -6 }}>{c?.name || "Unnamed"} — {c?.role || "role tbd"}</p>
          <SmartRow tools={DIVE_TOOLS} gen={gen} ctx={ctx} extra={`SUBJECT CHARACTER (full sheet): ${JSON.stringify(c)}`} />
          <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
        </>
      ) : (
        <p className="ik-empty">The dive needs a vault with at least one character in it.</p>
      )}
    </section>
  );
}

/* ---------- Character Network ---------- */
const EDGE_TYPES = ["Lovers", "Enemies", "Blood", "Allies", "Secret tie", "Owes a debt", "Betrayed"];
const EDGE_COLOR = { Lovers: "#C8A15B", Enemies: "#8E2B3E", Blood: "#7C6F80", Allies: "#5E8C7A", "Secret tie": "#9A6FB0", "Owes a debt": "#B07C4F", Betrayed: "#C25B5B" };
function CharacterNetwork({ characters, edges, setEdges, ctx }) {
  const gen = useGen();
  const names = characters.map((c) => c.name || "Unnamed");
  const [a, setA] = useState(""); const [b, setB] = useState(""); const [t, setT] = useState(EDGE_TYPES[0]);
  const n = names.length;
  const pos = useMemo(() => names.map((_, i) => {
    const ang = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    return { x: 260 + 190 * Math.cos(ang), y: 220 + 165 * Math.sin(ang) };
  }), [n]);
  const addEdge = () => {
    if (!a || !b || a === b) return;
    setEdges([...edges, { a, b, type: t, trust: "5", tension: "5", power: "", status: "Active" }]);
  };
  const edgeText = edges.map((e) => `${e.a} —${e.type}→ ${e.b}`).join("; ");
  return (
    <section>
      <ModuleHead title="Character Network" blurb="The web of want, blood, and debt. Every line is a pressure waiting to snap." />
      {n >= 2 ? (
        <>
          <svg className="ik-net" viewBox="0 0 520 440" role="img" aria-label="Character relationship network">
            {edges.map((e, i) => {
              const ia = names.indexOf(e.a), ib = names.indexOf(e.b);
              if (ia < 0 || ib < 0) return null;
              const w = 1 + Math.min(10, Math.max(0, parseFloat(e.tension) || 5)) / 4;
              return <line key={i} x1={pos[ia].x} y1={pos[ia].y} x2={pos[ib].x} y2={pos[ib].y} stroke={EDGE_COLOR[e.type] || "#7C6F80"} strokeWidth={w} opacity="0.85"><title>{`${e.a} — ${e.type} — ${e.b}${e.power ? ` · power: ${e.power}` : ""}`}</title></line>;
            })}
            {names.map((nm, i) => (
              <g key={nm + i}>
                <circle cx={pos[i].x} cy={pos[i].y} r="7" fill="#181119" stroke="var(--gold)" strokeWidth="1.5" />
                <text x={pos[i].x} y={pos[i].y - 14} textAnchor="middle" className="ik-net-label">{nm}</text>
              </g>
            ))}
          </svg>
          <div className="ik-netlegend">
            {EDGE_TYPES.map((et) => <span key={et} className="ik-legend-item"><span className="ik-swatch" style={{ background: EDGE_COLOR[et] }} />{et}</span>)}
          </div>
          <div className="ik-actions">
            <Select value={a} onChange={(e) => setA(e.target.value)} options={["", ...names]} />
            <Select value={t} onChange={(e) => setT(e.target.value)} options={EDGE_TYPES} />
            <Select value={b} onChange={(e) => setB(e.target.value)} options={["", ...names]} />
            <GhostButton onClick={addEdge}>Tie the thread</GhostButton>
          </div>
          {edges.length > 0 && (
            <Field label="Relationship ledger" hint="Line thickness on the map follows tension.">
              <Sheet rows={edges} setRows={setEdges} cols={[
                { key: "a", label: "Character A", w: ".7fr" },
                { key: "type", label: "Type", type: "select", options: EDGE_TYPES, w: ".6fr" },
                { key: "b", label: "Character B", w: ".7fr" },
                { key: "trust", label: "Trust 0–10", type: "num", w: ".4fr" },
                { key: "tension", label: "Tension 0–10", type: "num", w: ".45fr" },
                { key: "power", label: "Power dynamic", ph: "He holds the leash — for now", w: ".9fr" },
                { key: "status", label: "Status", type: "select", options: ["Active", "Hidden", "Broken", "Healed"], w: ".5fr" },
              ]} blank={{ a: "", b: "", type: EDGE_TYPES[0], trust: "5", tension: "5", power: "", status: "Active" }} addLabel="Add a tie by hand" />
            </Field>
          )}
          <SmartRow gen={gen} ctx={ctx} extra={`RELATIONSHIP EDGES: ${edgeText || "none yet"}`} tools={[
            ["Tension analysis", "Analyze this relationship network including trust, tension, power dynamics and status. Where is the tension over-concentrated, and who is dramatically stranded? Identify the three highest-voltage triangles and what each is worth on the page."],
            ["Missing dynamics", "Propose 5 missing relationships that would raise the stakes — each with the pair, the tie type, the history behind it, and the scene where it detonates."],
            ["Collision course", "Pick the two characters whose collision the network makes inevitable. Describe the collision scene and what it costs everyone connected to them."],
          ]} />
          <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
        </>
      ) : (
        <p className="ik-empty">The network needs at least two characters in the vault.</p>
      )}
    </section>
  );
}

/* ============================================================
   CRAFT — Plot Matrix, Theme Layer, Emotional Tone Map,
           Intimacy Scene Planner
   ============================================================ */
const THREAD_COLS = [
  { key: "name", label: "Thread", ph: "The contract's true owner" },
  { key: "kind", label: "Kind", type: "select", options: ["Main plot", "Romance", "Mystery", "Subplot", "Secret", "Backstory"], w: ".7fr" },
  { key: "opens", label: "Opens ch.", ph: "1", w: ".4fr" },
  { key: "turns", label: "Turns at ch.", ph: "12, 27, 40", w: ".6fr" },
  { key: "closes", label: "Closes ch.", ph: "51", w: ".4fr" },
];
function PlotMatrix({ threads, setThreads, ctx, profile }) {
  const gen = useGen();
  const chapters = parseInt(profile.chapters) || 30;
  const rows = threads.filter((t) => t.name.trim());
  const span = (t) => {
    const o = parseInt(t.opens) || 1;
    const c = parseInt(t.closes) || chapters;
    return { o: Math.max(1, Math.min(o, chapters)), c: Math.max(1, Math.min(c, chapters)) };
  };
  const turnsOf = (t) => (t.turns || "").split(/[,\s]+/).map((x) => parseInt(x)).filter((x) => x >= 1 && x <= chapters);
  return (
    <section>
      <ModuleHead title="Plot Matrix" blurb={`Every thread laid across the book's ${chapters} chapters. Bars are lifespans; marks are turns.`} />
      <Sheet rows={threads} setRows={setThreads} cols={THREAD_COLS} blank={{ name: "", kind: "Main plot", opens: "", turns: "", closes: "" }} addLabel="Add a thread" emptyLine="No threads yet. A book with one thread is a rope; a book with five is a net." />
      {rows.length > 0 && (
        <div className="ik-tracks">
          {rows.map((t, i) => {
            const { o, c } = span(t);
            return (
              <div key={i} className="ik-track">
                <span className="ik-track-name">{t.name}</span>
                <div className="ik-track-lane">
                  <div className="ik-track-bar" style={{ left: `${((o - 1) / chapters) * 100}%`, width: `${((c - o + 1) / chapters) * 100}%` }} />
                  {turnsOf(t).map((ch) => <span key={ch} className="ik-track-turn" style={{ left: `${((ch - 0.5) / chapters) * 100}%` }} title={`Turn at ch. ${ch}`} />)}
                </div>
              </div>
            );
          })}
          <div className="ik-track"><span className="ik-track-name" /><div className="ik-track-scale"><span>ch. 1</span><span>ch. {Math.round(chapters / 2)}</span><span>ch. {chapters}</span></div></div>
        </div>
      )}
      <SmartRow gen={gen} ctx={ctx} extra={`PLOT THREADS: ${JSON.stringify(threads)} across ${chapters} chapters.`} tools={[
        ["Find pacing gaps", "Analyze the thread matrix. Where do chapters run with no active turn on any thread? Where do turns pile up? Give a corrected turn schedule."],
        ["Thread collisions", "Find the chapters where multiple threads turn at once and judge each collision: compounding or muddying? Propose the strongest deliberate collision the matrix is missing."],
        ["Braid the threads", "Propose how the threads should braid: for each pair that never touches, either justify the separation or invent the scene where they cross."],
      ]} />
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ---------- Theme Layer ---------- */
const THEME_COLS = [
  { key: "name", label: "Theme", ph: "Loyalty as a weapon" },
  { key: "statement", label: "The argument", ph: "What the book claims is true" },
  { key: "counter", label: "The counter-argument", ph: "Who or what argues the opposite" },
  { key: "symbol", label: "Symbol / motif", ph: "The signed contract", w: ".8fr" },
  { key: "carrier", label: "Carried by", ph: "Which character embodies it", w: ".8fr" },
  { key: "payoff", label: "Pays off at", ph: "Ch. 48 confession", w: ".7fr" },
];
function ThemeLayer({ themes, setThemes, ctx }) {
  const gen = useGen();
  return (
    <section>
      <ModuleHead title="Theme Layer" blurb="What the book is actually about, under the plot. Every theme needs an argument, an enemy, and a payoff." />
      <Sheet rows={themes} setRows={setThemes} cols={THEME_COLS} blank={{ name: "", statement: "", counter: "", symbol: "", carrier: "", payoff: "" }} addLabel="Add a theme" emptyLine="No themes declared. The book will grow them anyway — better to choose." />
      <SmartRow gen={gen} ctx={ctx} tools={[
        ["Theme audit", "Audit the theme layer: is each theme argued on both sides, or is it a sermon? Which themes lack a counter-force, a symbol, or a payoff? Fix each gap in one line."],
        ["Theme through scenes", "For each theme, propose the three scenes that argue it — one for, one against, one where it breaks. Keep it to beats, not prose."],
        ["Hidden themes", "Read the profile, cast wounds, and secrets. Name the 3 themes the material is already carrying that the author hasn't declared, and say where each is hiding."],
      ]} />
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ---------- Emotional Tone Map ---------- */
function ToneMap({ tonePts, setTonePts, ctx, profile }) {
  const gen = useGen();
  const [busyAuto, setBusyAuto] = useState(false);
  const [err, setErr] = useState("");
  const chapters = parseInt(profile.chapters) || 30;
  const sorted = [...tonePts].filter((p) => p.chapter >= 1).sort((x, y) => x.chapter - y.chapter);
  const X = (ch) => 30 + ((ch - 1) / Math.max(chapters - 1, 1)) * 460;
  const Y = (v) => 180 - (v / 10) * 150;
  const line = (key) => sorted.map((p) => `${X(p.chapter)},${Y(p[key])}`).join(" ");
  const cols = [
    { key: "chapter", label: "Ch.", type: "num", w: ".35fr" },
    { key: "tension", label: "Tension 0–10", type: "num", w: ".5fr" },
    { key: "heat", label: "Heat 0–10", type: "num", w: ".5fr" },
    { key: "note", label: "What happens", ph: "Midpoint reversal" },
  ];
  const rows = tonePts.map((p) => ({ ...p, chapter: String(p.chapter), tension: String(p.tension), heat: String(p.heat) }));
  const setRows = (r) => setTonePts(r.map((p) => ({ chapter: parseInt(p.chapter) || 0, tension: Math.min(10, Math.max(0, parseFloat(p.tension) || 0)), heat: Math.min(10, Math.max(0, parseFloat(p.heat) || 0)), note: p.note || "" })));
  const autoCurve = async () => {
    setBusyAuto(true); setErr("");
    try {
      const arr = await callClaudeJson(
        `Design an emotional tone curve for this book across ${chapters} chapters. Respond ONLY with a JSON array of 10-12 objects, each: {"chapter": number, "tension": number 0-10, "heat": number 0-10, "note": string (under 8 words)}. Tension = dread/stakes; heat = romantic/sexual charge. Shape it like a book that earns its ending.\n\nStory context:\n${ctx}`
      );
      if (Array.isArray(arr)) setTonePts(arr.map((p) => ({ chapter: parseInt(p.chapter) || 1, tension: Math.min(10, Math.max(0, +p.tension || 0)), heat: Math.min(10, Math.max(0, +p.heat || 0)), note: String(p.note || "") })));
    } catch (e) { setErr("The curve wouldn't parse — run it again."); }
    finally { setBusyAuto(false); }
  };
  return (
    <section>
      <ModuleHead title="Emotional Tone Map" blurb="Tension and heat, chapter by chapter. The shape of what the reader feels." />
      {sorted.length >= 2 && (
        <svg className="ik-net" viewBox="0 0 520 210" role="img" aria-label="Tension and heat curves by chapter">
          {[0, 5, 10].map((v) => <g key={v}><line x1="30" x2="490" y1={Y(v)} y2={Y(v)} stroke="var(--line)" strokeWidth="1" /><text x="6" y={Y(v) + 4} className="ik-net-label">{v}</text></g>)}
          <polyline points={line("tension")} fill="none" stroke="#8E2B3E" strokeWidth="2" />
          <polyline points={line("heat")} fill="none" stroke="#C8A15B" strokeWidth="2" />
          {sorted.map((p, i) => <circle key={i} cx={X(p.chapter)} cy={Y(p.tension)} r="3" fill="#8E2B3E"><title>{`Ch. ${p.chapter}: ${p.note}`}</title></circle>)}
        </svg>
      )}
      {sorted.length >= 2 && (
        <div className="ik-netlegend">
          <span className="ik-legend-item"><span className="ik-swatch" style={{ background: "#8E2B3E" }} />Tension</span>
          <span className="ik-legend-item"><span className="ik-swatch" style={{ background: "#C8A15B" }} />Heat</span>
        </div>
      )}
      {err && <div className="ik-error">{err}</div>}
      <Sheet rows={rows} setRows={setRows} cols={cols} blank={{ chapter: "", tension: "", heat: "", note: "" }} addLabel="Add a point" emptyLine="Plot points by hand, or let the engine sketch the curve." />
      <div className="ik-actions">
        <SealButton busy={busyAuto} onClick={autoCurve}>Sketch the curve from the story</SealButton>
        <GhostButton onClick={() => gen.run("Pacing critique", `Critique this emotional tone map (tension & heat by chapter): ${JSON.stringify(sorted)} across ${chapters} chapters. Where does tension flatline? Where does heat spike without earn? Where do the two curves need to cross? Give a corrected shape in words.\n\nStory context:\n${ctx}`)}>Critique the pacing</GhostButton>
      </div>
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ---------- Intimacy Scene Planner ---------- */
const INTIMACY_COLS = [
  { key: "title", label: "Scene", ph: "The dressing room" },
  { key: "who", label: "Between", ph: "Lola & Synn", w: ".8fr" },
  { key: "chapter", label: "Ch.", type: "num", w: ".35fr" },
  { key: "purpose", label: "What changes because of it", ph: "Power flips; she stops performing" },
  { key: "ceiling", label: "Scene heat", type: "select", options: ["Tension only", "Fade to black", "Sensual", "Explicit", "Book ceiling"], w: ".7fr" },
];
function IntimacyPlanner({ scenes, setScenes, ctx, nsfw }) {
  const gen = useGen();
  const [sel, setSel] = useState(0);
  const s = scenes[Math.min(sel, Math.max(scenes.length - 1, 0))];
  return (
    <section>
      <ModuleHead title="Intimacy Scene Planner" blurb="Intimacy is plot. Every scene here has to change something — power, trust, knowledge — or it's decoration." />
      {!nsfw.enabled && <p className="ik-note">Content settings are set to closed-door: blueprints and drafts will build tension and cut away. Flip the switch in Content Settings for on-page scenes.</p>}
      <Sheet rows={scenes} setRows={setScenes} cols={INTIMACY_COLS} blank={{ title: "", who: "", chapter: "", purpose: "", ceiling: "Book ceiling" }} addLabel="Add a scene" emptyLine="No intimacy scenes planned. The map starts with one." />
      {scenes.length > 0 && s && (
        <div className="ik-grid2" style={{ marginTop: 4 }}>
          <Field label="Power dynamic"><Area rows={2} value={s.dynamic ?? ""} onChange={(e) => { const n = scenes.slice(); n[sel] = { ...s, dynamic: e.target.value }; setScenes(n); }} placeholder="Who holds it, how it shifts" /></Field>
          <Field label="Consent notes"><Area rows={2} value={s.consent ?? ""} onChange={(e) => { const n = scenes.slice(); n[sel] = { ...s, consent: e.target.value }; setScenes(n); }} placeholder="How consent is established on the page" /></Field>
          <Field label="Boundary notes"><Area rows={2} value={s.boundaries ?? ""} onChange={(e) => { const n = scenes.slice(); n[sel] = { ...s, boundaries: e.target.value }; setScenes(n); }} placeholder="What this scene will not do" /></Field>
          <Field label="Aftercare / aftermath beat"><Area rows={2} value={s.aftercare ?? ""} onChange={(e) => { const n = scenes.slice(); n[sel] = { ...s, aftercare: e.target.value }; setScenes(n); }} placeholder="The quiet after — what's said, what isn't" /></Field>
          <Field label="Plot consequence"><Area rows={2} value={s.consequence ?? ""} onChange={(e) => { const n = scenes.slice(); n[sel] = { ...s, consequence: e.target.value }; setScenes(n); }} placeholder="What this scene makes irreversible" /></Field>
        </div>
      )}
      {scenes.length > 0 && (
        <div className="ik-actions">
          <Field label="Work on scene"><PickSelect value={Math.min(sel, scenes.length - 1)} onChange={(e) => setSel(Number(e.target.value))} labels={scenes.map((sc, i) => sc.title || `Scene ${i + 1}`)} /></Field>
          <SealButton busy={gen.busy} onClick={() => gen.run(`Scene blueprint — ${s?.title || "Scene"}`,
            `Build an intimacy scene blueprint for this planned scene. Cover: (1) the emotional state each character enters with, (2) the power dynamic and how it shifts beat by beat, (3) the beat list from first touch to aftermath, (4) what is said vs. deliberately unsaid, (5) the one line of dialogue the scene turns on, (6) the aftermath beat and what has permanently changed. Respect the scene heat setting "${s?.ceiling}" and the content rules.\n\nPlanned scene: ${JSON.stringify(s)}\n\nStory context:\n${ctx}`)}>
            Blueprint the scene
          </SealButton>
          <GhostButton onClick={() => gen.run(`Arc check`, `Review all planned intimacy scenes as an arc: ${JSON.stringify(scenes)}. Does the progression escalate emotionally, not just physically? Is any scene decorative (nothing changes)? Is the spacing right against the tone map? Give a corrected sequence if needed.\n\nStory context:\n${ctx}`)}>Check the arc</GhostButton>
          <GhostButton onClick={() => gen.run(`Draft opening — ${s?.title || "Scene"}`, `Write the first 300 words of this intimacy scene in the book's voice and POV, honoring the scene heat setting "${s?.ceiling}" and the content rules. Lead with the emotional charge, not choreography.\n\nPlanned scene: ${JSON.stringify(s)}\n\nStory context:\n${ctx}`)}>Draft the opening</GhostButton>
        </div>
      )}
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ---------- Content Settings (NSFW) ---------- */
function ContentSettings({ nsfw, setNsfw, onReset }) {
  const [arm, setArm] = useState(false);
  return (
    <section>
      <ModuleHead title="Content Settings" blurb="One switch, honored everywhere. Every generator in the studio reads these rules before it writes a word." />
      <div className="ik-card open" style={{ padding: 18 }}>
        <div className="ik-actions" style={{ margin: 0 }}>
          <GhostButton active={nsfw.enabled} onClick={() => setNsfw({ ...nsfw, enabled: !nsfw.enabled })}>
            {nsfw.enabled ? "Explicit content: ON" : "Explicit content: OFF (closed-door)"}
          </GhostButton>
        </div>
        <p className="ik-hint" style={{ margin: "10px 0 18px" }}>
          {nsfw.enabled
            ? "On-page adult content is permitted for adult characters, up to the ceiling below and never past your hard limits."
            : "All generators build tension and cut away. Nothing explicit appears on the page."}
        </p>
        {nsfw.enabled && (
          <>
            <Field label="Content ceiling" hint="The maximum any scene can reach, regardless of the book's heat register.">
              <HeatDial value={nsfw.ceiling} onChange={(c) => setNsfw({ ...nsfw, ceiling: c })} flames={["Sensual", "Steamy", "Explicit", "Dark / Explicit"]} />
            </Field>
            <Field label="Hard limits — never include" hint="A comma-separated list. These are absolute; no generator will cross them.">
              <Area rows={2} value={nsfw.neverInclude} onChange={(e) => setNsfw({ ...nsfw, neverInclude: e.target.value })} placeholder="e.g. cheating played as romantic, injury detail, humiliation…" />
            </Field>
            <Field label="Standing content warnings" hint="Used by the Publishing Toolkit when writing blurbs and descriptions.">
              <Area rows={2} value={nsfw.warnings} onChange={(e) => setNsfw({ ...nsfw, warnings: e.target.value })} placeholder="e.g. explicit content, violence, captivity themes — 18+" />
            </Field>
          </>
        )}
      </div>
      <div className="ik-card" style={{ padding: 18, marginTop: 14 }}>
        <span className="ik-eyebrow">Danger room</span>
        <p className="ik-hint" style={{ margin: "8px 0 12px" }}>The studio auto-saves everything — profile, vault, series, bibles, goals — and restores it when you return. Reset erases all of it permanently.</p>
        <div className="ik-actions" style={{ margin: 0 }}>
          {!arm
            ? <GhostButton onClick={() => setArm(true)}>Reset the studio…</GhostButton>
            : <>
                <SealButton onClick={() => { onReset(); setArm(false); }}>Yes — erase everything</SealButton>
                <GhostButton onClick={() => setArm(false)}>Keep my work</GhostButton>
              </>}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   Shell — grouped sidebar, state, styles
   ============================================================ */
const NAV_GROUPS = [
  ["Write", [
    ["agents", "Agent Manager"], ["desk", "Writing Desk"], ["prompts", "Prompt Forge"],
    ["builder", "Story Builder"], ["studio", "Chapter Studio"], ["architect", "Scene Architect"], ["plot", "Plot Engine"],
    ["script", "Script Board"], ["songs", "Song Grid"], ["audio", "Audio Room"], ["modes", "Dark Modes"],
  ]],
  ["Series", [
    ["seriesmap", "Series Map"], ["bible", "Book Bible"], ["universe", "Universe Web"], ["interlink", "Interconnectivity"],
  ]],
  ["Intel", [
    ["knowledge", "Knowledge Explorer"], ["ledger", "Scene Ledger"], ["canon", "Canon Guard"],
    ["reveals", "Reveal Manager"], ["memory", "Character Memory"], ["motifs2", "Motif Tracker"], ["doctor", "Chapter Doctor"],
  ]],
  ["Cast", [
    ["vault", "Character Vault"], ["dive", "Profile Deep Dive"], ["network", "Character Network"],
  ]],
  ["Craft", [
    ["matrix", "Plot Matrix"], ["themes", "Theme Layer"], ["tonemap", "Emotional Tone Map"], ["intimacy", "Intimacy Planner"], ["dictionary", "House Dictionary"],
  ]],
  ["Launch", [
    ["publish", "Publishing Toolkit"],
  ]],
  ["Studio", [
    ["goals", "Writing Goals"], ["projects", "Projects & Export"], ["content", "Content Settings"],
  ]],
];

export default function Inksaint() {
  const [active, setActive] = useState("builder");
  const [profile, setProfile] = useState({
    title: "", genre: "", trope: "", tone: "", heat: "Steamy",
    pov: "Dual first person", series: "Series opener",
    chapters: "", wordGoal: "", reader: "", premise: "",
  });
  const [characters, setCharacters] = useState([]);
  const [presets, setPresets] = useState([]);
  const [series, setSeries] = useState({ title: "", genreTags: "", themeTags: "", toneTags: "", books: [], charLinks: "", locLinks: "", motifLinks: "", timeLinks: "" });
  const [bibles, setBibles] = useState({});
  const [universe, setUniverse] = useState([]);
  const [edges, setEdges] = useState([]);
  const [threads, setThreads] = useState([]);
  const [themes, setThemes] = useState([]);
  const [tonePts, setTonePts] = useState([]);
  const [songs, setSongs] = useState([]);
  const [intimacy, setIntimacy] = useState([]);
  const [nsfw, setNsfw] = useState({ enabled: false, ceiling: "Explicit", neverInclude: "", warnings: "" });
  const [goals, setGoals] = useState({ dailyTarget: "", deadline: "", sessions: [] });
  const [activeAgent, setActiveAgent] = useState("");
  const [agentChats, setAgentChats] = useState({});
  const [customModes, setCustomModes] = useState([]);
  const [dict, setDict] = useState({ lexicon: [], banned: [] });
  const [knowledge, setKnowledge] = useState({ notes: [], tags: [], links: [] });
  const [ledger, setLedger] = useState([]);
  const [reveals, setReveals] = useState([]);
  const [motifs, setMotifs] = useState([]);
  const [projectName, setProjectName] = useState("");
  const [docs, setDocs] = useState([]);
  const [prompts, setPrompts] = useState([]);
  const [customAgents, setCustomAgents] = useState([]);
  const [agentEdits, setAgentEdits] = useState({});
  const [bib, setBib] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const ctx = buildContext({ profile, presets, characters, series, universe, themes, nsfw, dict, ledger, reveals, motifs, knowledge });
  const mainRef = useRef(null);
  useEffect(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }, [active]);

  /* ---- persistence: the studio survives the tab ---- */
  const STORE_KEY = "inksaint-studio";
  const setters = { profile: setProfile, characters: setCharacters, presets: setPresets, series: setSeries, bibles: setBibles, universe: setUniverse, edges: setEdges, threads: setThreads, themes: setThemes, tonePts: setTonePts, songs: setSongs, intimacy: setIntimacy, nsfw: setNsfw, goals: setGoals, activeAgent: setActiveAgent, agentChats: setAgentChats, customModes: setCustomModes, dict: setDict, knowledge: setKnowledge, ledger: setLedger, reveals: setReveals, motifs: setMotifs, projectName: setProjectName, docs: setDocs, prompts: setPrompts, customAgents: setCustomAgents, agentEdits: setAgentEdits, bib: setBib };
  const applySnapshot = (s) => { Object.entries(setters).forEach(([k, fn]) => { if (s[k] !== undefined) fn(s[k]); }); };
  useEffect(() => {
    (async () => {
      try {
        const r = await appStorage.get(STORE_KEY);
        if (r?.value) {
          const s = JSON.parse(r.value);
          Object.entries(setters).forEach(([k, fn]) => { if (s[k] !== undefined) fn(s[k]); });
        }
      } catch (e) { /* first visit — nothing saved yet */ }
      finally { setLoaded(true); }
    })();
  }, []);
  const snapshot = { profile, characters, presets, series, bibles, universe, edges, threads, themes, tonePts, songs, intimacy, nsfw, goals, activeAgent, agentChats, customModes, dict, knowledge, ledger, reveals, motifs, projectName, docs, prompts, customAgents, agentEdits, bib };
  const snapJson = JSON.stringify(snapshot);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(async () => {
      try { await appStorage.set(STORE_KEY, snapJson); setSavedAt(new Date()); } catch (e) { /* save failed; will retry on next change */ }
    }, 1200);
    return () => clearTimeout(t);
  }, [snapJson, loaded]);
  const resetStudio = async () => {
    try { await appStorage.delete(STORE_KEY); } catch (e) {}
    setProfile({ title: "", genre: "", trope: "", tone: "", heat: "Steamy", pov: "Dual first person", series: "Series opener", chapters: "", wordGoal: "", reader: "", premise: "" });
    setCharacters([]); setPresets([]); setSeries({ title: "", genreTags: "", themeTags: "", toneTags: "", books: [], charLinks: "", locLinks: "", motifLinks: "", timeLinks: "" });
    setBibles({}); setUniverse([]); setEdges([]); setThreads([]); setThemes([]); setTonePts([]); setSongs([]); setIntimacy([]);
    setNsfw({ enabled: false, ceiling: "Explicit", neverInclude: "", warnings: "" });
    setGoals({ dailyTarget: "", deadline: "", sessions: [] });
    setActiveAgent(""); setAgentChats({}); setCustomModes([]); setDict({ lexicon: [], banned: [] });
    setKnowledge({ notes: [], tags: [], links: [] }); setLedger([]); setReveals([]); setMotifs([]); setProjectName("");
    setDocs([]); setPrompts([]); setCustomAgents([]); setAgentEdits({}); setBib("");
    setSavedAt(null);
  };
  const logWords = (n) => setGoals((g) => ({ ...g, sessions: [...g.sessions, { date: today(), words: String(n), note: profile.title || "Chapter Studio" }] }));

  const screens = {
    builder: <StoryBuilder profile={profile} setProfile={setProfile} ctx={ctx} />,
    studio: <ChapterStudio ctx={ctx} logWords={logWords} />,
    plot: <PlotEngine ctx={ctx} />,
    script: <ScriptBoard ctx={ctx} />,
    songs: <SongGrid songs={songs} setSongs={setSongs} ctx={ctx} />,
    audio: <AudioRoom characters={characters} ctx={ctx} />,
    modes: <DarkModes presets={presets} setPresets={setPresets} custom={customModes} setCustom={setCustomModes} ctx={ctx} />,
    agents: <AgentDesk active={activeAgent} setActive={setActiveAgent} chats={agentChats} setChats={setAgentChats} ctx={ctx} customAgents={customAgents} setCustomAgents={setCustomAgents} agentEdits={agentEdits} setAgentEdits={setAgentEdits} />,
    desk: <WritingDesk docs={docs} setDocs={setDocs} knowledge={knowledge} setKnowledge={setKnowledge} characters={characters} universe={universe} bib={bib} setBib={setBib} ctx={ctx} />,
    prompts: <PromptForge prompts={prompts} setPrompts={setPrompts} ctx={ctx} sendToDesk={(title, text) => { setDocs([...docs, { id: String(Date.now()), title: title.slice(0, 60), text: text + "\n\n" }]); setActive("desk"); }} />,
    dictionary: <HouseDictionary dict={dict} setDict={setDict} ctx={ctx} />,
    knowledge: <KnowledgeExplorer knowledge={knowledge} setKnowledge={setKnowledge} characters={characters} universe={universe} series={series} profile={profile} ctx={ctx} />,
    ledger: <SceneLedger ledger={ledger} setLedger={setLedger} ctx={ctx} />,
    canon: <CanonGuard ctx={ctx} bibles={bibles} ledger={ledger} />,
    reveals: <RevealManager reveals={reveals} setReveals={setReveals} ctx={ctx} profile={profile} />,
    memory: <CharacterMemory ctx={ctx} characters={characters} ledger={ledger} bibles={bibles} reveals={reveals} />,
    motifs2: <MotifTracker motifs={motifs} setMotifs={setMotifs} ctx={ctx} />,
    doctor: <ChapterDoctor ctx={ctx} ledger={ledger} />,
    architect: <SceneArchitect ctx={ctx} nsfw={nsfw} />,
    projects: <ProjectsPanel snapshot={snapshot} applySnapshot={applySnapshot} resetStudio={resetStudio} projectName={projectName} setProjectName={setProjectName} />,
    seriesmap: <SeriesMap series={series} setSeries={setSeries} ctx={ctx} />,
    bible: <BookBible series={series} bibles={bibles} setBibles={setBibles} ctx={ctx} />,
    universe: <UniverseWeb universe={universe} setUniverse={setUniverse} ctx={ctx} />,
    interlink: <Interconnectivity series={series} universe={universe} characters={characters} ctx={ctx} />,
    vault: <CharacterVault characters={characters} setCharacters={setCharacters} ctx={ctx} />,
    dive: <ProfileDive characters={characters} ctx={ctx} />,
    network: <CharacterNetwork characters={characters} edges={edges} setEdges={setEdges} ctx={ctx} />,
    matrix: <PlotMatrix threads={threads} setThreads={setThreads} ctx={ctx} profile={profile} />,
    themes: <ThemeLayer themes={themes} setThemes={setThemes} ctx={ctx} />,
    tonemap: <ToneMap tonePts={tonePts} setTonePts={setTonePts} ctx={ctx} profile={profile} />,
    intimacy: <IntimacyPlanner scenes={intimacy} setScenes={setIntimacy} ctx={ctx} nsfw={nsfw} />,
    publish: <Publishing ctx={ctx} />,
    goals: <WritingGoals goals={goals} setGoals={setGoals} profile={profile} ctx={ctx} />,
    content: <ContentSettings nsfw={nsfw} setNsfw={setNsfw} onReset={resetStudio} />,
  };

  return (
    <div className="ik-root">
      <style>{CSS}</style>
      <aside className="ik-side">
        <div className="ik-brand">
          <svg viewBox="0 0 32 40" width="26" height="32" aria-hidden="true">
            <path d="M16 2c2 6 8 8 8 16 0 4-2 7-5 8 3 3 4 6 3 12h-3c.5-5-.5-8-3-10-2.5 2-3.5 5-3 10H10c-1-6 0-9 3-12-3-1-5-4-5-8 0-8 6-10 8-16z" fill="none" stroke="var(--gold)" strokeWidth="1.6" strokeLinejoin="round"/>
          </svg>
          <div>
            <span className="ik-wordmark">INKSAINT</span>
            <span className="ik-tag">dark fiction universe console</span>
          </div>
        </div>
        <nav className="ik-nav">
          {NAV_GROUPS.map(([group, items]) => (
            <div key={group} className="ik-navgroup">
              <span className="ik-eyebrow">{group}</span>
              {items.map(([id, name]) => (
                <button key={id} className={"ik-navbtn" + (active === id ? " on" : "")} onClick={() => setActive(id)}>
                  <span className="ik-navname">{name}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="ik-sidefoot">
          <span className="ik-eyebrow">On the record</span>
          {savedAt && <p style={{ margin: "4px 0 0" }}>Saved {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — the studio remembers.</p>}
          <p>{projectName || series.title || profile.title || "Untitled universe"} · {profile.heat}{nsfw.enabled ? " · explicit on" : " · closed-door"}{characters.length ? ` · ${characters.length} in the vault` : ""}{series.books.length ? ` · ${series.books.length} books mapped` : ""}{activeAgent ? ` · ${AGENTS.find((a) => a.id === activeAgent)?.name || ""} on desk` : ""}</p>
        </div>
      </aside>
      <main className="ik-main" ref={mainRef}>
        <ScreenBar active={active} title={NAV_GROUPS.flatMap(([, items]) => items).find(([id]) => id === active)?.[1] || "Studio"} snapshot={snapshot} ctx={ctx} />
        {screens[active]}
      </main>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Karla:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

.ik-root {
  --ink:#100B10; --panel:#181119; --panel2:#1F1620; --line:#2E2230;
  --wine:#8E2B3E; --wine-deep:#5E1B2B; --gold:#C8A15B;
  --parchment:#EAE0D2; --smoke:#B9ADBB; --faint:#7C6F80;
  display:flex; min-height:100vh; background:
    radial-gradient(1200px 600px at 85% -10%, rgba(142,43,62,.12), transparent 60%),
    var(--ink);
  color:var(--smoke); font-family:'Karla',sans-serif; font-size:15px; line-height:1.55;
}
.ik-root *, .ik-root *::before, .ik-root *::after { box-sizing:border-box; }
.ik-root button { font-family:inherit; cursor:pointer; }
.ik-root :is(button,input,select,textarea):focus-visible { outline:2px solid var(--gold); outline-offset:2px; }

/* sidebar */
.ik-side { width:250px; flex-shrink:0; border-right:1px solid var(--line); padding:24px 16px; display:flex; flex-direction:column; gap:20px; position:sticky; top:0; height:100vh; overflow-y:auto; }
.ik-brand { display:flex; gap:12px; align-items:center; }
.ik-wordmark { display:block; font-family:'Fraunces',serif; font-weight:700; font-size:19px; letter-spacing:.14em; color:var(--parchment); }
.ik-tag { display:block; font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--faint); margin-top:2px; }
.ik-nav { display:flex; flex-direction:column; gap:16px; }
.ik-navgroup { display:flex; flex-direction:column; gap:2px; }
.ik-navgroup > .ik-eyebrow { padding:0 10px 5px; }
.ik-navbtn { text-align:left; background:none; border:1px solid transparent; border-radius:6px; padding:7px 10px; transition:background .15s, border-color .15s; }
.ik-navbtn:hover { background:var(--panel); }
.ik-navbtn.on { background:var(--panel); border-color:var(--line); box-shadow:inset 2px 0 0 var(--wine); }
.ik-navname { display:block; color:var(--parchment); font-weight:500; font-size:13.5px; }
.ik-sidefoot { margin-top:auto; border-top:1px solid var(--line); padding-top:14px; font-size:12px; color:var(--faint); }
.ik-sidefoot p { margin:6px 0 0; }

/* main */
.ik-main { flex:1; padding:36px clamp(20px, 4.5vw, 60px) 80px; max-height:100vh; overflow-y:auto; }
.ik-modhead h2 { font-family:'Fraunces',serif; font-weight:600; font-size:clamp(25px, 3vw, 32px); color:var(--parchment); margin:0 0 6px; letter-spacing:.01em; }
.ik-modhead p { margin:0 0 24px; color:var(--faint); max-width:60ch; }
.ik-eyebrow { font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--gold); }

/* fields */
.ik-grid2 { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:14px 18px; margin-bottom:14px; }
.ik-field { display:flex; flex-direction:column; gap:6px; margin-bottom:14px; min-width:0; }
.ik-grid2 .ik-field, .ik-actions .ik-field { margin-bottom:0; }
.ik-label { font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--faint); }
.ik-hint { font-size:12px; color:var(--faint); }
.ik-input { background:var(--panel); border:1px solid var(--line); border-radius:6px; color:var(--parchment); padding:9px 11px; font-family:'Karla',sans-serif; font-size:14px; width:100%; min-width:0; }
.ik-input::placeholder { color:#5d5162; }
.ik-select { appearance:none; }
.ik-area { resize:vertical; line-height:1.6; }

/* heat dial */
.ik-heat { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
.ik-flame { background:none; border:none; padding:4px; border-radius:6px; transition:transform .12s; }
.ik-flame:hover { transform:translateY(-2px); }
.ik-flame.lit svg { filter:drop-shadow(0 0 6px rgba(200,161,91,.45)); }
.ik-heat-name { margin-left:10px; font-family:'Fraunces',serif; font-style:italic; color:var(--gold); font-size:15px; }

/* buttons */
.ik-actions { display:flex; gap:12px; align-items:flex-end; margin:16px 0 6px; flex-wrap:wrap; }
.ik-seal { background:linear-gradient(135deg, var(--wine), var(--wine-deep)); color:var(--parchment); border:1px solid #A23A4E; border-radius:999px; padding:11px 24px; font-weight:600; font-size:14px; letter-spacing:.03em; transition:box-shadow .15s, transform .12s; }
.ik-seal:hover:not(:disabled) { box-shadow:0 0 0 1px #A23A4E, 0 6px 22px rgba(142,43,62,.35); transform:translateY(-1px); }
.ik-seal:disabled { opacity:.5; cursor:default; }
.ik-ghost { background:none; border:1px solid var(--line); border-radius:999px; color:var(--smoke); padding:9px 18px; font-size:13.5px; transition:border-color .15s, color .15s, background .15s; }
.ik-ghost:hover { border-color:var(--gold); color:var(--parchment); }
.ik-ghost.on { border-color:var(--gold); color:var(--gold); background:rgba(200,161,91,.08); }
.ik-mini { background:none; border:1px solid var(--line); border-radius:5px; color:var(--smoke); padding:4px 10px; font-size:12px; }
.ik-mini:hover { border-color:var(--gold); color:var(--parchment); }
.ik-x { background:none; border:none; color:var(--faint); font-size:17px; line-height:1; align-self:center; border-radius:5px; padding:4px 6px; }
.ik-x:hover { color:#D98A94; }

/* tool grid */
.ik-toolgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:10px; margin:6px 0 10px; }
.ik-tool { background:var(--panel); border:1px solid var(--line); border-radius:8px; color:var(--parchment); padding:13px 14px; text-align:left; font-weight:600; font-size:13.5px; transition:border-color .15s, background .15s, transform .12s; }
.ik-tool:hover:not(:disabled) { border-color:var(--wine); background:var(--panel2); transform:translateY(-1px); }
.ik-tool:disabled { opacity:.45; cursor:default; }

/* sheets */
.ik-sheet-wrap { margin-bottom:6px; }
.ik-sheet { display:grid; gap:8px 10px; align-items:center; }
.ik-sheet-head { padding-bottom:2px; }
.ik-center { text-align:center; justify-self:center; }

/* vault */
.ik-vault { display:flex; flex-direction:column; gap:10px; }
.ik-card { border:1px solid var(--line); border-radius:10px; background:var(--panel); overflow:hidden; }
.ik-card.open { border-color:var(--wine); }
.ik-card-head { width:100%; display:flex; justify-content:space-between; align-items:baseline; gap:12px; background:none; border:none; padding:14px 16px; }
.ik-card-name { font-family:'Fraunces',serif; font-size:17px; font-weight:600; color:var(--parchment); }
.ik-card-role { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--faint); }
.ik-card-body { padding:6px 16px 16px; border-top:1px solid var(--line); }
.ik-card-body .ik-grid2 { padding-top:12px; }

/* presets */
.ik-presets { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:8px; }

/* network + charts */
.ik-net { width:100%; max-width:640px; display:block; background:var(--panel); border:1px solid var(--line); border-radius:10px; margin-bottom:10px; }
.ik-net-label { font-family:'IBM Plex Mono',monospace; font-size:10px; fill:var(--smoke); letter-spacing:.04em; }
.ik-netlegend { display:flex; flex-wrap:wrap; gap:14px; margin-bottom:12px; }
.ik-legend-item { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--faint); }
.ik-swatch { width:12px; height:3px; border-radius:2px; display:inline-block; }

/* interconnectivity matrix */
.ik-matrix { display:grid; gap:10px 8px; align-items:center; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:14px; overflow-x:auto; }
.ik-matrix-name { color:var(--parchment); font-size:13.5px; }
.ik-matrix-name em { display:block; font-style:normal; font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--faint); }
.ik-dot { width:10px; height:10px; border-radius:50%; background:var(--gold); display:inline-block; box-shadow:0 0 8px rgba(200,161,91,.4); }
.ik-dot.off { background:transparent; border:1px solid var(--line); box-shadow:none; }

/* plot matrix tracks */
.ik-tracks { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px; margin:12px 0; display:flex; flex-direction:column; gap:10px; }
.ik-track { display:grid; grid-template-columns:minmax(120px,.9fr) 3fr; gap:12px; align-items:center; }
.ik-track-name { font-size:13px; color:var(--parchment); }
.ik-track-lane { position:relative; height:14px; background:var(--ink); border-radius:7px; }
.ik-track-bar { position:absolute; top:3px; height:8px; border-radius:4px; background:linear-gradient(90deg, var(--wine-deep), var(--wine)); }
.ik-track-turn { position:absolute; top:0; width:3px; height:14px; background:var(--gold); border-radius:2px; transform:translateX(-1px); }
.ik-track-scale { display:flex; justify-content:space-between; font-family:'IBM Plex Mono',monospace; font-size:10px; color:var(--faint); }

/* output */
.ik-output { margin-top:22px; border:1px solid var(--line); border-radius:10px; background:var(--panel); }
.ik-output-bar { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid var(--line); }
.ik-output-actions { display:flex; gap:8px; }
.ik-prose { margin:0; padding:18px 20px; white-space:pre-wrap; font-family:'Karla',sans-serif; font-size:14.5px; line-height:1.7; color:var(--smoke); }
.ik-busy { padding:18px 20px; color:var(--faint); display:flex; align-items:center; gap:10px; font-style:italic; }
.ik-pulse { width:8px; height:8px; border-radius:50%; background:var(--gold); animation:ikpulse 1.1s ease-in-out infinite; }
@keyframes ikpulse { 0%,100%{opacity:.25; transform:scale(.8)} 50%{opacity:1; transform:scale(1.1)} }
.ik-error { padding:14px 20px; color:#D98A94; }
.ik-empty { color:var(--faint); font-style:italic; margin:14px 0; }
.ik-note { border:1px solid var(--line); border-left:2px solid var(--gold); background:var(--panel); border-radius:8px; padding:10px 14px; font-size:13px; color:var(--smoke); margin-bottom:16px; }

/* goals + word bar + suggestions */
.ik-wordbar { display:flex; justify-content:space-between; align-items:center; gap:12px; font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.06em; color:var(--faint); margin:-6px 0 12px; flex-wrap:wrap; }
.ik-goalgrid { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:16px; margin:6px 0 14px; }
.ik-goal { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; display:flex; flex-direction:column; gap:8px; }
.ik-goal-top { display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
.ik-goal-num { font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--parchment); }
.ik-bar { height:8px; border-radius:4px; background:var(--ink); overflow:hidden; }
.ik-bar-fill { height:100%; border-radius:4px; background:linear-gradient(90deg, var(--wine-deep), var(--wine) 60%, var(--gold)); transition:width .3s; }
.ik-suggest { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0; }
.ik-chip { background:var(--panel); border:1px solid var(--line); border-radius:999px; color:var(--parchment); padding:7px 14px; font-size:13px; transition:border-color .15s; }
.ik-chip:hover { border-color:var(--gold); }
.ik-chip em { font-style:normal; font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); margin-left:6px; }

/* screen bar / desk grid / roundtable */
.ik-screenbar-wrap { margin-bottom: 20px; }
.ik-screenbar { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; border:1px solid var(--line); border-radius:10px; padding:9px 14px; background:linear-gradient(165deg, #1C141D, #150F16); }
.ik-askrow { display:flex; gap:10px; margin-top:10px; align-items:center; }
.ik-mini-on { border-color:var(--gold); color:var(--gold); }
.ik-deskgrid { display:grid; grid-template-columns: 1.15fr .85fr; gap:18px; align-items:start; }
.ik-canvas { font-size:15px; line-height:1.75; }
.ik-synth { border-color:var(--gold); box-shadow:0 0 0 1px rgba(200,161,91,.25); }
@media (max-width: 900px) { .ik-deskgrid { grid-template-columns: 1fr; } }

/* writing desk v2: preview, screenplay, focus */
.ik-mono { font-family:'IBM Plex Mono',monospace !important; font-size:13.5px !important; }
.ik-previewbox { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px 18px; max-height:480px; overflow-y:auto; font-size:14px; line-height:1.65; color:var(--smoke); }
.ik-previewbox h1, .ik-previewbox h2, .ik-previewbox h3, .ik-previewbox h4 { font-family:'Fraunces',serif; color:var(--parchment); margin:14px 0 6px; }
.ik-previewbox h1 { font-size:22px; } .ik-previewbox h2 { font-size:18px; } .ik-previewbox h3 { font-size:15px; }
.ik-previewbox p { margin:8px 0; }
.ik-previewbox blockquote { border-left:2px solid var(--wine); margin:8px 0; padding:2px 12px; color:var(--faint); font-style:italic; }
.ik-previewbox hr { border:none; border-top:1px solid var(--line); margin:14px 0; }
.ik-previewbox code { background:var(--ink); border:1px solid var(--line); border-radius:4px; padding:1px 5px; font-family:'IBM Plex Mono',monospace; font-size:12px; }
.ik-previewbox ul { padding-left:20px; margin:8px 0; }
.ik-mention { color:var(--gold); border-bottom:1px dotted var(--gold); }
.ik-cite { color:#9A6FB0; font-family:'IBM Plex Mono',monospace; font-size:12px; }
.ik-scr { font-family:'IBM Plex Mono',monospace; font-size:12.5px; }
.ik-scr .scr-slug { font-weight:700; text-transform:uppercase; color:var(--parchment); margin:18px 0 6px; }
.ik-scr .scr-cue { margin:14px 0 0 34%; text-transform:uppercase; color:var(--gold); }
.ik-scr .scr-dialogue { margin:0 12% 0 20%; color:var(--parchment); }
.ik-scr .scr-paren { margin:0 12% 0 27%; font-style:italic; color:var(--faint); }
.ik-scr .scr-transition { text-align:right; text-transform:uppercase; color:var(--faint); }
.ik-scr .scr-action { margin:8px 0; }
.ik-focusov { position:fixed; inset:0; z-index:50; background:rgba(10,7,11,.98); display:flex; flex-direction:column; padding:26px clamp(16px, 12vw, 180px) 20px; }
.ik-focushead { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
.ik-focused { flex:1; background:transparent; border:none; outline:none; color:var(--parchment); font-family:'Karla',sans-serif; font-size:17px; line-height:1.9; resize:none; }
.ik-focused::selection { background:rgba(142,43,62,.5); }

/* audio room */
.ik-range { width:100%; accent-color:var(--gold); background:transparent; }
.ik-castlist { display:flex; flex-direction:column; gap:8px; }
.ik-castrow { display:grid; grid-template-columns:minmax(110px,.7fr) 2fr auto; gap:10px; align-items:center; }
.ik-cast-name { font-family:'Fraunces',serif; font-size:15px; color:var(--parchment); }
.ik-script { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; max-height:340px; overflow-y:auto; }
.ik-seg { margin:0 0 10px; padding:6px 10px; border-radius:6px; font-size:14px; line-height:1.6; border-left:2px solid transparent; }
.ik-seg.now { background:var(--panel2); border-left-color:var(--gold); color:var(--parchment); }
.ik-seg-speaker { display:block; font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--gold); margin-bottom:2px; }

@media (prefers-reduced-motion: reduce) {
  .ik-root * { animation:none !important; transition:none !important; }
}

/* ============ PREMIUM PASS ============ */
/* agent manager */
.ik-agents { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:12px; margin-bottom:20px; }
.ik-agent { text-align:left; background:linear-gradient(165deg, #1C141D, #150F16); border:1px solid var(--line); border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:5px; transition:border-color .18s, transform .15s, box-shadow .18s; }
.ik-agent:hover { border-color:var(--wine); transform:translateY(-2px); box-shadow:0 10px 26px rgba(0,0,0,.3); }
.ik-agent.on { border-color:var(--gold); box-shadow:0 0 0 1px var(--gold), 0 12px 30px rgba(142,43,62,.22); }
.ik-agent-name { font-family:'Fraunces',serif; font-weight:600; font-size:17px; color:var(--parchment); }
.ik-agent-tag { font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--gold); }
.ik-agent-desc { font-size:12.5px; color:var(--faint); line-height:1.5; }
.ik-desk { border:1px solid var(--line); border-radius:12px; background:linear-gradient(170deg, #1B131C, #130E14); overflow:hidden; }
.ik-desk-bar { display:flex; justify-content:space-between; align-items:center; padding:10px 16px; border-bottom:1px solid var(--line); background:rgba(142,43,62,.06); }
.ik-quick { display:flex; flex-wrap:wrap; gap:8px; padding:12px 16px 0; }
.ik-chip-gold { border-color:var(--gold); color:var(--gold); }
.ik-chatlog { padding:14px 16px; max-height:420px; overflow-y:auto; display:flex; flex-direction:column; gap:12px; }
.ik-msg { max-width:88%; border:1px solid var(--line); border-radius:10px; padding:10px 14px; background:var(--panel2); }
.ik-msg.user { align-self:flex-end; background:rgba(142,43,62,.14); border-color:rgba(142,43,62,.4); }
.ik-msg.assistant { align-self:flex-start; }
.ik-msg-text { margin:0; white-space:pre-wrap; font-family:'Karla',sans-serif; font-size:14px; line-height:1.65; color:var(--smoke); }
.ik-chatrow { display:flex; gap:10px; padding:12px 16px 16px; align-items:flex-end; border-top:1px solid var(--line); }
.ik-custommode { display:inline-flex; align-items:center; gap:2px; }

/* ambience: layered glow + grain + vignette */
.ik-root { background:
  radial-gradient(1400px 700px at 85% -10%, rgba(142,43,62,.16), transparent 60%),
  radial-gradient(1000px 600px at -10% 108%, rgba(200,161,91,.06), transparent 55%),
  linear-gradient(180deg, #120C13, #0E090F);
}
.ik-root::after { content:""; position:fixed; inset:0; pointer-events:none; z-index:0; opacity:.045; mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/></filter><rect width='140' height='140' filter='url(%23n)'/></svg>");
}
.ik-side, .ik-main { position:relative; z-index:1; }

/* sidebar: gilded rail */
.ik-side { background:linear-gradient(180deg, rgba(142,43,62,.07), transparent 26%), rgba(22,15,23,.72); backdrop-filter:blur(8px); }
.ik-side { border-right:1px solid transparent; border-image:linear-gradient(180deg, rgba(200,161,91,.35), var(--line) 30%, var(--line) 70%, rgba(142,43,62,.35)) 1; }
.ik-navbtn { transition:background .15s, border-color .15s, padding-left .15s; }
.ik-navbtn:hover { padding-left:14px; }
.ik-navbtn.on { background:linear-gradient(90deg, rgba(142,43,62,.16), var(--panel)); }

/* surfaces: depth */
.ik-card, .ik-output, .ik-goal, .ik-tracks, .ik-matrix, .ik-net, .ik-script, .ik-tool {
  background:linear-gradient(165deg, #1C141D, #150F16); box-shadow:0 8px 26px rgba(0,0,0,.28);
}
.ik-input { background:rgba(14,9,15,.6); transition:border-color .15s, box-shadow .15s; }
.ik-input:focus { border-color:var(--wine); box-shadow:0 0 0 3px rgba(142,43,62,.16); outline:none; }

/* seal buttons: wax shine */
.ik-seal { position:relative; overflow:hidden; box-shadow:0 4px 16px rgba(94,27,43,.35); }
.ik-seal::after { content:""; position:absolute; top:0; left:-70%; width:45%; height:100%; background:linear-gradient(105deg, transparent, rgba(234,224,210,.22), transparent); transform:skewX(-20deg); transition:left .5s ease; }
.ik-seal:hover:not(:disabled)::after { left:130%; }

/* module head ornament */
.ik-modhead h2 { text-shadow:0 2px 24px rgba(142,43,62,.25); }
.ik-modhead h2::after { content:""; display:block; width:68px; height:2px; margin-top:12px; background:linear-gradient(90deg, var(--gold), rgba(200,161,91,0)); border-radius:2px; }

/* module entrance */
@keyframes ikfade { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
.ik-main > section { animation:ikfade .32s ease; }

/* scrollbars */
.ik-main::-webkit-scrollbar, .ik-side::-webkit-scrollbar, .ik-chatlog::-webkit-scrollbar, .ik-script::-webkit-scrollbar { width:9px; }
.ik-main::-webkit-scrollbar-thumb, .ik-side::-webkit-scrollbar-thumb, .ik-chatlog::-webkit-scrollbar-thumb, .ik-script::-webkit-scrollbar-thumb { background:var(--line); border-radius:5px; }
.ik-main::-webkit-scrollbar-thumb:hover, .ik-chatlog::-webkit-scrollbar-thumb:hover { background:var(--wine); }
.ik-main::-webkit-scrollbar-track, .ik-side::-webkit-scrollbar-track { background:transparent; }

/* selection */
.ik-root ::selection { background:rgba(142,43,62,.45); color:var(--parchment); }

@media (max-width: 780px) {
  .ik-root { flex-direction:column; }
  .ik-side { width:100%; height:auto; position:static; border-right:none; border-bottom:1px solid var(--line); padding:16px; }
  .ik-nav { flex-direction:row; flex-wrap:wrap; gap:12px; }
  .ik-navgroup { flex-direction:row; flex-wrap:wrap; align-items:center; gap:4px; }
  .ik-navgroup > .ik-eyebrow { width:100%; padding:0 0 3px; }
  .ik-sidefoot { display:none; }
  .ik-main { max-height:none; padding:22px 14px 60px; }
  .ik-sheet { grid-template-columns:1fr 28px !important; }
  .ik-sheet-head { display:none; }
  .ik-agents { grid-template-columns:1fr 1fr; }
  .ik-msg { max-width:100%; }
  .ik-chatrow { flex-direction:column; align-items:stretch; }
}
`;

/* ============================================================
   AUDIO ROOM — TTS reader, playback, multi-voice cast
   ============================================================ */
function splitChunks(text) {
  return text.replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]*/g)?.map((s) => s.trim()).filter(Boolean) || [text];
}

/* ---------- ElevenLabs engine ---------- */
const EL_PRESET_VOICES = [
  { voice_id: "zmGUunyzmFhQdtuFn5L0", name: "Lola L. — soft, sensual, emotional", preset: true },
  { voice_id: "NMq3ryYR81XJKrbAjfbT", name: "Dominic S. — dark, low, deliberate", preset: true },
];
const EL_MODELS = [
  ["eleven_multilingual_v2", "Multilingual v2 — audiobook quality"],
  ["eleven_flash_v2_5", "Flash v2.5 — fast previews, half price"],
];
function chunkForEl(text, max = 2800) {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]*\s*/g) || [text];
  const chunks = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + s).length > max) { chunks.push(cur.trim()); cur = s; } else cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

function AudioRoom({ characters, ctx }) {
  const [text, setText] = useState("");
  const [voices, setVoices] = useState([]);
  const [mode, setMode] = useState("single");
  const [engine, setEngine] = useState("device");
  const [voiceURI, setVoiceURI] = useState("");
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [segments, setSegments] = useState([]);
  const [castMap, setCastMap] = useState({});
  const [nowIdx, setNowIdx] = useState(-1);
  const [busySplit, setBusySplit] = useState(false);
  const [err, setErr] = useState("");
  const cancelRef = useRef(false);
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;

  /* ElevenLabs state — the key lives in memory only, never saved */
  const [elKey, setElKey] = useState("");
  const [elModel, setElModel] = useState("eleven_multilingual_v2");
  const [elVoices, setElVoices] = useState(EL_PRESET_VOICES);
  const [elVoiceId, setElVoiceId] = useState(EL_PRESET_VOICES[0].voice_id);
  const [elCastMap, setElCastMap] = useState({});
  const [elBusy, setElBusy] = useState(false);
  const [elStatus, setElStatus] = useState("");
  const [elBlobs, setElBlobs] = useState([]);
  const [elPlaying, setElPlaying] = useState(false);
  const [elPaused, setElPaused] = useState(false);
  const elCancel = useRef(false);
  const elAudio = useRef(null);

  useEffect(() => {
    if (!synth) return;
    const load = () => {
      const v = synth.getVoices();
      if (v.length) {
        setVoices(v);
        setVoiceURI((cur) => cur || (v.find((x) => x.lang.startsWith("en")) || v[0]).voiceURI);
      }
    };
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => { synth.removeEventListener?.("voiceschanged", load); synth.cancel(); elCancel.current = true; elAudio.current?.pause(); };
  }, []);

  const voiceByURI = (uri) => voices.find((v) => v.voiceURI === uri) || null;

  /* ---------- device engine ---------- */
  const stop = () => {
    cancelRef.current = true;
    synth?.cancel();
    setPlaying(false); setPaused(false); setNowIdx(-1);
  };
  const pauseResume = () => {
    if (!synth) return;
    if (paused) { synth.resume(); setPaused(false); }
    else { synth.pause(); setPaused(true); }
  };
  const runQueue = (items) => {
    if (!synth || !items.length) return;
    stop();
    cancelRef.current = false;
    setPlaying(true);
    let i = 0;
    const next = () => {
      if (cancelRef.current || i >= items.length) {
        if (!cancelRef.current) { setPlaying(false); setNowIdx(-1); }
        return;
      }
      const it = items[i++];
      setNowIdx(it.segIdx);
      const u = new SpeechSynthesisUtterance(it.text);
      if (it.voice) u.voice = it.voice;
      u.rate = rate; u.pitch = pitch;
      u.onend = next;
      u.onerror = next;
      synth.speak(u);
    };
    next();
  };
  const playSingle = () => {
    const v = voiceByURI(voiceURI);
    runQueue(splitChunks(text).map((t) => ({ text: t, voice: v, segIdx: 0 })));
  };
  const playCast = () => {
    const items = [];
    segments.forEach((g, si) => {
      const v = voiceByURI(castMap[g.speaker]) || voiceByURI(castMap["Narrator"]) || voiceByURI(voiceURI);
      splitChunks(g.text).forEach((t) => items.push({ text: t, voice: v, segIdx: si }));
    });
    runQueue(items);
  };
  const preview = (uri, name) => {
    const v = voiceByURI(uri);
    if (!synth || !v) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(name ? `${name}. You wanted to hear how I sound.` : "This is how I sound.");
    u.voice = v; u.rate = rate; u.pitch = pitch;
    synth.speak(u);
  };

  /* ---------- ElevenLabs engine ---------- */
  const elError = (e, status) => {
    if (status === 401) return "ElevenLabs rejected the key — check it and try again.";
    if (status === 402 || status === 403) return "Your ElevenLabs plan doesn't permit this request (tier limit).";
    if (status === 422) return "ElevenLabs couldn't process the text (too long for the model, or validation failed).";
    if (status === 429) return "Hit the plan's concurrency/rate limit — wait a few seconds and try again.";
    if (e && /Failed to fetch|NetworkError/i.test(String(e))) return "Couldn't reach the ElevenLabs relay — check your connection and try again. Device voices still work.";
    return `ElevenLabs error${status ? ` (${status})` : ""} — try again in a moment.`;
  };
  const elFetchVoices = async () => {
    if (!elKey.trim()) return;
    setElBusy(true); setErr(""); setElStatus("Checking the key…");
    try {
      const res = await fetch("/api/eleven?path=voices", { headers: { "x-el-key": elKey.trim() } });
      if (!res.ok) throw Object.assign(new Error("bad"), { status: res.status });
      const data = await res.json();
      const fetched = (data.voices || []).map((v) => ({ voice_id: v.voice_id, name: v.name }));
      const merged = [...EL_PRESET_VOICES];
      fetched.forEach((v) => { if (!merged.some((m) => m.voice_id === v.voice_id)) merged.push(v); });
      setElVoices(merged);
      setElStatus(`Connected — ${merged.length} voices on the roster (Lola L. and Dominic S. pinned).`);
    } catch (e) { setElStatus(""); setErr(elError(e, e.status)); }
    finally { setElBusy(false); }
  };
  const elSynth = async (t, voiceId, prev, next) => {
    const res = await fetch(`/api/eleven?path=${encodeURIComponent(`text-to-speech/${voiceId}`)}&qs=${encodeURIComponent("output_format=mp3_44100_128")}`, {
      method: "POST",
      headers: { "x-el-key": elKey.trim(), "Content-Type": "application/json" },
      body: JSON.stringify({
        text: t,
        model_id: elModel,
        previous_text: prev || undefined,
        next_text: next || undefined,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true },
      }),
    });
    if (!res.ok) throw Object.assign(new Error("tts failed"), { status: res.status });
    return await res.blob();
  };
  const elStop = () => {
    elCancel.current = true;
    elAudio.current?.pause();
    setElPlaying(false); setElPaused(false); setNowIdx(-1);
  };
  const elPauseResume = () => {
    const a = elAudio.current;
    if (!a) return;
    if (elPaused) { a.play(); setElPaused(false); } else { a.pause(); setElPaused(true); }
  };
  const playBlobs = async (items) => {
    elCancel.current = false;
    setElPlaying(true);
    for (const it of items) {
      if (elCancel.current) break;
      setNowIdx(it.segIdx ?? -1);
      const url = URL.createObjectURL(it.blob);
      try {
        await new Promise((resolve) => {
          const a = new Audio(url);
          elAudio.current = a;
          a.onended = resolve;
          a.onerror = resolve;
          a.play().catch(resolve);
        });
      } finally { URL.revokeObjectURL(url); }
    }
    if (!elCancel.current) { setElPlaying(false); setNowIdx(-1); }
  };
  const renderSingle = async () => {
    if (!elKey.trim() || !text.trim()) return;
    setElBusy(true); setErr(""); setElBlobs([]);
    elCancel.current = false;
    try {
      const chunks = chunkForEl(text);
      const items = [];
      for (let i = 0; i < chunks.length; i++) {
        if (elCancel.current) break;
        setElStatus(`Rendering ${i + 1} of ${chunks.length}…`);
        const blob = await elSynth(chunks[i], elVoiceId, chunks[i - 1]?.slice(-250), chunks[i + 1]?.slice(0, 250));
        items.push({ blob, segIdx: 0 });
      }
      setElBlobs(items.map((x) => x.blob));
      setElStatus(`Rendered ${items.length} segment${items.length === 1 ? "" : "s"} — playing.`);
      setElBusy(false);
      await playBlobs(items);
      setElStatus("Done. Download the MP3 below or render again.");
    } catch (e) { setErr(elError(e, e.status)); setElStatus(""); setElBusy(false); }
  };
  const renderCast = async () => {
    if (!elKey.trim() || !segments.length) return;
    setElBusy(true); setErr(""); setElBlobs([]);
    elCancel.current = false;
    try {
      const items = [];
      let done = 0;
      const total = segments.reduce((a, g) => a + chunkForEl(g.text).length, 0);
      for (let si = 0; si < segments.length; si++) {
        const g = segments[si];
        const vid = elCastMap[g.speaker] || elCastMap["Narrator"] || elVoiceId;
        for (const piece of chunkForEl(g.text)) {
          if (elCancel.current) break;
          done++;
          setElStatus(`Rendering ${done} of ${total} — ${g.speaker}…`);
          items.push({ blob: await elSynth(piece, vid), segIdx: si });
        }
        if (elCancel.current) break;
      }
      setElBlobs(items.map((x) => x.blob));
      setElStatus("Table read rendered — playing.");
      setElBusy(false);
      await playBlobs(items);
      setElStatus("Done. Download the MP3 below or render again.");
    } catch (e) { setErr(elError(e, e.status)); setElStatus(""); setElBusy(false); }
  };
  const elPreviewVoice = async (vid, name) => {
    if (!elKey.trim()) return;
    setElBusy(true); setErr("");
    try {
      const blob = await elSynth(`${name ? name + " here. " : ""}This is how I sound in the book.`, vid);
      setElBusy(false);
      await playBlobs([{ blob }]);
    } catch (e) { setErr(elError(e, e.status)); setElBusy(false); }
  };
  const downloadMp3 = () => {
    if (!elBlobs.length) return;
    const full = new Blob(elBlobs, { type: "audio/mpeg" });
    const url = URL.createObjectURL(full);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inksaint-${mode === "cast" ? "table-read" : "narration"}-${new Date().toISOString().slice(0, 10)}.mp3`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const elChars = mode === "cast" ? segments.reduce((a, g) => a + g.text.length, 0) : text.length;
  const flash = elModel.includes("flash");
  const elCost = elChars ? `~${Math.round(elChars * (flash ? 0.5 : 1)).toLocaleString()} credits (≈ $${((elChars / 1000) * (flash ? 0.05 : 0.10)).toFixed(2)} at API rates)` : "";

  const splitVoices = async () => {
    setBusySplit(true); setErr("");
    try {
      const arr = await callClaudeJson(
        `Split this passage into a reading script. Respond ONLY with a JSON array of objects {"speaker": string, "text": string}. Rules: "speaker" is "Narrator" for narration and dialogue tags, or the character's name for their spoken lines (strip the surrounding quotes from dialogue text but keep the words verbatim). Keep every word of the passage, in order. Use the cast names from context to identify speakers where possible.\n\nCast context:\n${ctx}\n\nPASSAGE:\n${text}`,
        { system: "Preserve the author's words exactly; you are segmenting, not editing." }
      );
      if (!Array.isArray(arr) || !arr.length) throw new Error("empty");
      const segs = arr.map((g) => ({ speaker: asStr(g.speaker) || "Narrator", text: asStr(g.text) })).filter((g) => g.text.trim());
      setSegments(segs);
      const covered = segs.reduce((a, g) => a + g.text.length, 0);
      if (covered < text.trim().length * 0.6) setErr("Long passage — this pass covers the opening stretch. Split the text in halves for full coverage.");
    } catch (e) { setErr("The split failed twice — usually a traffic spike. Wait a beat and run it again."); }
    finally { setBusySplit(false); }
  };

  const speakersInScript = useMemo(() => {
    const s = [];
    segments.forEach((g) => { if (!s.includes(g.speaker)) s.push(g.speaker); });
    if (!s.includes("Narrator")) s.unshift("Narrator");
    return s;
  }, [segments]);

  const deviceVoiceOptions = (val, onChange) => (
    <select className="ik-input ik-select" value={val} onChange={onChange}>
      <option value="">— voice —</option>
      {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
    </select>
  );
  const elVoiceOptions = (val, onChange) => (
    <select className="ik-input ik-select" value={val} onChange={onChange}>
      <option value="">— AI voice —</option>
      {elVoices.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.preset ? "★ " : ""}{v.name}</option>)}
    </select>
  );

  return (
    <section>
      <ModuleHead title="Audio Room" blurb="Hear the book. Device voices for instant proofing, or the ElevenLabs cast — Lola L. and Dominic S. are already on the roster — for true AI narration and downloadable MP3s." />
      {!synth && engine === "device" && <p className="ik-note">This device's browser doesn't expose speech voices. Try Chrome, Edge, or Safari — or switch to the ElevenLabs engine.</p>}
      <Field label="Text to read"><Area rows={8} value={text} onChange={(e) => { setText(e.target.value); setSegments([]); stop(); elStop(); setElBlobs([]); }} placeholder="Paste a scene or chapter…" /></Field>
      <div className="ik-actions" style={{ marginTop: 4 }}>
        <GhostButton active={engine === "device"} onClick={() => { setEngine("device"); elStop(); }}>Device voices — free & instant</GhostButton>
        <GhostButton active={engine === "eleven"} onClick={() => { setEngine("eleven"); stop(); }}>ElevenLabs — AI narration</GhostButton>
      </div>
      <div className="ik-actions" style={{ marginTop: 8 }}>
        <GhostButton active={mode === "single"} onClick={() => { setMode("single"); stop(); elStop(); }}>Single voice</GhostButton>
        <GhostButton active={mode === "cast"} onClick={() => { setMode("cast"); stop(); elStop(); }}>Cast of voices</GhostButton>
      </div>

      {engine === "eleven" && (
        <div className="ik-card open" style={{ padding: 16, margin: "14px 0" }}>
          <span className="ik-eyebrow">ElevenLabs engine</span>
          <div className="ik-grid2" style={{ marginTop: 12 }}>
            <Field label="API key" hint="Sent only to this app's own relay, held in memory, never saved. Tip: set ELEVENLABS_API_KEY on the server and this field becomes optional.">
              <TextInput type="password" value={elKey} onChange={(e) => setElKey(e.target.value)} placeholder="xi-…" autoComplete="off" />
            </Field>
            <Field label="Model">
              <select className="ik-input ik-select" value={elModel} onChange={(e) => setElModel(e.target.value)}>
                {EL_MODELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </Field>
          </div>
          <div className="ik-actions" style={{ margin: "4px 0 0" }}>
            <GhostButton onClick={elFetchVoices}>{elBusy && elStatus.startsWith("Checking") ? "Checking…" : "Test connection & fetch my voices"}</GhostButton>
            {elCost && <span className="ik-hint">This render: {elCost}</span>}
          </div>
          {elStatus && <p className="ik-hint" style={{ marginTop: 8 }}>{elStatus}</p>}
        </div>
      )}

      {engine === "device" && (
        <div className="ik-grid2" style={{ marginTop: 14 }}>
          <Field label="Reading speed"><input type="range" className="ik-range" min="0.6" max="1.5" step="0.05" value={rate} onChange={(e) => setRate(+e.target.value)} /><span className="ik-hint">{rate.toFixed(2)}×</span></Field>
          <Field label="Pitch"><input type="range" className="ik-range" min="0.7" max="1.3" step="0.05" value={pitch} onChange={(e) => setPitch(+e.target.value)} /><span className="ik-hint">{pitch.toFixed(2)}</span></Field>
        </div>
      )}

      {mode === "single" && engine === "device" && (
        <>
          <Field label="Voice">{deviceVoiceOptions(voiceURI, (e) => setVoiceURI(e.target.value))}</Field>
          <div className="ik-actions">
            <SealButton disabled={!text.trim() || !voices.length} onClick={playing ? stop : playSingle}>{playing ? "Stop" : "Read it to me"}</SealButton>
            {playing && <GhostButton onClick={pauseResume}>{paused ? "Resume" : "Pause"}</GhostButton>}
            <GhostButton onClick={() => preview(voiceURI)}>Preview voice</GhostButton>
          </div>
        </>
      )}

      {mode === "single" && engine === "eleven" && (
        <>
          <Field label="Narrator voice">{elVoiceOptions(elVoiceId, (e) => setElVoiceId(e.target.value))}</Field>
          <div className="ik-actions">
            <SealButton busy={elBusy} disabled={!text.trim() || !elKey.trim() || !elVoiceId} onClick={elPlaying ? elStop : renderSingle}>{elPlaying ? "Stop" : "Render & play"}</SealButton>
            {elPlaying && <GhostButton onClick={elPauseResume}>{elPaused ? "Resume" : "Pause"}</GhostButton>}
            <GhostButton onClick={() => elPreviewVoice(elVoiceId, elVoices.find((v) => v.voice_id === elVoiceId)?.name?.split("—")[0])}>Preview voice</GhostButton>
            {elBlobs.length > 0 && <GhostButton onClick={downloadMp3}>Download MP3</GhostButton>}
          </div>
          {!elKey.trim() && <p className="ik-empty">Paste your ElevenLabs API key above to unlock the AI cast.</p>}
        </>
      )}

      {mode === "cast" && (
        <>
          <div className="ik-actions">
            <SealButton busy={busySplit} disabled={!text.trim()} onClick={splitVoices}>Split into voices</SealButton>
            {segments.length > 0 && engine === "device" && <SealButton disabled={!voices.length} onClick={playing ? stop : playCast}>{playing ? "Stop" : "Play the table read"}</SealButton>}
            {segments.length > 0 && engine === "eleven" && <SealButton busy={elBusy} disabled={!elKey.trim()} onClick={elPlaying ? elStop : renderCast}>{elPlaying ? "Stop" : "Render the table read"}</SealButton>}
            {engine === "device" && playing && <GhostButton onClick={pauseResume}>{paused ? "Resume" : "Pause"}</GhostButton>}
            {engine === "eleven" && elPlaying && <GhostButton onClick={elPauseResume}>{elPaused ? "Resume" : "Pause"}</GhostButton>}
            {engine === "eleven" && elBlobs.length > 0 && <GhostButton onClick={downloadMp3}>Download MP3</GhostButton>}
          </div>
          {err && <div className="ik-error">{err}</div>}
          {segments.length > 0 && (
            <>
              <Field label="Cast the voices" hint={engine === "eleven" ? "★ Lola L. and Dominic S. are your pinned house voices. Unassigned speakers use the narrator voice." : "Unassigned speakers fall back to the Narrator's voice."}>
                <div className="ik-castlist">
                  {speakersInScript.map((sp) => (
                    <div key={sp} className="ik-castrow">
                      <span className="ik-cast-name">{sp}</span>
                      {engine === "eleven"
                        ? elVoiceOptions(elCastMap[sp] || "", (e) => setElCastMap({ ...elCastMap, [sp]: e.target.value }))
                        : deviceVoiceOptions(castMap[sp] || "", (e) => setCastMap({ ...castMap, [sp]: e.target.value }))}
                      {engine === "eleven"
                        ? <button className="ik-mini" disabled={elBusy || !elKey.trim() || !(elCastMap[sp] || elVoiceId)} onClick={() => elPreviewVoice(elCastMap[sp] || elVoiceId, sp)}>Hear</button>
                        : <button className="ik-mini" onClick={() => preview(castMap[sp] || voiceURI, sp)}>Hear</button>}
                    </div>
                  ))}
                </div>
              </Field>
              <Field label="Reading script">
                <div className="ik-script">
                  {segments.map((g, i) => (
                    <p key={i} className={"ik-seg" + (nowIdx === i ? " now" : "")}>
                      <span className="ik-seg-speaker">{g.speaker}</span>{g.text}
                    </p>
                  ))}
                </div>
              </Field>
            </>
          )}
          {!segments.length && text.trim() && <p className="ik-empty">Split the passage first — the engine identifies who's speaking and hands each line to its voice.</p>}
        </>
      )}
      {mode === "single" && err && <div className="ik-error">{err}</div>}
    </section>
  );
}

/* ============================================================
   WRITING GOALS — daily counts, deadlines, milestone bars
   ============================================================ */
const today = () => new Date().toISOString().slice(0, 10);
const SESSION_COLS = [
  { key: "date", label: "Date", ph: "YYYY-MM-DD", w: ".6fr" },
  { key: "words", label: "Words", type: "num", w: ".45fr" },
  { key: "note", label: "Note", ph: "Ch. 18 drafted" },
];
function Bar({ value, max, label, sub }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="ik-goal">
      <div className="ik-goal-top"><span className="ik-label">{label}</span><span className="ik-goal-num">{value.toLocaleString()} / {max.toLocaleString()}</span></div>
      <div className="ik-bar"><div className="ik-bar-fill" style={{ width: `${pct}%` }} /></div>
      {sub && <span className="ik-hint">{sub}</span>}
    </div>
  );
}
function WritingGoals({ goals, setGoals, profile, ctx }) {
  const gen = useGen();
  const set = (k) => (e) => setGoals({ ...goals, [k]: e.target.value });
  const sessions = goals.sessions;
  const sum = (arr) => arr.reduce((a, s) => a + (parseInt(s.words) || 0), 0);
  const todayWords = sum(sessions.filter((s) => s.date === today()));
  const totalWords = sum(sessions);
  const target = parseInt(goals.dailyTarget) || 0;
  const bookGoal = parseInt((profile.wordGoal || "").replace(/\D/g, "")) || 0;
  const days = [...new Set(sessions.map((s) => s.date).filter(Boolean))];
  const pace = days.length ? Math.round(totalWords / days.length) : 0;
  const daysLeft = goals.deadline ? Math.ceil((new Date(goals.deadline) - new Date()) / 86400000) : null;
  const needPerDay = bookGoal && daysLeft > 0 ? Math.max(0, Math.ceil((bookGoal - totalWords) / daysLeft)) : null;
  const stats = { todayWords, totalWords, target, bookGoal, pace, daysLeft, needPerDay, writingDays: days.length };
  return (
    <section>
      <ModuleHead title="Writing Goals" blurb="The word count doesn't lie. Targets, deadlines, and the pace the deadline actually demands." />
      <div className="ik-grid2">
        <Field label="Daily word target"><TextInput value={goals.dailyTarget} onChange={set("dailyTarget")} placeholder="1500" inputMode="numeric" /></Field>
        <Field label="Project deadline"><TextInput type="date" value={goals.deadline} onChange={set("deadline")} /></Field>
      </div>
      <div className="ik-goalgrid">
        {target > 0 && <Bar value={todayWords} max={target} label="Today" sub={todayWords >= target ? "Target hit. The book noticed." : `${(target - todayWords).toLocaleString()} to go today`} />}
        {bookGoal > 0 && <Bar value={totalWords} max={bookGoal} label={`Manuscript — ${profile.title || "current book"}`} sub={pace ? `Averaging ${pace.toLocaleString()} words per writing day across ${days.length}` : ""} />}
      </div>
      {daysLeft !== null && (
        <p className="ik-note">
          {daysLeft > 0
            ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} to deadline${needPerDay !== null ? ` — that's ${needPerDay.toLocaleString()} words a day from here` : ""}.`
            : daysLeft === 0 ? "Deadline is today." : `Deadline passed ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"} ago — set a new one and keep moving.`}
        </p>
      )}
      <Field label="Session log" hint="The Chapter Studio can log word counts here with one click.">
        <Sheet rows={sessions} setRows={(s) => setGoals({ ...goals, sessions: s })} cols={SESSION_COLS} blank={{ date: today(), words: "", note: "" }} addLabel="Log a session" emptyLine="No sessions logged. Day one starts whenever you say it does." />
      </Field>
      <div className="ik-actions">
        <GhostButton onClick={() => gen.run("Pace check", `You are a straight-talking writing coach for a working dark-romance author. Given these stats, assess the pace honestly — no cheerleading, no doom. Cover: is the deadline realistic at current pace, what daily number actually gets there, where the schedule risk is, and one concrete adjustment. Stats: ${JSON.stringify(stats)}. Recent sessions: ${JSON.stringify(sessions.slice(-14))}\n\nStory context:\n${ctx}`)}>Pace check</GhostButton>
      </div>
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ============================================================
   AGENT MANAGER — six specialist personas + working desk
   ============================================================ */
async function callClaudeChat(messages, system) {
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      system: `${system}\n\n${HOUSE_STYLE}`.trim(),
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "The agent went quiet.");
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

const AGENTS = [
  {
    id: "cowriter", name: "Co-writer", tag: "Drafts beside you",
    desc: "Writes prose in your voice — continues scenes, drafts from beats, offers alternates. Never takes the wheel.",
    sys: "You are the author's co-writer. You draft and continue prose in THEIR established voice, matching POV, rhythm, and heat register exactly. You offer options, not verdicts. When given a beat, you write the scene; when given a scene, you continue it. You never summarize when you could dramatize.",
    quick: [
      ["Continue the scene", "Continue the material I give you (or the current book's opening if none) for 400–600 words in my exact voice."],
      ["Draft from a beat", "Ask me for a one-line beat if I haven't given one, otherwise turn my last message's beat into a 400-word scene."],
      ["Give me 3 alternates", "Take the last passage discussed and rewrite its key moment three different ways: crueler, softer, stranger."],
    ],
  },
  {
    id: "beta", name: "Beta Reader", tag: "Reads like your reader",
    desc: "Reacts as your target dark-romance reader — where they gasp, where they skim, where they'd DNF, what they'd screenshot.",
    sys: "You are a voracious dark-romance beta reader — the author's exact target audience. React emotionally and honestly as a READER, not an editor: where you gasped, where you skimmed, where you'd screenshot a line for the group chat, where you almost put it down, whether the heat and the hurt land. No craft jargon. Reader truth only.",
    quick: [
      ["React to this chapter", "I'll paste a chapter — react to it beat by beat as you read, unfiltered."],
      ["Would I DNF?", "Based on everything you know about this book, tell me the three most likely DNF points for my target reader and why."],
      ["Screenshot lines", "Which moments in this story would readers screenshot and share? If you haven't seen prose yet, tell me which planned beats have that potential."],
    ],
  },
  {
    id: "editor", name: "Editor", tag: "Ruthless, specific",
    desc: "Developmental and line editing — structure, pacing, continuity, and prose surgery with reasons attached.",
    sys: "You are a sharp developmental and line editor for adult dark fiction. You are specific, ruthless, and constructive: every note names the problem, the reason, and the fix. You respect the author's voice and heat level — you make the book more itself, not more polite. You never pad praise.",
    quick: [
      ["Developmental pass", "Give me a developmental edit of what we've discussed or what I paste: structure, stakes, pacing, POV discipline."],
      ["Line edit sample", "I'll paste a page — line edit it: cut, tighten, flag echoes and crutch words, show the edited version."],
      ["Continuity sweep", "Using the story context, list every continuity risk you can see: timeline, character knowledge, physical details."],
    ],
  },
  {
    id: "formatter", name: "Formatter", tag: "Print & ebook clean",
    desc: "Manuscript conventions, KDP/ebook specs, front and back matter, chapter styling, scene-break hygiene.",
    sys: "You are a book formatting specialist for indie publishing (KDP print + ebook). You give exact, current-convention guidance: trim sizes, margins, front/back matter order, chapter opener styling, scene-break marks, copyright page language templates, ebook TOC behavior. Practical, checklist-driven, zero fluff.",
    quick: [
      ["Format checklist", "Give me the full pre-upload formatting checklist for this book, print and ebook."],
      ["Front & back matter", "Draft the complete front and back matter set for this book: title page, copyright, dedication placeholder, also-by, newsletter page, content note."],
      ["Fix my scene breaks", "I'll paste text — normalize the scene breaks and chapter openers to clean convention and show me the rules you applied."],
    ],
  },
  {
    id: "marketer", name: "Marketer", tag: "Positioning & launch",
    desc: "Comps, positioning, ad angles, launch sequencing — sells the book without sanding off its teeth.",
    sys: "You are a romance-market strategist who specializes in dark romance and romantic suspense. You think in comps, tropes-as-hooks, reader promises, and launch math. Every suggestion is concrete: the angle, the asset, the platform, the timing. You never recommend making the book safer to make it easier to sell.",
    quick: [
      ["Position this book", "Give me the positioning: 3 comp titles, the trope stack as marketing hooks, the one-line promise, and the reader avatar."],
      ["Ad angles", "Write 6 ad angles (hook + primary text + CTA) for this book across Meta and TikTok."],
      ["Launch plan", "Build a 6-week launch plan: week by week, assets needed, and what each week is trying to prove."],
    ],
  },
  {
    id: "creator", name: "Content Creator", tag: "BookTok native",
    desc: "Hooks, captions, series content, trend formats — turns the book into a content engine.",
    sys: "You are a BookTok/Bookstagram-native content creator for dark romance authors. You speak reader-to-reader, never ad-speak. You think in hooks, formats, series, and comment-bait. Every idea includes the hook line, the visual, and the caption. You know what makes dark-romance readers stop scrolling: the trope named plainly, the line that hurts, the dare.",
    quick: [
      ["30 days of content", "Build a 30-day content calendar for this book: format, hook, and asset for each post, grouped by week."],
      ["Hooks that stop the scroll", "Write 12 opening hook lines for videos about this book — trope-forward, reader-voice, no ad-speak."],
      ["Quote-card set", "Pick the 6 most postable original character lines from context (or write them in-voice) and give me the visual treatment for each card."],
    ],
  },
];

function AgentDesk({ active, setActive, chats, setChats, ctx, customAgents, setCustomAgents, agentEdits, setAgentEdits }) {
  const allAgents = [
    ...AGENTS,
    ...customAgents.map((c) => ({ ...c, custom: true, quick: [["Brief me", "Introduce yourself in two lines, then tell me the three most useful things you can do for this project right now."]] })),
  ];
  const agent = allAgents.find((a) => a.id === active) || null;
  const sysFor = (a) => (agentEdits[a.id] ?? a.sys);
  const [showInstr, setShowInstr] = useState(false);
  const [deep, setDeep] = useState(false);
  const [newAgent, setNewAgent] = useState(null);
  /* roundtable */
  const [roundSel, setRoundSel] = useState([]);
  const [roundQ, setRoundQ] = useState("");
  const [roundBusy, setRoundBusy] = useState(false);
  const [roundOut, setRoundOut] = useState([]);
  const [roundErr, setRoundErr] = useState("");
  const convene = async () => {
    const team = allAgents.filter((a) => roundSel.includes(a.id));
    if (!team.length || !roundQ.trim()) return;
    setRoundBusy(true); setRoundErr(""); setRoundOut([]);
    const takes = [];
    try {
      for (const a of team) {
        const prior = takes.map((t) => `${t.name} said:\n${t.text}`).join("\n\n");
        const text = await callClaude(
          `The author asks the team: ${roundQ}\n\n${prior ? `The specialists who spoke before you:\n${prior}\n\nAdd your take — agree, disagree, or extend, but earn your seat: bring what only your specialty sees. Keep it under 200 words.` : "You speak first. Give your specialist take in under 200 words."}\n\nStudio context:\n${ctx}`,
          { system: `${sysFor(a)}${deep ? '\nBegin with a one-line "Thinking:" note on your angle, then your take.' : ""}` }
        );
        takes.push({ name: a.name, text });
        setRoundOut([...takes]);
      }
      const synthesis = await callClaude(
        `You are the showrunner of this author's universe. The team debated: "${roundQ}". Their takes:\n\n${takes.map((t) => `${t.name}:\n${t.text}`).join("\n\n")}\n\nSynthesize into a decision: where the team agrees, the one real disagreement that matters, and the recommended move. Under 180 words.`,
        { system: "Decisive, specific, loyal to the author's voice and heat level." }
      );
      setRoundOut([...takes, { name: "Synthesis", text: synthesis }]);
    } catch (e) { setRoundErr("The table broke up early — reconvene in a moment."); }
    finally { setRoundBusy(false); }
  };
  const msgs = (active && chats[active]) || [];
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sparks, setSparks] = useState([]);
  const [busySparks, setBusySparks] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs.length, busy]);
  useEffect(() => { setSparks([]); setErr(""); }, [active]);

  const send = async (text) => {
    const t = (text ?? input).trim();
    if (!t || !agent || busy) return;
    setErr(""); setInput(""); setBusy(true);
    const nextMsgs = [...msgs, { role: "user", content: t }];
    setChats({ ...chats, [agent.id]: nextMsgs });
    try {
      const reply = await callClaudeChat(
        nextMsgs.map((m) => ({ role: m.role, content: m.content })),
        `${sysFor(agent)}${deep ? '\n\nDEEP THINK MODE: begin every reply with a short "Thinking:" section — your actual reasoning steps in 2-4 lines — then "Answer:" with the work.' : ""}\n\nFull studio context for the author's current work:\n${ctx}`
      );
      setChats((c) => ({ ...c, [agent.id]: [...nextMsgs, { role: "assistant", content: reply }].slice(-24) }));
    } catch (e) {
      setErr(e.message);
      setChats((c) => ({ ...c, [agent.id]: msgs }));
      setInput(t);
    } finally { setBusy(false); }
  };

  const spark = async () => {
    if (!agent) return;
    setBusySparks(true); setErr("");
    try {
      const arr = await callClaudeJson(
        `You are the "${agent.name}" agent (${agent.tag}). Based on the author's current studio context, propose 4 sharply specific prompts the author should ask you right now — each under 15 words, referencing their actual book/series/cast where possible. Respond ONLY with a JSON array of 4 strings.\n\nContext:\n${ctx}`
      );
      if (Array.isArray(arr)) setSparks(arr.map(asStr).slice(0, 4));
    } catch (e) { setErr("Sparks fizzled — try again."); }
    finally { setBusySparks(false); }
  };

  return (
    <section>
      <ModuleHead title="Agent Manager" blurb="Six specialists, one desk. Each agent reads your full studio — profile, series, cast, dictionary, content rules — and works in its own lane." />
      <div className="ik-agents">
        {allAgents.map((a) => (
          <button key={a.id} className={"ik-agent" + (active === a.id ? " on" : "")} onClick={() => { setActive(active === a.id ? "" : a.id); setShowInstr(false); }}>
            <span className="ik-agent-name">{a.custom ? "◆ " : ""}{a.name}</span>
            <span className="ik-agent-tag">{a.tag || "custom agent"}</span>
            <span className="ik-agent-desc">{a.desc}</span>
          </button>
        ))}
        <button className="ik-agent" onClick={() => setNewAgent({ name: "", tag: "", desc: "", sys: "" })}>
          <span className="ik-agent-name">+ Forge an agent</span>
          <span className="ik-agent-tag">your specialist</span>
          <span className="ik-agent-desc">Name it, brief it, and it joins the team with your instructions as law.</span>
        </button>
      </div>
      {newAgent && (
        <div className="ik-card open" style={{ padding: 16, marginBottom: 16 }}>
          <span className="ik-eyebrow">Forge an agent</span>
          <div className="ik-grid2" style={{ marginTop: 10 }}>
            <Field label="Name"><TextInput value={newAgent.name} onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })} placeholder="The Archivist" /></Field>
            <Field label="Tag"><TextInput value={newAgent.tag} onChange={(e) => setNewAgent({ ...newAgent, tag: e.target.value })} placeholder="Keeper of the timeline" /></Field>
          </div>
          <Field label="Card description"><TextInput value={newAgent.desc} onChange={(e) => setNewAgent({ ...newAgent, desc: e.target.value })} placeholder="What it does, in one line" /></Field>
          <Field label="Instructions" hint="This becomes the agent's standing orders — persona, duties, hard rules.">
            <Area rows={4} value={newAgent.sys} onChange={(e) => setNewAgent({ ...newAgent, sys: e.target.value })} placeholder="You are… You always… You never…" />
          </Field>
          <div className="ik-actions" style={{ margin: 0 }}>
            <SealButton disabled={!newAgent.name.trim() || !newAgent.sys.trim()} onClick={() => {
              const id = "custom-" + Date.now();
              setCustomAgents([...customAgents, { id, name: newAgent.name.trim(), tag: newAgent.tag.trim(), desc: newAgent.desc.trim(), sys: newAgent.sys.trim() }]);
              setNewAgent(null); setActive(id);
            }}>Bring it to the desk</SealButton>
            <GhostButton onClick={() => setNewAgent(null)}>Cancel</GhostButton>
          </div>
        </div>
      )}
      {agent ? (
        <div className="ik-desk">
          <div className="ik-desk-bar">
            <span className="ik-eyebrow">On the desk: {agent.name}</span>
            <span className="ik-output-actions">
              <button className={"ik-mini" + (deep ? " ik-mini-on" : "")} onClick={() => setDeep(!deep)}>{deep ? "Deep think: on" : "Deep think"}</button>
              <button className={"ik-mini" + (showInstr ? " ik-mini-on" : "")} onClick={() => setShowInstr(!showInstr)}>Instructions</button>
              {agent.custom && <button className="ik-mini" onClick={() => { setCustomAgents(customAgents.filter((c) => c.id !== agent.id)); setActive(""); }}>Retire agent</button>}
              {msgs.length > 0 && <button className="ik-mini" onClick={() => setChats({ ...chats, [agent.id]: [] })}>Clear desk</button>}
            </span>
          </div>
          {showInstr && (
            <div style={{ padding: "12px 16px 0" }}>
              <Field label={`${agent.name}'s standing orders`} hint={agent.custom ? "Edits save to the agent itself." : "Edits override the built-in persona. Reset restores the original."}>
                <Area rows={5} value={sysFor(agent)} onChange={(e) => {
                  if (agent.custom) setCustomAgents(customAgents.map((c) => (c.id === agent.id ? { ...c, sys: e.target.value } : c)));
                  else setAgentEdits({ ...agentEdits, [agent.id]: e.target.value });
                }} />
              </Field>
              {!agent.custom && agentEdits[agent.id] !== undefined && (
                <div className="ik-actions" style={{ margin: "0 0 8px" }}>
                  <GhostButton onClick={() => { const n = { ...agentEdits }; delete n[agent.id]; setAgentEdits(n); }}>Reset to default</GhostButton>
                </div>
              )}
            </div>
          )}
          <div className="ik-quick">
            {agent.quick.map(([label, prompt]) => (
              <button key={label} className="ik-chip" disabled={busy} onClick={() => send(prompt)}>{label}</button>
            ))}
            <button className="ik-chip ik-chip-gold" disabled={busySparks} onClick={spark}>{busySparks ? "Sparking…" : "✦ Spark ideas"}</button>
          </div>
          {sparks.length > 0 && (
            <div className="ik-quick">
              {sparks.map((s, i) => <button key={i} className="ik-chip" onClick={() => { setInput(s); setSparks([]); }}>{s}</button>)}
            </div>
          )}
          <div className="ik-chatlog">
            {!msgs.length && !busy && <p className="ik-empty">The {agent.name.toLowerCase()} is at the desk. Use a quick action, spark ideas, or just talk.</p>}
            {msgs.map((m, i) => (
              <div key={i} className={"ik-msg " + m.role}>
                <span className="ik-seg-speaker">{m.role === "user" ? "You" : agent.name}</span>
                <pre className="ik-msg-text">{m.content}</pre>
              </div>
            ))}
            {busy && <div className="ik-busy"><span className="ik-pulse" /> {agent.name} is working…</div>}
            {err && <div className="ik-error">{err}</div>}
            <div ref={endRef} />
          </div>
          <div className="ik-chatrow">
            <Area rows={3} value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
              placeholder={`Brief the ${agent.name.toLowerCase()} — paste pages, ask questions, give orders… (Ctrl+Enter to send)`} />
            <SealButton busy={busy} disabled={!input.trim()} onClick={() => send()}>Send</SealButton>
          </div>
        </div>
      ) : (
        <p className="ik-empty">Pick an agent to open the desk — or convene the whole table below.</p>
      )}

      <div className="ik-desk" style={{ marginTop: 20 }}>
        <div className="ik-desk-bar">
          <span className="ik-eyebrow">The Roundtable — the team thinks together</span>
          <span className="ik-output-actions">
            <button className={"ik-mini" + (deep ? " ik-mini-on" : "")} onClick={() => setDeep(!deep)}>{deep ? "Deep think: on" : "Deep think"}</button>
          </span>
        </div>
        <div className="ik-quick">
          {allAgents.map((a) => (
            <button key={a.id} className={"ik-chip" + (roundSel.includes(a.id) ? " ik-chip-gold" : "")}
              onClick={() => setRoundSel(roundSel.includes(a.id) ? roundSel.filter((x) => x !== a.id) : [...roundSel, a.id])}>
              {a.name}
            </button>
          ))}
        </div>
        <div style={{ padding: "10px 16px 16px" }}>
          <Field label="Put it to the table">
            <Area rows={2} value={roundQ} onChange={(e) => setRoundQ(e.target.value)} placeholder="Should book 3 open on the betrayal or hold it to the midpoint?" />
          </Field>
          <div className="ik-actions" style={{ margin: 0 }}>
            <SealButton busy={roundBusy} disabled={roundSel.length < 2 || !roundQ.trim()} onClick={convene}>Convene ({roundSel.length} seats)</SealButton>
            {roundSel.length < 2 && <span className="ik-hint">Pick at least two agents.</span>}
          </div>
          {roundErr && <div className="ik-error">{roundErr}</div>}
          {(roundOut.length > 0 || roundBusy) && (
            <div className="ik-chatlog" style={{ marginTop: 12, padding: 0, maxHeight: 460 }}>
              {roundOut.map((t, i) => (
                <div key={i} className={"ik-msg assistant" + (t.name === "Synthesis" ? " ik-synth" : "")}>
                  <span className="ik-seg-speaker">{t.name}</span>
                  <pre className="ik-msg-text">{t.text}</pre>
                </div>
              ))}
              {roundBusy && <div className="ik-busy"><span className="ik-pulse" /> The table is talking…</div>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   HOUSE DICTIONARY — lexicon, prohibited phrases, text scanner
   ============================================================ */
const LEX_COLS = [
  { key: "term", label: "Term", ph: "The Parish", w: ".7fr" },
  { key: "meaning", label: "Meaning / usage rule", ph: "Neutral-ground club in the Quarter; always capitalized, never 'the parish'" },
];
const BAN_COLS = [
  { key: "phrase", label: "Prohibited word / phrase", ph: "breath she didn't know she was holding" },
  { key: "reason", label: "Why it's banned", ph: "Romance cliché — dead on arrival", w: ".8fr" },
];
function HouseDictionary({ dict, setDict, ctx }) {
  const [scanText, setScanText] = useState("");
  const [busyMine, setBusyMine] = useState(false);
  const [mined, setMined] = useState([]);
  const [err, setErr] = useState("");
  const banned = dict.banned.filter((b) => b.phrase.trim());
  const hits = scanText.trim()
    ? banned.map((b) => {
        const re = new RegExp(b.phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        const count = (scanText.match(re) || []).length;
        return { phrase: b.phrase, count };
      }).filter((h) => h.count > 0)
    : [];
  const mine = async () => {
    setBusyMine(true); setErr("");
    try {
      const arr = await callClaudeJson(
        `Read this passage as a cliché hunter for dark romance. Find overused phrases, crutch constructions, and purple-prose tics that appear in the text and deserve a permanent ban. Respond ONLY with a JSON array of objects {"phrase": string (verbatim from the text), "reason": string (short)}. Max 8. Skip anything already banned: ${banned.map((b) => b.phrase).join("; ") || "none"}\n\nPASSAGE:\n${scanText}`
      );
      setMined((Array.isArray(arr) ? arr : []).map((m) => ({ phrase: String(m.phrase || ""), reason: String(m.reason || "") })).filter((m) => m.phrase));
    } catch (e) { setErr("The hunt failed twice — wait a beat and run it again."); }
    finally { setBusyMine(false); }
  };
  return (
    <section>
      <ModuleHead title="House Dictionary" blurb="Your law of language. The lexicon keeps names and terms consistent; the banned list keeps clichés out — every generator obeys both." />
      <Field label="Lexicon — terms, names, spellings" hint="Every generator uses these spellings and meanings.">
        <Sheet rows={dict.lexicon} setRows={(l) => setDict({ ...dict, lexicon: l })} cols={LEX_COLS} blank={{ term: "", meaning: "" }} addLabel="Add a term" emptyLine="No terms yet. Start with the names people keep misspelling." />
      </Field>
      <Field label="Prohibited words & phrases" hint="These never appear in generated prose. Ever.">
        <Sheet rows={dict.banned} setRows={(b) => setDict({ ...dict, banned: b })} cols={BAN_COLS} blank={{ phrase: "", reason: "" }} addLabel="Ban a phrase" emptyLine="The banned list is empty. Optimistic." />
      </Field>
      <Field label="Scan pages against the law" hint="Instant check — flags every banned phrase in the pasted text, plus an AI cliché hunt for new bans.">
        <Area rows={5} value={scanText} onChange={(e) => setScanText(e.target.value)} placeholder="Paste a chapter to check…" />
      </Field>
      {scanText.trim() && (
        hits.length
          ? <div className="ik-note" style={{ borderLeftColor: "#C25B5B" }}>{hits.map((h) => `"${h.phrase}" × ${h.count}`).join(" · ")} — {hits.reduce((a, h) => a + h.count, 0)} violation{hits.reduce((a, h) => a + h.count, 0) === 1 ? "" : "s"} found.</div>
          : banned.length ? <div className="ik-note">Clean. Not one banned phrase on the page.</div> : null
      )}
      <div className="ik-actions">
        <SealButton busy={busyMine} disabled={!scanText.trim()} onClick={mine}>Hunt for new bans</SealButton>
        {mined.length > 1 && <GhostButton onClick={() => { setDict({ ...dict, banned: [...dict.banned, ...mined] }); setMined([]); }}>Ban all {mined.length}</GhostButton>}
      </div>
      {err && <div className="ik-error">{err}</div>}
      {mined.length > 0 && (
        <div className="ik-suggest">
          {mined.map((m, i) => (
            <button key={i} className="ik-chip" title={m.reason} onClick={() => { setDict({ ...dict, banned: [...dict.banned, m] }); setMined(mined.filter((x) => x !== m)); }}>
              ⊘ {m.phrase}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* ============================================================
   KNOWLEDGE EXPLORER — tag tree, mind map, note editor,
   selection linking, search, auto-tagging
   ============================================================ */
const KNOW_CATS = ["Characters", "Lore", "Locations"];
function buildKnowledgeTree(knowledge, characters, universe) {
  const cats = {};
  const add = (cat, name, auto) => {
    if (!name || !name.trim()) return;
    cats[cat] = cats[cat] || [];
    if (!cats[cat].some((e) => e.name.toLowerCase() === name.trim().toLowerCase())) cats[cat].push({ name: name.trim(), auto });
  };
  KNOW_CATS.forEach((c) => (cats[c] = []));
  characters.forEach((c) => add("Characters", c.name, true));
  universe.forEach((u) => add(u.kind === "Location" ? "Locations" : "Lore", u.name, true));
  knowledge.tags.forEach((t) => add(KNOW_CATS.includes(t.cat) ? t.cat : t.cat || "Lore", t.name, false));
  return cats;
}

function KnowledgeExplorer({ knowledge, setKnowledge, characters, universe, series, profile, ctx }) {
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const [selNode, setSelNode] = useState("");
  const [activeNote, setActiveNote] = useState(knowledge.notes.length ? 0 : -1);
  const [selRange, setSelRange] = useState(null);
  const [busyTag, setBusyTag] = useState(false);
  const [tagSugs, setTagSugs] = useState([]);
  const [err, setErr] = useState("");
  const taRef = useRef(null);

  const cats = buildKnowledgeTree(knowledge, characters, universe);
  const match = (e) => !q.trim() || e.name.toLowerCase().includes(q.toLowerCase());

  /* --- markmap-style layout --- */
  const ROW = 24, ROOT_X = 14, CAT_X = 168, ENT_X = 330, W = 620;
  let y = 26;
  const catNodes = [], entryNodes = [];
  Object.entries(cats).forEach(([cat, entries]) => {
    const vis = entries.filter(match);
    if (q.trim() && !vis.length) return;
    const open = !collapsed[cat] && vis.length > 0;
    const h = open ? Math.max(vis.length * ROW, ROW) : ROW;
    catNodes.push({ cat, y: y + h / 2, count: entries.length, open });
    if (open) vis.forEach((e, i) => entryNodes.push({ ...e, cat, y: y + i * ROW + ROW / 2, path: `${cat}/${e.name}` }));
    y += h + 20;
  });
  const H = Math.max(y + 6, 140);
  const rootY = H / 2;
  const rootLabel = series.title || profile.title || "Universe";
  const curve = (x1, y1, x2, y2) => `M ${x1} ${y1} C ${x1 + 46} ${y1}, ${x2 - 46} ${y2}, ${x2} ${y2}`;
  const linksFor = (path) => knowledge.links.filter((l) => l.tag === path);

  /* --- notes --- */
  const notes = knowledge.notes;
  const note = notes[activeNote];
  const setNotes = (n) => setKnowledge({ ...knowledge, notes: n });
  const addNote = () => { setNotes([...notes, { id: String(Date.now()), title: "Untitled note", text: "" }]); setActiveNote(notes.length); };
  const updNote = (k, v) => { const n = notes.slice(); n[activeNote] = { ...n[activeNote], [k]: v }; setNotes(n); };
  const delNote = () => {
    const id = note?.id;
    setKnowledge({ ...knowledge, notes: notes.filter((_, i) => i !== activeNote), links: knowledge.links.filter((l) => l.noteId !== id) });
    setActiveNote(-1);
  };
  const onSelect = () => {
    const el = taRef.current;
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    setSelRange(e > s ? { s, e } : null);
  };
  const linkSelection = () => {
    if (!note || !selNode || !selRange) return;
    const excerpt = note.text.slice(selRange.s, selRange.e).trim().slice(0, 300);
    if (!excerpt) return;
    setKnowledge({ ...knowledge, links: [...knowledge.links, { noteId: note.id, tag: selNode, excerpt }] });
    setSelRange(null);
  };
  const addTag = (cat, name) => {
    if (!name.trim()) return;
    setKnowledge({ ...knowledge, tags: [...knowledge.tags, { cat, name: name.trim() }] });
  };
  const removeTag = (path) => {
    const [cat, ...rest] = path.split("/");
    const name = rest.join("/");
    setKnowledge({
      ...knowledge,
      tags: knowledge.tags.filter((t) => !((t.cat || "Lore") === cat && t.name.toLowerCase() === name.toLowerCase())),
      links: knowledge.links.filter((l) => l.tag !== path),
    });
    if (selNode === path) setSelNode("");
  };
  const [newCat, setNewCat] = useState("Characters");
  const [newName, setNewName] = useState("");

  const autoTag = async () => {
    if (!note?.text.trim()) return;
    setBusyTag(true); setErr("");
    try {
      const existing = Object.entries(cats).flatMap(([c, es]) => es.map((e) => e.name)).join(", ");
      const arr = await callClaudeJson(
        `Scan this note and suggest knowledge entries worth tagging. Respond ONLY with a JSON array of objects {"cat": "Characters"|"Lore"|"Locations", "name": string}. Max 10. Only things that actually appear in the note. Skip existing entries: ${existing || "none"}\n\nNOTE:\n${note.text}`
      );
      setTagSugs((Array.isArray(arr) ? arr : []).map((s) => ({ cat: KNOW_CATS.includes(s.cat) ? s.cat : "Lore", name: asStr(s.name) })).filter((s) => s.name.trim()));
    } catch (e) { setErr("Auto-tagging failed twice — wait a beat and rescan."); }
    finally { setBusyTag(false); }
  };

  const selLinks = selNode ? linksFor(selNode) : [];
  const selIsCustom = selNode && knowledge.tags.some((t) => `${t.cat || "Lore"}/${t.name}` === selNode);

  return (
    <section>
      <ModuleHead title="Knowledge Explorer" blurb="The universe as a living map. Characters and universe entries appear automatically; tag the rest, and pin passages from your notes to any node." />
      <Field label="Search the hierarchy">
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a tag, a name, a place…" />
      </Field>
      <svg className="ik-net" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 720 }} role="img" aria-label="Knowledge mind map">
        {catNodes.map((c) => <path key={c.cat} d={curve(ROOT_X + 8, rootY, CAT_X - 6, c.y)} fill="none" stroke="var(--line)" strokeWidth="1.4" />)}
        {entryNodes.map((e) => {
          const cy = catNodes.find((c) => c.cat === e.cat)?.y || rootY;
          return <path key={e.path} d={curve(CAT_X + 6, cy, ENT_X - 6, e.y)} fill="none" stroke={selNode === e.path ? "var(--gold)" : "var(--line)"} strokeWidth={selNode === e.path ? 1.8 : 1.1} />;
        })}
        <circle cx={ROOT_X + 4} cy={rootY} r="6" fill="var(--wine)" stroke="var(--gold)" strokeWidth="1.2" />
        <text x={ROOT_X + 16} y={rootY + 4} className="ik-net-label" style={{ fill: "var(--parchment)" }}>{rootLabel.slice(0, 22)}</text>
        {catNodes.map((c) => (
          <g key={c.cat} style={{ cursor: "pointer" }} onClick={() => setCollapsed({ ...collapsed, [c.cat]: !collapsed[c.cat] })}>
            <circle cx={CAT_X} cy={c.y} r="5" fill="#181119" stroke="var(--wine)" strokeWidth="1.5" />
            <text x={CAT_X + 12} y={c.y + 4} className="ik-net-label" style={{ fill: "var(--gold)" }}>
              {c.cat} ({c.count}){c.open ? "" : " +"}
            </text>
          </g>
        ))}
        {entryNodes.map((e) => (
          <g key={e.path} style={{ cursor: "pointer" }} onClick={() => setSelNode(selNode === e.path ? "" : e.path)}>
            <title>{`${e.path}${linksFor(e.path).length ? ` — ${linksFor(e.path).length} pinned passage(s)` : ""}${e.auto ? " · from the vault/web" : ""}`}</title>
            <circle cx={ENT_X} cy={e.y} r="4.5" fill={selNode === e.path ? "var(--gold)" : "#181119"} stroke={e.auto ? "var(--faint)" : "var(--gold)"} strokeWidth="1.3" />
            <text x={ENT_X + 11} y={e.y + 4} className="ik-net-label" style={{ fill: selNode === e.path ? "var(--parchment)" : "var(--smoke)" }}>
              {e.name.slice(0, 30)}{linksFor(e.path).length ? ` ·${linksFor(e.path).length}` : ""}
            </text>
          </g>
        ))}
      </svg>
      <div className="ik-actions" style={{ marginTop: 6 }}>
        <Select value={newCat} onChange={(e) => setNewCat(e.target.value)} options={KNOW_CATS} />
        <TextInput value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { addTag(newCat, newName); setNewName(""); } }} placeholder="New tag entry…" style={{ maxWidth: 240 }} />
        <GhostButton onClick={() => { addTag(newCat, newName); setNewName(""); }}>+ Add tag</GhostButton>
        {selIsCustom && <GhostButton onClick={() => removeTag(selNode)}>Remove "{selNode.split("/").slice(1).join("/")}"</GhostButton>}
      </div>

      {selNode && (
        <div className="ik-card open" style={{ padding: 16, marginTop: 8 }}>
          <span className="ik-eyebrow">{selNode}</span>
          {selLinks.length ? (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {selLinks.map((l, i) => (
                <div key={i} className="ik-note" style={{ margin: 0, display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>“{l.excerpt}” <em style={{ color: "var(--faint)" }}>— {notes.find((n) => n.id === l.noteId)?.title || "deleted note"}</em></span>
                  <button className="ik-x" onClick={() => setKnowledge({ ...knowledge, links: knowledge.links.filter((x) => x !== l) })} aria-label="Unpin">×</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="ik-empty" style={{ margin: "8px 0 0" }}>Nothing pinned here yet. Select text in a note below and pin it to this node.</p>
          )}
        </div>
      )}

      <div className="ik-desk" style={{ marginTop: 18 }}>
        <div className="ik-desk-bar">
          <span className="ik-eyebrow">Notes</span>
          <span className="ik-output-actions">
            <button className="ik-mini" onClick={addNote}>+ New note</button>
            {note && <button className="ik-mini" onClick={delNote}>Delete note</button>}
          </span>
        </div>
        {notes.length > 0 && (
          <div className="ik-quick">
            {notes.map((n, i) => (
              <button key={n.id} className={"ik-chip" + (i === activeNote ? " ik-chip-gold" : "")} onClick={() => { setActiveNote(i); setTagSugs([]); }}>{n.title || "Untitled"}</button>
            ))}
          </div>
        )}
        {note ? (
          <div style={{ padding: "12px 16px 16px" }}>
            <Field label="Note title"><TextInput value={note.title} onChange={(e) => updNote("title", e.target.value)} /></Field>
            <Field label="Draft" hint="Select a passage, pick a node on the map, then pin it.">
              <textarea ref={taRef} className="ik-input ik-area" rows={8} value={note.text}
                onChange={(e) => { updNote("text", e.target.value); setSelRange(null); }}
                onSelect={onSelect}
                placeholder="Lore drops, backstory, research, loose scenes…" />
            </Field>
            <div className="ik-actions" style={{ margin: "4px 0 0" }}>
              <SealButton disabled={!selRange || !selNode} onClick={linkSelection}>
                {selNode ? `Pin selection → ${selNode.split("/").slice(1).join("/")}` : "Pick a node on the map to pin to"}
              </SealButton>
              <GhostButton onClick={autoTag} active={false}>{busyTag ? "Scanning…" : "✦ Auto-tag this note"}</GhostButton>
            </div>
            {err && <div className="ik-error">{err}</div>}
            {tagSugs.length > 0 && (
              <div className="ik-suggest">
                {tagSugs.map((s, i) => (
                  <button key={i} className="ik-chip" onClick={() => { addTag(s.cat, s.name); setTagSugs(tagSugs.filter((x) => x !== s)); }}>+ {s.name} <em>{s.cat}</em></button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="ik-empty" style={{ padding: "0 16px 16px" }}>No notes yet. The Explorer works best with pages to mine.</p>
        )}
      </div>
    </section>
  );
}

/* ============================================================
   STORY INTEL — Scene Ledger + Tension Meter, Canon Guard,
   Reveal Manager, Character Memory, Motif Tracker, Chapter Doctor
   ============================================================ */
const LEDGER_COLS = [
  { key: "chapter", label: "Ch.", type: "num", w: ".35fr" },
  { key: "title", label: "Scene", ph: "The dressing room" },
  { key: "location", label: "Location", ph: "The Parish", w: ".7fr" },
  { key: "cast", label: "Cast present", ph: "Lola, Synn", w: ".75fr" },
  { key: "purpose", label: "Purpose / what turns", ph: "Power flips" },
  { key: "conflict", label: "C", type: "num", w: ".28fr" },
  { key: "romance", label: "R", type: "num", w: ".28fr" },
  { key: "threat", label: "T", type: "num", w: ".28fr" },
  { key: "reveal", label: "Rv", type: "num", w: ".28fr" },
  { key: "aftermath", label: "Aftermath", ph: "She stops performing", w: ".8fr" },
];
const BLANK_SCENE = { chapter: "", title: "", location: "", cast: "", purpose: "", conflict: "", romance: "", threat: "", reveal: "", aftermath: "" };
const METER_LINES = [["conflict", "#C25B5B", "Conflict"], ["romance", "#C8A15B", "Romance"], ["threat", "#9A6FB0", "Threat"], ["reveal", "#5E8C7A", "Reveal"]];

function SceneLedger({ ledger, setLedger, ctx }) {
  const gen = useGen();
  const [scoreText, setScoreText] = useState("");
  const [busyScore, setBusyScore] = useState(false);
  const [err, setErr] = useState("");
  const pts = ledger
    .map((s) => ({ ...s, ch: parseFloat(s.chapter) }))
    .filter((s) => s.ch >= 0)
    .sort((a, b) => a.ch - b.ch);
  const maxCh = Math.max(...pts.map((p) => p.ch), 1);
  const X = (ch) => 34 + (ch / maxCh) * 452;
  const Y = (v) => 178 - (Math.min(10, Math.max(0, parseFloat(v) || 0)) / 10) * 148;
  const scoreScene = async () => {
    setBusyScore(true); setErr("");
    try {
      const o = await callClaudeJson(
        `Score this scene as a story analyst. Respond ONLY with a JSON object: {"title": string (short), "conflict": 0-10, "romance": 0-10, "threat": 0-10, "reveal": 0-10, "purpose": string (under 10 words), "aftermath": string (under 10 words)}. Conflict = interpersonal friction; romance = romantic/sexual charge; threat = danger/dread; reveal = new information weight.\n\nStory context:\n${ctx}\n\nSCENE:\n${scoreText}`
      );
      setLedger([...ledger, { ...BLANK_SCENE, title: asStr(o.title), purpose: asStr(o.purpose), aftermath: asStr(o.aftermath), conflict: String(Math.min(10, +o.conflict || 0)), romance: String(Math.min(10, +o.romance || 0)), threat: String(Math.min(10, +o.threat || 0)), reveal: String(Math.min(10, +o.reveal || 0)) }]);
      setScoreText("");
    } catch (e) { setErr("The meter failed twice — wait a beat and score again."); }
    finally { setBusyScore(false); }
  };
  return (
    <section>
      <ModuleHead title="Scene Ledger & Tension Meter" blurb="Every scene scored four ways — conflict, romance, threat, reveal. The meter shows the book's pulse." />
      {pts.length >= 2 && (
        <>
          <svg className="ik-net" viewBox="0 0 520 200" role="img" aria-label="Tension meter across chapters">
            {[0, 5, 10].map((v) => <g key={v}><line x1="34" x2="486" y1={Y(v)} y2={Y(v)} stroke="var(--line)" strokeWidth="1" /><text x="8" y={Y(v) + 4} className="ik-net-label">{v}</text></g>)}
            {METER_LINES.map(([k, color]) => (
              <polyline key={k} points={pts.map((p) => `${X(p.ch)},${Y(p[k])}`).join(" ")} fill="none" stroke={color} strokeWidth="2" opacity="0.9" />
            ))}
            {pts.map((p, i) => <circle key={i} cx={X(p.ch)} cy={Y(p.conflict)} r="3" fill="#C25B5B"><title>{`Ch. ${p.ch} — ${p.title || "scene"}: ${p.purpose || ""}`}</title></circle>)}
          </svg>
          <div className="ik-netlegend">{METER_LINES.map(([k, c, label]) => <span key={k} className="ik-legend-item"><span className="ik-swatch" style={{ background: c }} />{label}</span>)}</div>
        </>
      )}
      <Sheet rows={ledger} setRows={setLedger} cols={LEDGER_COLS} blank={BLANK_SCENE} addLabel="Add a scene" emptyLine="No scenes on the ledger. Score them by hand, or paste one below and let the meter read it." />
      <Field label="Score a pasted scene" hint="The meter reads the scene and adds a scored row — set its chapter after.">
        <Area rows={5} value={scoreText} onChange={(e) => setScoreText(e.target.value)} placeholder="Paste a scene…" />
      </Field>
      <div className="ik-actions">
        <SealButton busy={busyScore} disabled={!scoreText.trim()} onClick={scoreScene}>Read the scene</SealButton>
        <GhostButton onClick={() => gen.run("Pulse critique", `Critique this book's scene pulse. Ledger: ${JSON.stringify(ledger)}. Where do all four lines sag at once? Where does romance spike without conflict earning it? Where should threat and reveal cross? Give a corrected pulse in words.\n\nStory context:\n${ctx}`)}>Critique the pulse</GhostButton>
      </div>
      {err && <div className="ik-error">{err}</div>}
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

function CanonGuard({ ctx, bibles, ledger }) {
  const gen = useGen();
  const extra = `BOOK BIBLES: ${JSON.stringify(bibles)}\nSCENE LEDGER: ${JSON.stringify(ledger)}`;
  return (
    <section>
      <ModuleHead title="Canon Guard" blurb="The continuity enforcer. Reads everything — series map, bibles, cast, universe, scenes — and hunts contradictions." />
      <SmartRow gen={gen} ctx={ctx} extra={extra} tools={[
        ["Full canon sweep", "Audit the entire canon for contradictions: facts stated differently in different places, characters who know things before they learn them, locations whose rules shift, timeline impossibilities. List each as CONTRADICTION → WHERE IT LIVES → THE FIX. If canon is clean, say what's most at risk of breaking next."],
        ["Timeline audit", "Reconstruct the timeline implied by the books, bibles, and scene ledger. Flag every impossibility, tight squeeze, and unexplained gap. Present the corrected timeline."],
        ["Cross-book collisions", "Check every element shared across books (characters, locations, events) for consistency. Flag any detail that contradicts its appearance in another book, and any character whose age, wound, or history drifts."],
        ["Rules of the world", "Extract every implicit rule the canon has established (how the family operates, what the Parish permits, what magic/power costs, who answers to whom). Flag rules stated once and never honored again."],
      ]} />
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

const REVEAL_COLS = [
  { key: "secret", label: "Secret / reveal", ph: "Logan Rowe is alive" },
  { key: "planted", label: "Planted ch.", type: "num", w: ".4fr" },
  { key: "hints", label: "Hints at ch.", ph: "9, 17, 24", w: ".55fr" },
  { key: "revealed", label: "Revealed ch.", type: "num", w: ".45fr" },
  { key: "payoff", label: "Payoff ch.", type: "num", w: ".4fr" },
  { key: "status", label: "Status", type: "select", options: ["Planned", "Planted", "Hinted", "Revealed", "Paid off"], w: ".5fr" },
];
function RevealManager({ reveals, setReveals, ctx, profile }) {
  const gen = useGen();
  const chapters = parseInt(profile.chapters) || 30;
  return (
    <section>
      <ModuleHead title="Reveal Manager" blurb="Secrets are debt. Every one needs a plant, hints, a detonation chapter, and a payoff — tracked so nothing fires early or fizzles." />
      <Sheet rows={reveals} setRows={setReveals} cols={REVEAL_COLS} blank={{ secret: "", planted: "", hints: "", revealed: "", payoff: "", status: "Planned" }} addLabel="Track a reveal" emptyLine="No reveals tracked. A dark book without secrets is just a sad one." />
      <SmartRow gen={gen} ctx={ctx} extra={`REVEAL TRACKER (book is ${chapters} chapters): ${JSON.stringify(reveals)}`} tools={[
        ["Timing audit", "Audit the reveal schedule against the chapter count: where do reveals cluster, where do long stretches go dark, which reveal detonates too early or too late? Give a corrected schedule."],
        ["Missing plants", "For every reveal whose plant or hints are thin, design the plant: the chapter, the disguise (what the scene appears to be about), and the exact detail to seed."],
        ["Spoiler risk scan", "Cross-reference the reveals with the cast and scene ledger: where could a scene accidentally leak a secret before its chapter? List each risk and the guard."],
        ["Payoff pressure", "For each revealed secret, judge the payoff: does the story make the reveal COST something? Flag reveals that land as information instead of damage, and fix each."],
      ]} />
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

function CharacterMemory({ ctx, characters, ledger, bibles, reveals }) {
  const gen = useGen();
  const extra = `CAST: ${JSON.stringify(characters.map((c) => ({ name: c.name, secret: c.secret, role: c.role })))}\nSCENES: ${JSON.stringify(ledger)}\nREVEALS: ${JSON.stringify(reveals)}\nBIBLES: ${JSON.stringify(bibles)}`;
  return (
    <section>
      <ModuleHead title="Character Memory" blurb="Who knows what, and when they learned it. The ledger that stops a character from reacting to a secret they haven't heard yet." />
      {!characters.length && <p className="ik-note">The memory engine works best with a populated vault and scene ledger — it reads both.</p>}
      <SmartRow gen={gen} ctx={ctx} extra={extra} tools={[
        ["Knowledge ledger", "Build the master who-knows-what ledger: for each secret and major fact, list each character's state (KNOWS / SUSPECTS / WRONG ABOUT IT / IGNORANT) and the chapter their state changes. Present as a compact table."],
        ["Contradiction check", "Cross-check the scene ledger against character knowledge: flag every scene where a character acts on information they shouldn't have yet, or fails to act on something they must know."],
        ["Who's lying to whom", "Map the active deceptions: liar → target → the lie → the chapter it's due to collapse. Flag any lie with no collapse scheduled."],
        ["POV blindspots", "For each POV character, list what the reader learns through them versus what they're blind to — and where the gap between reader knowledge and character knowledge creates the best dramatic irony."],
      ]} />
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

const MOTIF_COLS = [
  { key: "name", label: "Motif", ph: "The signed contract", w: ".8fr" },
  { key: "meaning", label: "Symbol meaning", ph: "Consent bought is not consent" },
  { key: "first", label: "First ch.", type: "num", w: ".4fr" },
  { key: "freq", label: "Uses", type: "num", w: ".35fr" },
  { key: "payoff", label: "Payoff scene", ph: "Ch. 48 — she burns it", w: ".7fr" },
];
function MotifTracker({ motifs, setMotifs, ctx }) {
  const gen = useGen();
  const [scanText, setScanText] = useState("");
  const named = motifs.filter((m) => m.name.trim());
  const counts = scanText.trim()
    ? named.map((m) => {
        const re = new RegExp(m.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        return { name: m.name, count: (scanText.match(re) || []).length };
      }).filter((c) => c.count > 0)
    : [];
  const overused = named.filter((m) => (parseInt(m.freq) || 0) >= 8);
  return (
    <section>
      <ModuleHead title="Motif Tracker" blurb="Symbols earn their meaning through placement, not repetition. Track each motif's appearances and its payoff — and get warned before one wears out." />
      <Sheet rows={motifs} setRows={setMotifs} cols={MOTIF_COLS} blank={{ name: "", meaning: "", first: "", freq: "", payoff: "" }} addLabel="Track a motif" emptyLine="No motifs tracked. The book has them whether you track them or not." />
      {overused.length > 0 && (
        <div className="ik-note" style={{ borderLeftColor: "#C25B5B" }}>
          Overuse warning: {overused.map((m) => `"${m.name}" at ${m.freq} uses`).join(" · ")} — past 7, a motif stops whispering and starts nagging.
        </div>
      )}
      <Field label="Count appearances in pasted text" hint="Instant tally of every tracked motif in the passage.">
        <Area rows={4} value={scanText} onChange={(e) => setScanText(e.target.value)} placeholder="Paste chapters to tally…" />
      </Field>
      {counts.length > 0 && <div className="ik-note">{counts.map((c) => `"${c.name}" × ${c.count}`).join(" · ")}</div>}
      <SmartRow gen={gen} ctx={ctx} extra={`MOTIF TRACKER: ${JSON.stringify(motifs)}`} tools={[
        ["Overuse audit", "Judge each tracked motif's frequency against its weight: which are overexposed, which are underplanted, which have drifted from their meaning? Give each a corrected placement plan."],
        ["Payoff check", "For each motif, verify the payoff scene transforms the symbol (it must mean something different at the end than the start). Fix any motif whose payoff merely repeats it."],
        ["Hidden motifs", "Read the story context for motifs the author is already using without tracking — recurring images, objects, phrases. Name them and what they're secretly carrying."],
      ]} />
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

function ChapterDoctor({ ctx, ledger }) {
  const [draft, setDraft] = useState("");
  const gen = useGen();
  const extra = draft.trim() ? `CHAPTER UNDER EXAMINATION:\n${draft}` : `SCENE LEDGER: ${JSON.stringify(ledger)}`;
  return (
    <section>
      <ModuleHead title="Chapter Doctor" blurb="Diagnostic medicine for pages. Paste a chapter for a full workup — or run it on the scene ledger to find the sick chapters before you write them." />
      <Field label="Chapter to examine (optional — without it, the doctor reads the scene ledger)">
        <Area rows={9} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Paste a chapter…" />
      </Field>
      <SmartRow gen={gen} ctx={ctx} extra={extra} tools={[
        ["Full diagnosis", "Run a full diagnostic: weak scenes (nothing changes), missing stakes, flat dialogue, rushed reveals, POV drift, pacing sag. For each finding: SYMPTOM → EVIDENCE → PRESCRIPTION. End with the single highest-leverage fix."],
        ["Stakes check", "Interrogate the stakes: what does the POV character stand to lose in each scene, is it visible on the page, and does it escalate? Flag every scene running on borrowed tension."],
        ["Dialogue autopsy", "Autopsy the dialogue: exchanges that trade information instead of pressure, characters who sound alike, lines doing nothing. Show the worst three exchanges rewritten."],
        ["Reveal pacing", "Examine how information lands: reveals that arrive without setup, setups that never fire, and moments where withholding one more beat would double the impact. Give the corrected sequence."],
        ["Scene triage", "Rank the scenes from strongest to weakest with one line of reasoning each. For the bottom three: cut, combine, or rebuild — and how."],
      ]} />
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ============================================================
   SCENE ARCHITECT — draft builder, write/rewrite,
   heat rewrite + heat-safe filters (honors Content Settings)
   ============================================================ */
function SceneArchitect({ ctx, nsfw }) {
  const gen = useGen();
  const [beats, setBeats] = useState("");
  const [text, setText] = useState("");
  const targets = nsfw.enabled
    ? ["Tension only", "Fade to black", "Sensual", "Steamy", "Explicit", "Book ceiling"]
    : ["Tension only", "Fade to black", "Sensual"];
  const [target, setTarget] = useState("Book ceiling");
  const safeTarget = targets.includes(target) ? target : targets[targets.length - 1];
  return (
    <section>
      <ModuleHead title="Scene Architect" blurb="Build scenes from beats, then move them up or down the heat register without losing the emotion. Every tool obeys Content Settings." />
      {!nsfw.enabled && <p className="ik-note">Content settings are closed-door: the architect builds tension and cuts away. Explicit registers unlock in Content Settings.</p>}
      <div className="ik-grid2">
        <Field label="Beats / premise (for building)"><Area rows={5} value={beats} onChange={(e) => setBeats(e.target.value)} placeholder="Who, where, what shifts, what it costs. Rough beats are enough." /></Field>
        <Field label="Working text (for rewriting)"><Area rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a scene to rework…" /></Field>
      </div>
      <Field label="Target heat register" hint={nsfw.enabled ? "The rewrite filters move scenes to this register — never past your ceiling or hard limits." : "Explicit targets are locked while the studio is closed-door."}>
        <Select value={safeTarget} onChange={(e) => setTarget(e.target.value)} options={targets} />
      </Field>
      <div className="ik-toolgrid">
        <button className="ik-tool" disabled={gen.busy || !beats.trim()} onClick={() => gen.run("Scene draft", `DRAFT BUILDER: Build this scene from the beats — 500–700 words in the book's voice and POV, at the "${safeTarget}" register, honoring the content rules. Lead with emotional charge over choreography; the scene must change something permanent.\n\nBEATS:\n${beats}\n\nStory context:\n${ctx}`)}>Build the scene</button>
        <button className="ik-tool" disabled={gen.busy || !text.trim()} onClick={() => gen.run("Continuation", `Continue this scene for 400–600 words at the "${safeTarget}" register, honoring the content rules. Match voice and POV exactly.\n\nSCENE SO FAR:\n${text}\n\nStory context:\n${ctx}`)}>Continue the scene</button>
        <button className="ik-tool" disabled={gen.busy || !text.trim()} onClick={() => gen.run(`Heat rewrite → ${safeTarget}`, `HEAT REWRITE FILTER: Rewrite this scene at exactly the "${safeTarget}" register, honoring the content rules. Keep every emotional beat, every power shift, every line of dialogue that matters — only the explicitness moves. Same length, same voice.\n\nSCENE:\n${text}\n\nStory context:\n${ctx}`)}>Rewrite at target heat</button>
        <button className="ik-tool" disabled={gen.busy || !text.trim()} onClick={() => gen.run("Heat-safe version", `HEAT-SAFE FILTER: Rewrite this scene fully closed-door — no explicit content at all — while preserving every ounce of tension, want, and consequence. This version must work for a sweet edition or an ARC excerpt and still leave the reader wrecked. Same voice, same POV.\n\nSCENE:\n${text}\n\nStory context:\n${ctx}`)}>Heat-safe filter</button>
        <button className="ik-tool" disabled={gen.busy || !text.trim()} onClick={() => gen.run("Share-safe excerpt", `Extract and polish a 120–160 word share-safe excerpt from this scene for social media: maximum tension and voice, zero explicit content, ends on a line that makes readers demand the book. Give 2 options.\n\nSCENE:\n${text}\n\nStory context:\n${ctx}`)}>Share-safe excerpt</button>
        <button className="ik-tool" disabled={gen.busy || !text.trim()} onClick={() => gen.run("Deepened rewrite", `Rewrite this scene at its current register but with double the interiority: what the body notices, what stays unsaid, what this costs. The heat stays; the emotion under it gets louder. Honor the content rules.\n\nSCENE:\n${text}\n\nStory context:\n${ctx}`)}>Deepen the emotion</button>
      </div>
      {!beats.trim() && !text.trim() && <p className="ik-empty">Give the architect beats to build from, or a scene to rework.</p>}
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ============================================================
   PROJECTS & EXPORT — multi-project saves + JSON/TXT/MD/PDF
   ============================================================ */
function compileBible(s) {
  const sec = [];
  const add = (title, lines) => { const L = lines.filter(Boolean); if (L.length) sec.push({ title, lines: L }); };
  const p = s.profile || {};
  add("Story Profile", [
    p.title && `Title: ${p.title}`, p.genre && `Genre: ${p.genre}`, p.trope && `Core trope: ${p.trope}`,
    p.tone && `Tone: ${p.tone}`, `Heat: ${p.heat}`, p.pov && `POV: ${p.pov}`, `Format: ${p.series}`,
    p.chapters && `Chapters: ${p.chapters}`, p.wordGoal && `Word goal: ${p.wordGoal}`,
    p.reader && `Target reader: ${p.reader}`, p.premise && `Premise: ${p.premise}`,
  ]);
  const se = s.series || {};
  add("Series Map", [
    se.title && `Series: ${se.title}`, se.genreTags && `Genre tags: ${se.genreTags}`,
    se.themeTags && `Theme tags: ${se.themeTags}`, se.toneTags && `Tone tags: ${se.toneTags}`,
    ...(se.books || []).map((b, i) => `Book ${i + 1}: ${b.title || "Untitled"} [${b.status}]${b.hook ? ` — ${b.hook}` : ""}`),
    se.charLinks && `Character links: ${se.charLinks}`, se.locLinks && `Location links: ${se.locLinks}`,
    se.motifLinks && `Motif links: ${se.motifLinks}`, se.timeLinks && `Timeline links: ${se.timeLinks}`,
  ]);
  Object.entries(s.bibles || {}).forEach(([book, b]) => {
    add(`Book Bible — ${book}`, Object.entries(b).map(([k, v]) => v && `${k}: ${v}`));
  });
  (s.characters || []).forEach((c) => {
    add(`Character — ${c.name || "Unnamed"}`, Object.entries(c).map(([k, v]) => v && k !== "name" && `${k}: ${v}`));
  });
  add("Relationships", (s.edges || []).map((e) => `${e.a} —${e.type}→ ${e.b}${e.trust ? ` | trust ${e.trust}` : ""}${e.tension ? ` | tension ${e.tension}` : ""}${e.power ? ` | ${e.power}` : ""}${e.status ? ` [${e.status}]` : ""}`));
  add("Universe Web", (s.universe || []).map((u) => `${u.name} [${u.kind}]${u.books ? ` in ${u.books}` : ""}${u.tags ? ` — ${u.tags}` : ""}`));
  add("Themes", (s.themes || []).map((t) => `${t.name}: ${t.statement || ""}${t.counter ? ` / counter: ${t.counter}` : ""}${t.symbol ? ` / symbol: ${t.symbol}` : ""}${t.payoff ? ` / pays off: ${t.payoff}` : ""}`));
  add("Motifs", (s.motifs || []).map((m) => `${m.name} (${m.meaning || "?"}) — first ch.${m.first || "?"}, ${m.freq || 0} uses, payoff: ${m.payoff || "unset"}`));
  add("Reveals", (s.reveals || []).map((r) => `${r.secret} [${r.status}] planted ${r.planted || "?"} / hints ${r.hints || "—"} / revealed ${r.revealed || "?"} / payoff ${r.payoff || "?"}`));
  add("Scene Ledger", (s.ledger || []).map((x) => `Ch.${x.chapter || "?"} — ${x.title || "scene"}${x.location ? ` @ ${x.location}` : ""}${x.cast ? ` (${x.cast})` : ""} [C${x.conflict || 0}/R${x.romance || 0}/T${x.threat || 0}/Rv${x.reveal || 0}]${x.purpose ? ` — ${x.purpose}` : ""}${x.aftermath ? ` → ${x.aftermath}` : ""}`));
  add("Songs", (s.songs || []).map((t) => `${t.title || "Untitled"} — ${[t.mood, t.tempo, t.pov && `POV ${t.pov}`, t.beat && `scores: ${t.beat}`, t.scene && `scene: ${t.scene}`, t.chorus && `chorus: ${t.chorus}`].filter(Boolean).join("; ")}`));
  add("Intimacy Map", (s.intimacy || []).map((x) => `${x.title || "Scene"} (${x.who || "?"}) ch.${x.chapter || "?"} [${x.ceiling}]${x.purpose ? ` — ${x.purpose}` : ""}${x.consequence ? ` → ${x.consequence}` : ""}`));
  add("House Dictionary", [
    ...((s.dict || {}).lexicon || []).map((l) => l.term && `${l.term} = ${l.meaning || ""}`),
    ...((s.dict || {}).banned || []).map((b) => b.phrase && `BANNED: "${b.phrase}"${b.reason ? ` — ${b.reason}` : ""}`),
  ]);
  add("Knowledge Notes", ((s.knowledge || {}).notes || []).map((n) => `${n.title}: ${n.text}`));
  add("Plot Threads", (s.threads || []).map((t) => `${t.name} [${t.kind}] opens ch.${t.opens || "?"} / turns ${t.turns || "—"} / closes ch.${t.closes || "?"}`));
  add("Emotional Tone Map", (s.tonePts || []).map((p) => `Ch.${p.chapter}: tension ${p.tension}, heat ${p.heat}${p.note ? ` — ${p.note}` : ""}`));
  const g = s.goals || {};
  add("Writing Goals", [
    g.dailyTarget && `Daily target: ${g.dailyTarget} words`, g.deadline && `Deadline: ${g.deadline}`,
    ...((g.sessions || []).map((x) => `${x.date}: ${x.words} words${x.note ? ` — ${x.note}` : ""}`)),
  ]);
  add("Dark Modes", [
    (s.presets || []).length && `Active modes: ${s.presets.join(", ")}`,
    (s.customModes || []).length && `Custom modes: ${s.customModes.join(", ")}`,
  ]);
  add("Custom Agents", (s.customAgents || []).map((a) => `${a.name} (${a.tag || "custom"}): ${a.sys}`));
  add("Writing Desk", (s.docs || []).map((d) => `${d.title}:\n${d.text}`));
  add("Prompt Library", (s.prompts || []).map((p) => `[${p.type}] ${p.text}`));
  return sec;
}
const bibleMd = (name, sec) => `# ${name || "INKSAINT Universe Bible"}\n\n` + sec.map((x) => `## ${x.title}\n\n${x.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n");
const bibleTxt = (name, sec) => `${(name || "INKSAINT UNIVERSE BIBLE").toUpperCase()}\n${"=".repeat(40)}\n\n` + sec.map((x) => `${x.title.toUpperCase()}\n${"-".repeat(x.title.length)}\n${x.lines.join("\n")}`).join("\n\n");
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const bibleHtml = (name, sec) => `<h1>${esc(name || "INKSAINT Universe Bible")}</h1>` + sec.map((x) => `<h2>${esc(x.title)}</h2><ul>${x.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`).join("");

function download(filename, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function ProjectsPanel({ snapshot, applySnapshot, resetStudio, projectName, setProjectName }) {
  const [list, setList] = useState([]);
  const [nameDraft, setNameDraft] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const importRef = useRef(null);
  const INDEX = "inksaint-projects";
  const refresh = async () => {
    try { const r = await appStorage.get(INDEX); setList(r?.value ? JSON.parse(r.value) : []); }
    catch (e) { setList([]); }
  };
  useEffect(() => { refresh(); }, []);
  const writeIndex = async (arr) => { await appStorage.set(INDEX, JSON.stringify(arr)); setList(arr); };
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };
  const saveNew = async () => {
    const name = nameDraft.trim() || snapshot.series?.title || snapshot.profile?.title || "Untitled project";
    setBusy(true);
    try {
      const id = String(Date.now());
      await appStorage.set(`inksaint-project-${id}`, JSON.stringify(snapshot));
      await writeIndex([...list, { id, name, savedAt: new Date().toISOString() }]);
      setProjectName(name); setNameDraft("");
      flash(`Saved "${name}" to the shelf.`);
    } catch (e) { flash("Save failed — try again."); }
    finally { setBusy(false); }
  };
  const overwrite = async (p) => {
    setBusy(true);
    try {
      await appStorage.set(`inksaint-project-${p.id}`, JSON.stringify(snapshot));
      await writeIndex(list.map((x) => (x.id === p.id ? { ...x, savedAt: new Date().toISOString() } : x)));
      setProjectName(p.name);
      flash(`Updated "${p.name}".`);
    } catch (e) { flash("Update failed — try again."); }
    finally { setBusy(false); }
  };
  const loadProj = async (p) => {
    setBusy(true);
    try {
      const r = await appStorage.get(`inksaint-project-${p.id}`);
      if (r?.value) { applySnapshot(JSON.parse(r.value)); setProjectName(p.name); flash(`Loaded "${p.name}" onto the desk.`); }
    } catch (e) { flash("Load failed — try again."); }
    finally { setBusy(false); }
  };
  const delProj = async (p) => {
    setBusy(true);
    try {
      try { await appStorage.delete(`inksaint-project-${p.id}`); } catch (e) {}
      await writeIndex(list.filter((x) => x.id !== p.id));
      flash(`"${p.name}" burned.`);
    } catch (e) { flash("Delete failed — try again."); }
    finally { setBusy(false); }
  };
  const name = projectName || snapshot.series?.title || snapshot.profile?.title || "";
  const sec = compileBible(snapshot);
  const stamp = new Date().toISOString().slice(0, 10);
  const fname = (ext) => `${(name || "inksaint-universe").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "inksaint"}-${stamp}.${ext}`;
  const exportPdf = () => {
    const html = `<!doctype html><html><head><title>${esc(name || "INKSAINT Universe Bible")}</title><style>
      body{font-family:Georgia,serif;color:#1a1418;max-width:760px;margin:40px auto;line-height:1.55;padding:0 24px}
      h1{font-size:26px;border-bottom:2px solid #8E2B3E;padding-bottom:8px}
      h2{font-size:16px;color:#5E1B2B;margin-top:26px;letter-spacing:.04em;text-transform:uppercase}
      ul{padding-left:18px} li{margin:3px 0;font-size:13px}
      @media print{h2{page-break-after:avoid}}
    </style></head><body>${bibleHtml(name, sec)}<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
    else { download(fname("html"), html, "text/html"); flash("Pop-ups blocked — downloaded an HTML file instead. Open it and print to PDF."); }
  };
  return (
    <section>
      <ModuleHead title="Projects & Export" blurb="Shelve whole universes and pull them back down. Export the bible in any format a human or a machine could want." />
      {msg && <p className="ik-note">{msg}</p>}
      <div className="ik-card open" style={{ padding: 18, marginBottom: 16 }}>
        <span className="ik-eyebrow">On the desk now{name ? `: ${name}` : ""}</span>
        <div className="ik-actions" style={{ marginBottom: 0 }}>
          <TextInput value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Project name…" style={{ maxWidth: 280 }} />
          <SealButton busy={busy} onClick={saveNew}>Shelve as new project</SealButton>
          <GhostButton onClick={resetStudio}>Clear the desk (new project)</GhostButton>
          <GhostButton onClick={() => importRef.current?.click()}>Import JSON</GhostButton>
          <input ref={importRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => {
              try { applySnapshot(JSON.parse(String(r.result))); flash("Universe imported onto the desk — shelve it to keep it."); }
              catch (err) { flash("That file wouldn't parse as an INKSAINT export."); }
            };
            r.readAsText(f);
            e.target.value = "";
          }} />
        </div>
        <p className="ik-hint" style={{ margin: "10px 0 0" }}>The desk auto-saves continuously to this browser's local storage. Shelving takes a named snapshot you can always come back to. Local storage is per-device — export JSON from below for backups you can carry anywhere.</p>
      </div>
      <Field label="The shelf">
        {list.length ? (
          <div className="ik-vault">
            {list.map((p) => (
              <div key={p.id} className="ik-card" style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span><span className="ik-card-name">{p.name}</span> <span className="ik-hint">saved {new Date(p.savedAt).toLocaleDateString()}</span></span>
                <span className="ik-output-actions">
                  <button className="ik-mini" disabled={busy} onClick={() => loadProj(p)}>Load</button>
                  <button className="ik-mini" disabled={busy} onClick={() => overwrite(p)}>Overwrite with desk</button>
                  <button className="ik-mini" disabled={busy} onClick={() => delProj(p)}>Delete</button>
                </span>
              </div>
            ))}
          </div>
        ) : <p className="ik-empty">The shelf is empty. Shelve the desk to start your library.</p>}
      </Field>
      <Field label="Export the universe bible" hint="JSON is the full machine-readable studio state; TXT, Markdown and PDF are the compiled human-readable bible.">
        <div className="ik-actions" style={{ margin: 0 }}>
          <GhostButton onClick={() => download(fname("json"), JSON.stringify(snapshot, null, 2), "application/json")}>JSON</GhostButton>
          <GhostButton onClick={() => download(fname("txt"), bibleTxt(name, sec), "text/plain")}>TXT</GhostButton>
          <GhostButton onClick={() => download(fname("md"), bibleMd(name, sec), "text/markdown")}>Markdown</GhostButton>
          <GhostButton onClick={exportPdf}>PDF</GhostButton>
        </div>
      </Field>
    </section>
  );
}

/* ============================================================
   UNIVERSAL SCREEN BAR — copy, export (MD/TXT/JSON), Ask-AI
   on every screen in the studio
   ============================================================ */
const SCREEN_SECTIONS = {
  builder: ["Story Profile"], studio: ["Story Profile"], architect: ["Story Profile"],
  plot: ["Story Profile", "Scene Ledger"], script: ["Story Profile"], songs: ["Songs"],
  audio: ["Story Profile"], modes: ["Dark Modes"], seriesmap: ["Series Map"],
  bible: [/^Book Bible/], universe: ["Universe Web"], interlink: ["Series Map", "Universe Web"],
  knowledge: ["Knowledge Notes"], ledger: ["Scene Ledger"], canon: [/^Book Bible/, "Scene Ledger"],
  reveals: ["Reveals"], memory: ["Reveals", "Scene Ledger"], motifs2: ["Motifs"],
  doctor: ["Scene Ledger"], vault: [/^Character —/], dive: [/^Character —/],
  network: ["Relationships"], matrix: ["Plot Threads"], themes: ["Themes"],
  tonemap: ["Emotional Tone Map"], intimacy: ["Intimacy Map"], dictionary: ["House Dictionary"],
  goals: ["Writing Goals"], agents: ["Custom Agents"], desk: ["Writing Desk"],
  prompts: ["Prompt Library"], projects: null,
};
const SCREEN_JSON = {
  builder: ["profile"], studio: ["profile"], architect: ["profile"], plot: ["profile", "ledger"],
  script: ["profile"], songs: ["songs"], audio: ["profile"], modes: ["presets", "customModes"],
  seriesmap: ["series"], bible: ["bibles"], universe: ["universe"], interlink: ["series", "universe"],
  knowledge: ["knowledge"], ledger: ["ledger"], canon: ["bibles", "ledger"], reveals: ["reveals"],
  memory: ["characters", "ledger", "reveals"], motifs2: ["motifs"], doctor: ["ledger"],
  vault: ["characters"], dive: ["characters"], network: ["edges"], matrix: ["threads"],
  themes: ["themes"], tonemap: ["tonePts"], intimacy: ["intimacy"], dictionary: ["dict"],
  goals: ["goals"], agents: ["customAgents", "agentEdits"], desk: ["docs"], prompts: ["prompts"],
  projects: null,
};
function sectionsFor(active, sec) {
  const spec = SCREEN_SECTIONS[active];
  if (!spec) return sec;
  const out = sec.filter((x) => spec.some((m) => (m instanceof RegExp ? m.test(x.title) : x.title === m)));
  return out.length ? out : sec.filter((x) => x.title === "Story Profile");
}
function ScreenBar({ active, title, snapshot, ctx }) {
  const [copied, setCopied] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [q, setQ] = useState("");
  const gen = useGen();
  const sec = sectionsFor(active, compileBible(snapshot));
  const textOut = bibleTxt(title, sec);
  const jsonSpec = SCREEN_JSON[active];
  const jsonOut = JSON.stringify(jsonSpec ? Object.fromEntries(jsonSpec.map((k) => [k, snapshot[k]])) : snapshot, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  const copy = async () => {
    try { await navigator.clipboard.writeText(textOut); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {}
  };
  const ask = () => {
    if (!q.trim()) return;
    gen.run(`AI — ${title}`, `The author is on the "${title}" screen of their writing studio and asks: ${q}\n\nThis screen's current data:\n${textOut}\n\nFull studio context:\n${ctx}\n\nAnswer them directly and usefully, in their world's terms.`);
  };
  return (
    <div className="ik-screenbar-wrap">
      <div className="ik-screenbar">
        <span className="ik-eyebrow">{title}</span>
        <span className="ik-output-actions">
          <button className="ik-mini" onClick={copy}>{copied ? "Copied" : "Copy screen"}</button>
          <button className="ik-mini" onClick={() => download(`${active}-${stamp}.md`, bibleMd(title, sec), "text/markdown")}>MD</button>
          <button className="ik-mini" onClick={() => download(`${active}-${stamp}.txt`, textOut, "text/plain")}>TXT</button>
          <button className="ik-mini" onClick={() => download(`${active}-${stamp}.json`, jsonOut, "application/json")}>JSON</button>
          <button className={"ik-mini" + (askOpen ? " ik-mini-on" : "")} onClick={() => setAskOpen(!askOpen)}>✦ Ask AI</button>
        </span>
      </div>
      {askOpen && (
        <div className="ik-askrow">
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(); }} placeholder={`Ask anything about ${title.toLowerCase()} — it reads this screen and the whole studio…`} />
          <SealButton busy={gen.busy} disabled={!q.trim()} onClick={ask}>Ask</SealButton>
        </div>
      )}
      {(gen.text || gen.busy || gen.error) && <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />}
    </div>
  );
}

/* ============================================================
   WRITING DESK — the drafting canvas: multi-doc, side-by-side
   AI, spell/grammar, presets, smart tags, upload/download
   ============================================================ */
/* ---------- Markdown + Fountain rendering ---------- */
const escHtml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function mdToHtml(text) {
  const lines = escHtml(text).split("\n");
  let html = "", inList = false, para = [];
  const inline = (s) => s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="ik-mention">$1</span>')
    .replace(/\[@([\w:-]+)\]/g, '<span class="ik-cite">[$1]</span>');
  const flush = () => { if (para.length) { html += `<p>${inline(para.join(" "))}</p>`; para = []; } };
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (!l.trim()) { flush(); closeList(); continue; }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { flush(); closeList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    if (/^(-{3,}|\*{3,})$/.test(l.trim())) { flush(); closeList(); html += "<hr/>"; continue; }
    if (/^>\s?/.test(l)) { flush(); closeList(); html += `<blockquote>${inline(l.replace(/^>\s?/, ""))}</blockquote>`; continue; }
    const li = l.match(/^\s*[-*]\s+(.*)/);
    if (li) { flush(); if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    para.push(l);
  }
  flush(); closeList();
  return html;
}
function parseFountain(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  const isCue = (l) => /^[A-Z][A-Z0-9 .'\-]*(\(.*\))?$/.test(l.trim()) && l.trim().length > 1 && l.trim() === l.trim().toUpperCase() && !/^(INT|EXT|EST|I\/E)[. ]/.test(l.trim());
  while (i < lines.length) {
    const l = lines[i].trimEnd();
    const t = l.trim();
    if (!t) { i++; continue; }
    if (/^(INT|EXT|EST|I\/E)[. ]/i.test(t) || t.startsWith(".")) {
      out.push({ type: "slug", text: t.replace(/^\./, "").toUpperCase() }); i++; continue;
    }
    if (/TO:$/.test(t) || t.startsWith(">")) {
      out.push({ type: "transition", text: t.replace(/^>\s*/, "").toUpperCase() }); i++; continue;
    }
    if (isCue(t) && lines[i + 1] && lines[i + 1].trim()) {
      out.push({ type: "cue", text: t }); i++;
      while (i < lines.length && lines[i].trim()) {
        const d = lines[i].trim();
        out.push({ type: /^\(.*\)$/.test(d) ? "paren" : "dialogue", text: d });
        i++;
      }
      continue;
    }
    out.push({ type: "action", text: t }); i++;
  }
  return out;
}
const FDX_TYPE = { slug: "Scene Heading", action: "Action", cue: "Character", dialogue: "Dialogue", paren: "Parenthetical", transition: "Transition" };
function fountainToFdx(text, title) {
  const paras = parseFountain(text).map((p) =>
    `    <Paragraph Type="${FDX_TYPE[p.type]}"><Text>${escHtml(p.text)}</Text></Paragraph>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<FinalDraft DocumentType="Script" Template="No" Version="3">\n  <Content>\n${paras}\n  </Content>\n  <TitlePage><Content><Paragraph Type="Action"><Text>${escHtml(title || "Untitled")}</Text></Paragraph></Content></TitlePage>\n</FinalDraft>`;
}
/* ---------- BibTeX ---------- */
function parseBib(s) {
  const entries = [];
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\n\s*\}/g;
  let m;
  while ((m = re.exec(s))) {
    const fields = {};
    const fre = /(\w+)\s*=\s*[{"']+([^}"']*)/g;
    let f;
    while ((f = fre.exec(m[3]))) fields[f[1].toLowerCase()] = f[2].trim();
    entries.push({ type: m[1], key: m[2], ...fields });
  }
  return entries;
}
const formatRef = (e) => [e.author, e.year && `(${e.year})`, e.title && `${e.title}.`, e.journal || e.booktitle || e.publisher, e.volume && `vol. ${e.volume}`, e.pages && `pp. ${e.pages}`].filter(Boolean).join(" ");

/* ---------- Templates (Markdown & Fountain) ---------- */
const TEMPLATES = [
  ["Fiction", "Novel chapter", "markdown", "# Chapter __\n\n*POV:* \n\nOpen mid-motion. First image:\n\n---\n\n"],
  ["Fiction", "Scene beat sheet", "markdown", "## SCENE: \n\n- **IN:** \n- **BEAT 1:** \n- **BEAT 2:** \n- **TURN:** \n- **OUT:** \n- **HOOK:** \n"],
  ["Fiction", "Dual-POV scaffold", "markdown", "## — HER —\nWhat she notices first:\nWhat she won't admit:\n\n## — HIM —\nWhat he hides in plain sight:\nThe line he almost says:\n"],
  ["Fiction", "Book blurb", "markdown", "**HOOK LINE**\n\nParagraph 1 — her world, cracked:\n\nParagraph 2 — him, the wrong answer to the right prayer:\n\n*Tropes:* \n*Dare:* \n"],
  ["Fiction", "Series bible page", "markdown", "# Series: \n\n## Promise\n\n## The world in one paragraph\n\n## Books\n- Book 1 — \n- Book 2 — \n"],
  ["Screen", "Screenplay (Fountain)", "fountain", "INT. THE PARISH - NIGHT\n\nSmoke hangs like a held breath. LOLA (20s, armored in velvet) watches the door.\n\nLOLA\n(quiet)\nYou're late.\n\nDOMINIC\nI'm exactly on time for what I came to do.\n\nCUT TO:\n"],
  ["Screen", "Stage play (UK)", "fountain", ".ACT ONE, SCENE ONE\n\nA bare stage. A single chair.\n\nLOLA\nThey tell you the house always wins. They never tell you the house is a person.\n\n"],
  ["Screen", "Podcast news script", "fountain", ".COLD OPEN\n\nHOST\nThree things happened in the Quarter last night. Only one of them made the papers.\n\n.SEGMENT ONE\n\nHOST\nLet's start with the fire.\n"],
  ["Screen", "Radio drama", "fountain", ".SCENE ONE - SOUND: RAIN ON TIN, DISTANT BRASS BAND\n\nNARRATOR\nNew Orleans doesn't keep secrets. It marinates them.\n\nLOLA\n(close to mic)\nDon't turn around.\n"],
  ["Screen", "Musical number (Dramatists Guild)", "fountain", ".NUMBER: \"VELVET & VICE\"\n\nLOLA\n(sung)\nEvery promise in this town has a price tag on the vow—\n\nENSEMBLE\n(sung)\nSigned in synn, signed in synn.\n"],
  ["Academic", "APA paper", "markdown", "# Title\n\n**Author** · Institution · Date\n\n## Abstract\n\n## Introduction\n\n## Method\n\n## Results\n\n## Discussion\n\n## References\n"],
  ["Academic", "MLA paper", "markdown", "Author Name\n\nInstructor · Course · Date\n\n# Title\n\nOpening paragraph with thesis...\n\n## Works Cited\n"],
  ["Academic", "Chicago paper", "markdown", "# Title\n\n*Author — Date*\n\nBody text with footnote markers.[^1]\n\n[^1]: First footnote.\n\n## Bibliography\n"],
  ["Academic", "Journal article", "markdown", "# Title\n\n**Abstract** — \n\n**Keywords:** \n\n## 1. Introduction\n\n## 2. Related Work\n\n## 3. Method\n\n## 4. Results\n\n## 5. Conclusion\n\n## References\n"],
  ["Academic", "Literature review", "markdown", "# Literature Review: \n\n## Scope & method\n\n## Themes in the literature\n\n### Theme 1\n\n### Theme 2\n\n## Gaps\n\n## References\n"],
  ["Academic", "Lab report", "markdown", "# Lab Report: \n\n## Objective\n\n## Materials\n\n## Procedure\n\n## Data\n\n## Analysis\n\n## Conclusion\n"],
  ["Business", "Meeting minutes", "markdown", "# Meeting — \n\n**Date:** · **Attendees:** \n\n## Agenda\n- \n\n## Decisions\n- \n\n## Action items\n- [ ] Owner — task — due\n"],
  ["Business", "Project plan", "markdown", "# Project: \n\n## Goal\n\n## Milestones\n- M1 — \n- M2 — \n\n## Risks\n\n## Timeline\n"],
  ["Business", "Business plan", "markdown", "# Business Plan: \n\n## The problem\n\n## The offer\n\n## Market\n\n## Model\n\n## 12-month plan\n"],
  ["Business", "Letter", "markdown", "Date\n\nDear ,\n\nOpening line that earns the read.\n\nBody.\n\nWith respect,\n\n"],
  ["Business", "Basic slides", "markdown", "# Slide 1 — Title\n\n---\n\n# Slide 2 — The problem\n\n- point\n\n---\n\n# Slide 3 — The turn\n"],
  ["Blog", "Blog post", "markdown", "# Title that dares\n\n*Hook paragraph — one idea, sharpened.*\n\n## The setup\n\n## The turn\n\n## What to do with this\n"],
];

const DESK_TOOLS = [
  ["Continue", "Continue this draft for 300–500 words in the exact same voice, POV, and format (Markdown or Fountain — keep the format's syntax)."],
  ["Tighten", "Tighten this text: cut filler, sharpen verbs, keep the voice and format syntax. Return the edited text only."],
  ["Grammar & spelling", "Correct spelling, grammar, and punctuation ONLY. Do not change voice, word choice, style, deliberate fragments, dialect, or Markdown/Fountain syntax. Return the corrected text only."],
  ["Sensory pass", "Rewrite with grounded sensory specificity layered in. Keep the format syntax. Return the rewritten text only."],
  ["Sharpen dialogue", "Rewrite the dialogue: cut pleasantries, raise subtext, distinct rhythm per speaker. Keep the format syntax. Return the rewritten text only."],
];

function WritingDesk({ docs, setDocs, knowledge, setKnowledge, characters, universe, bib, setBib, ctx }) {
  const [activeDoc, setActiveDoc] = useState(docs.length ? 0 : -1);
  const [selRange, setSelRange] = useState(null);
  const [instr, setInstr] = useState("");
  const [lastTarget, setLastTarget] = useState(null);
  const [applied, setApplied] = useState(false);
  const [tagSugs, setTagSugs] = useState([]);
  const [busyTags, setBusyTags] = useState(false);
  const [tab, setTab] = useState("engine");
  const [findQ, setFindQ] = useState("");
  const [replQ, setReplQ] = useState("");
  const [showFind, setShowFind] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [refKind, setRefKind] = useState("Character");
  const [refIdx, setRefIdx] = useState(0);
  const [commentDraft, setCommentDraft] = useState("");
  const gen = useGen();
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const doc = docs[activeDoc];
  const fmt = doc?.format || "markdown";
  const words = doc?.text.trim() ? doc.text.trim().split(/\s+/).length : 0;
  const versions = doc?.versions || [];
  const comments = doc?.comments || [];

  const setDoc = (patch) => { const n = docs.slice(); n[activeDoc] = { ...n[activeDoc], ...patch }; setDocs(n); };
  const snapshotVersion = (label) => {
    if (!doc) return;
    setDoc({ versions: [...versions, { t: new Date().toISOString(), label, text: doc.text }].slice(-8) });
  };
  const addDoc = (title = "Untitled draft", text = "", format = "markdown") => {
    setDocs([...docs, { id: String(Date.now()), title, text, format, versions: [], comments: [] }]);
    setActiveDoc(docs.length);
  };
  const delDoc = () => { setDocs(docs.filter((_, i) => i !== activeDoc)); setActiveDoc(-1); };
  const onSelect = () => {
    const el = taRef.current;
    if (!el) return;
    setSelRange(el.selectionEnd > el.selectionStart ? { s: el.selectionStart, e: el.selectionEnd } : null);
  };
  const insertAtCursor = (snippet) => {
    if (!doc) return;
    const el = taRef.current;
    const pos = el ? el.selectionStart : doc.text.length;
    setDoc({ text: doc.text.slice(0, pos) + snippet + doc.text.slice(pos) });
  };
  const runTool = (label, instruction) => {
    if (!doc) return;
    const onSel = selRange && selRange.e > selRange.s;
    const target = onSel ? doc.text.slice(selRange.s, selRange.e) : doc.text;
    if (!target.trim()) return;
    setLastTarget(onSel ? { ...selRange } : null);
    setApplied(false);
    gen.run(`${label}${onSel ? " — selection" : ""}`, `${instruction}\n\nStory context:\n${ctx}\n\nTEXT:\n${target}`);
  };
  const applyResult = () => {
    if (!doc || !gen.text) return;
    snapshotVersion("Before AI apply");
    if (lastTarget) setDoc({ text: doc.text.slice(0, lastTarget.s) + gen.text + doc.text.slice(lastTarget.e) });
    else setDoc({ text: gen.text });
    setApplied(true); setSelRange(null);
  };
  const upload = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => addDoc(f.name.replace(/\.(txt|md|markdown|fountain|fdx)$/i, ""), String(r.result || ""), /\.fountain$/i.test(f.name) ? "fountain" : "markdown");
    r.readAsText(f);
    e.target.value = "";
  };
  const smartTags = async () => {
    if (!doc?.text.trim()) return;
    setBusyTags(true);
    try {
      const arr = await callClaudeJson(`Suggest knowledge tags for this draft. Respond ONLY with a JSON array of objects {"cat": "Characters"|"Lore"|"Locations", "name": string}. Max 8. Only things that actually appear.\n\nDRAFT:\n${doc.text}`);
      setTagSugs((Array.isArray(arr) ? arr : []).map((s) => ({ cat: KNOW_CATS.includes(s.cat) ? s.cat : "Lore", name: asStr(s.name) })).filter((s) => s.name.trim()));
    } catch (e) {}
    finally { setBusyTags(false); }
  };
  /* find & replace */
  const findNext = () => {
    if (!doc || !findQ) return;
    const el = taRef.current;
    const from = el ? el.selectionEnd : 0;
    let idx = doc.text.toLowerCase().indexOf(findQ.toLowerCase(), from);
    if (idx < 0) idx = doc.text.toLowerCase().indexOf(findQ.toLowerCase());
    if (idx >= 0 && el) { el.focus(); el.setSelectionRange(idx, idx + findQ.length); setSelRange({ s: idx, e: idx + findQ.length }); }
  };
  const replaceOne = () => {
    if (!doc || !selRange || doc.text.slice(selRange.s, selRange.e).toLowerCase() !== findQ.toLowerCase()) { findNext(); return; }
    setDoc({ text: doc.text.slice(0, selRange.s) + replQ + doc.text.slice(selRange.e) });
    setSelRange(null);
  };
  const replaceAll = () => {
    if (!doc || !findQ) return;
    snapshotVersion("Before replace-all");
    const re = new RegExp(findQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    setDoc({ text: doc.text.replace(re, replQ) });
  };
  const addComment = () => {
    if (!doc || !commentDraft.trim()) return;
    const excerpt = selRange ? doc.text.slice(selRange.s, selRange.e).trim().slice(0, 120) : "";
    setDoc({ comments: [...comments, { id: String(Date.now()), excerpt, note: commentDraft.trim() }] });
    setCommentDraft("");
  };
  const jumpTo = (excerpt) => {
    if (!doc || !excerpt) return;
    const idx = doc.text.indexOf(excerpt);
    const el = taRef.current;
    if (idx >= 0 && el) { el.focus(); el.setSelectionRange(idx, idx + excerpt.length); }
  };
  const mentionables = [...characters.map((c) => c.name), ...universe.map((u) => u.name)].filter(Boolean);
  const bibEntries = parseBib(bib);
  const stampName = (ext) => `${(doc?.title || "draft").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${ext}`;
  const exportHtml = () => {
    const body = fmt === "fountain"
      ? `<div class="scr">${parseFountain(doc.text).map((p) => `<p class="${p.type}">${escHtml(p.text)}</p>`).join("")}</div>`
      : mdToHtml(doc.text);
    download(stampName("html"), `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(doc.title)}</title><style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;line-height:1.6;padding:0 20px}.scr{font-family:'Courier New',monospace}.scr .slug{font-weight:bold;text-transform:uppercase;margin:24px 0 8px}.scr .cue{margin:16px 0 0 200px;text-transform:uppercase}.scr .dialogue{margin:0 120px 0 120px}.scr .paren{margin:0 160px;font-style:italic}.scr .transition{text-align:right;text-transform:uppercase}</style></head><body><h1>${escHtml(doc.title)}</h1>${body}</body></html>`, "text/html");
  };
  const refItems = refKind === "Character" ? characters : refKind === "Universe" ? universe : knowledge.notes;
  const refItem = refItems[Math.min(refIdx, Math.max(refItems.length - 1, 0))];

  const editor = (rows) => (
    <textarea ref={focusMode ? null : taRef} className={"ik-input ik-area ik-canvas" + (fmt === "fountain" ? " ik-mono" : "")} rows={rows} spellCheck={true}
      value={doc.text} onChange={(e) => { setDoc({ text: e.target.value }); setSelRange(null); }} onSelect={onSelect}
      placeholder={fmt === "fountain" ? "INT. LOCATION - NIGHT\n\nAction line.\n\nCHARACTER\nDialogue." : "Write. The desk saves as you go."} />
  );

  return (
    <section>
      <ModuleHead title="Writing Desk" blurb="The canvas — Markdown and Fountain, live preview, versions, comments, citations, and the engine one panel away." />
      <div className="ik-actions" style={{ marginTop: 0 }}>
        <GhostButton onClick={() => addDoc()}>+ New draft</GhostButton>
        <GhostButton onClick={() => fileRef.current?.click()}>Upload .txt / .md / .fountain</GhostButton>
        <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.fountain,text/plain" style={{ display: "none" }} onChange={upload} />
        <Field label="New from template">
          <select className="ik-input ik-select" value="" onChange={(e) => { const t = TEMPLATES.find((x) => `${x[0]}/${x[1]}` === e.target.value); if (t) addDoc(t[1], t[3], t[2]); }}>
            <option value="">— template —</option>
            {["Fiction", "Screen", "Academic", "Business", "Blog"].map((cat) => (
              <optgroup key={cat} label={cat}>
                {TEMPLATES.filter((t) => t[0] === cat).map((t) => <option key={t[1]} value={`${t[0]}/${t[1]}`}>{t[1]}{t[2] === "fountain" ? " (Fountain)" : ""}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
      </div>
      {docs.length > 0 && (
        <div className="ik-quick" style={{ padding: 0, marginBottom: 10 }}>
          {docs.map((d, i) => (
            <button key={d.id} className={"ik-chip" + (i === activeDoc ? " ik-chip-gold" : "")} onClick={() => { setActiveDoc(i); setSelRange(null); setApplied(false); }}>{d.title || "Untitled"}</button>
          ))}
        </div>
      )}
      {doc ? (
        <div className="ik-deskgrid">
          <div>
            <div className="ik-grid2">
              <Field label="Title"><TextInput value={doc.title} onChange={(e) => setDoc({ title: e.target.value })} /></Field>
              <Field label="Format"><Select value={fmt} onChange={(e) => setDoc({ format: e.target.value })} options={["markdown", "fountain"]} /></Field>
            </div>
            <div className="ik-actions" style={{ margin: "0 0 8px" }}>
              <button className={"ik-mini" + (showFind ? " ik-mini-on" : "")} onClick={() => setShowFind(!showFind)}>Find & replace</button>
              <button className="ik-mini" onClick={() => setFocusMode(true)}>Typewriter mode</button>
              <button className="ik-mini" onClick={() => snapshotVersion("Manual snapshot")}>Snapshot version</button>
              {mentionables.length > 0 && (
                <select className="ik-input ik-select" style={{ maxWidth: 180, padding: "4px 8px", fontSize: 12 }} value="" onChange={(e) => { if (e.target.value) insertAtCursor(`[[${e.target.value}]]`); }}>
                  <option value="">@ mention…</option>
                  {mentionables.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
            </div>
            {showFind && (
              <div className="ik-actions" style={{ margin: "0 0 8px" }}>
                <TextInput value={findQ} onChange={(e) => setFindQ(e.target.value)} placeholder="Find…" style={{ maxWidth: 170 }} />
                <TextInput value={replQ} onChange={(e) => setReplQ(e.target.value)} placeholder="Replace with…" style={{ maxWidth: 170 }} />
                <button className="ik-mini" onClick={findNext}>Next</button>
                <button className="ik-mini" onClick={replaceOne}>Replace</button>
                <button className="ik-mini" onClick={replaceAll}>Replace all</button>
              </div>
            )}
            <Field label="Draft" hint="Select a passage to run tools on just that stretch. Native spell-check is on.">
              {editor(20)}
            </Field>
            <div className="ik-wordbar">
              <span>{words.toLocaleString()} words{selRange ? ` · ${doc.text.slice(selRange.s, selRange.e).trim().split(/\s+/).filter(Boolean).length} selected` : ""} · auto-saved</span>
              <span className="ik-output-actions">
                <button className="ik-mini" onClick={() => download(stampName(fmt === "fountain" ? "fountain" : "md"), doc.text, "text/plain")}>{fmt === "fountain" ? ".fountain" : ".md"}</button>
                <button className="ik-mini" onClick={() => download(stampName("txt"), doc.text, "text/plain")}>.txt</button>
                <button className="ik-mini" onClick={exportHtml}>.html</button>
                {fmt === "fountain" && <button className="ik-mini" onClick={() => download(stampName("fdx"), fountainToFdx(doc.text, doc.title), "application/xml")}>.fdx</button>}
                <button className="ik-mini" onClick={delDoc}>Delete draft</button>
              </span>
            </div>
          </div>
          <div>
            <div className="ik-quick" style={{ padding: 0, marginBottom: 10 }}>
              {[["engine", "Engine"], ["preview", "Preview"], ["reference", "Reference"], ["history", `History (${versions.length})`], ["comments", `Comments (${comments.length})`], ["cite", "Cite"]].map(([id, label]) => (
                <button key={id} className={"ik-chip" + (tab === id ? " ik-chip-gold" : "")} onClick={() => setTab(id)}>{label}</button>
              ))}
            </div>
            {tab === "engine" && (
              <>
                <Field label={`Engine — works on ${selRange ? "the selection" : "the whole draft"}`}>
                  <div className="ik-quick" style={{ padding: 0 }}>
                    {DESK_TOOLS.map(([label, instruction]) => (
                      <button key={label} className="ik-chip" disabled={gen.busy || !doc.text.trim()} onClick={() => runTool(label, instruction)}>{label}</button>
                    ))}
                    <button className="ik-chip" disabled={busyTags || !doc.text.trim()} onClick={smartTags}>{busyTags ? "Tagging…" : "✦ Smart tags"}</button>
                    {selRange && <>
                      <button className="ik-chip" disabled={gen.busy} onClick={() => runTool("Define", "Define this word or phrase precisely, then give usage notes and register. Under 80 words.")}>Define</button>
                      <button className="ik-chip" disabled={gen.busy} onClick={() => runTool("Synonyms", "Give 12 synonyms/near-synonyms grouped by register (formal, neutral, raw). No definitions.")}>Thesaurus</button>
                      <button className="ik-chip" disabled={gen.busy} onClick={() => runTool("Rhymes", "Give perfect rhymes, slant rhymes, and multisyllabic rhymes for this, grouped. Lyric-usable.")}>Rhymes</button>
                    </>}
                  </div>
                </Field>
                {tagSugs.length > 0 && (
                  <div className="ik-suggest">
                    {tagSugs.map((s, i) => (
                      <button key={i} className="ik-chip" onClick={() => { setKnowledge({ ...knowledge, tags: [...knowledge.tags, s] }); setTagSugs(tagSugs.filter((x) => x !== s)); }}>+ {s.name} <em>{s.cat}</em></button>
                    ))}
                  </div>
                )}
                <Field label="AI instruction">
                  <Area rows={2} value={instr} onChange={(e) => setInstr(e.target.value)} placeholder='"Rewrite in Dominic\u2019s POV", "convert this scene to Fountain", "turn this into beats"…' />
                </Field>
                <div className="ik-actions" style={{ margin: "0 0 8px" }}>
                  <SealButton busy={gen.busy} disabled={!instr.trim() || !doc.text.trim()} onClick={() => runTool("Custom instruction", `Follow the author's instruction exactly: ${instr}. Return only the resulting text.`)}>Run instruction</SealButton>
                  {gen.text && !applied && <GhostButton onClick={applyResult}>{lastTarget ? "Apply to selection" : "Apply to draft"}</GhostButton>}
                  {applied && <span className="ik-hint">Applied — previous version snapshotted.</span>}
                </div>
                <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
              </>
            )}
            {tab === "preview" && (
              <Field label={`Live preview — ${fmt}`}>
                {fmt === "fountain" ? (
                  <div className="ik-previewbox ik-scr">
                    {parseFountain(doc.text).map((p, i) => <p key={i} className={"scr-" + p.type}>{p.text}</p>)}
                  </div>
                ) : (
                  <div className="ik-previewbox ik-md" dangerouslySetInnerHTML={{ __html: mdToHtml(doc.text) }} />
                )}
              </Field>
            )}
            {tab === "reference" && (
              <>
                <div className="ik-actions" style={{ marginTop: 0 }}>
                  <Select value={refKind} onChange={(e) => { setRefKind(e.target.value); setRefIdx(0); }} options={["Character", "Universe", "Notes"]} />
                  {refItems.length > 0 && (
                    <PickSelect value={Math.min(refIdx, refItems.length - 1)} onChange={(e) => setRefIdx(Number(e.target.value))} labels={refItems.map((r, i) => r.name || r.title || `Item ${i + 1}`)} />
                  )}
                </div>
                {refItem ? (
                  <div className="ik-previewbox">
                    {refKind === "Character" && CHAR_FIELDS.map(([k, label]) => refItem[k] && <p key={k}><strong className="ik-seg-speaker">{label}</strong>{refItem[k]}</p>)}
                    {refKind === "Universe" && <><p><strong className="ik-seg-speaker">{refItem.kind}</strong>{refItem.name}</p><p>{refItem.tags}</p><p className="ik-hint">Appears in: {refItem.books || "—"}</p></>}
                    {refKind === "Notes" && <><p className="ik-seg-speaker">{refItem.title}</p><p style={{ whiteSpace: "pre-wrap" }}>{refItem.text}</p></>}
                  </div>
                ) : <p className="ik-empty">Nothing to reference yet.</p>}
              </>
            )}
            {tab === "history" && (
              versions.length ? (
                <div className="ik-vault">
                  {versions.slice().reverse().map((v, i) => (
                    <div key={i} className="ik-card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span className="ik-hint">{v.label} · {new Date(v.t).toLocaleString()} · {v.text.trim().split(/\s+/).filter(Boolean).length} words</span>
                      <button className="ik-mini" onClick={() => { snapshotVersion("Before restore"); setDoc({ text: v.text }); }}>Restore</button>
                    </div>
                  ))}
                </div>
              ) : <p className="ik-empty">No versions yet. The desk snapshots automatically before every AI apply and replace-all.</p>
            )}
            {tab === "comments" && (
              <>
                <Field label={selRange ? "Comment on the selection" : "General comment"}>
                  <Area rows={2} value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Fix this in draft 2…" />
                </Field>
                <div className="ik-actions" style={{ margin: "0 0 10px" }}>
                  <GhostButton onClick={addComment}>+ Add comment</GhostButton>
                </div>
                {comments.length ? (
                  <div className="ik-vault">
                    {comments.map((c) => (
                      <div key={c.id} className="ik-card" style={{ padding: "10px 14px" }}>
                        {c.excerpt && <button className="ik-mini" style={{ marginBottom: 6 }} onClick={() => jumpTo(c.excerpt)}>“{c.excerpt.slice(0, 60)}…”</button>}
                        <p style={{ margin: 0, display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <span>{c.note}</span>
                          <button className="ik-x" onClick={() => setDoc({ comments: comments.filter((x) => x.id !== c.id) })} aria-label="Delete comment">×</button>
                        </p>
                      </div>
                    ))}
                  </div>
                ) : <p className="ik-empty">No comments on this draft.</p>}
              </>
            )}
            {tab === "cite" && (
              <>
                <Field label="BibTeX library" hint="Paste BibTeX entries; they parse instantly. Shared across all drafts.">
                  <Area rows={5} value={bib} onChange={(e) => setBib(e.target.value)} placeholder={"@book{synn2026,\n  author = {Nxus},\n  title = {Signed in Synn},\n  year = {2026}\n}"} />
                </Field>
                {bibEntries.length ? (
                  <div className="ik-vault">
                    {bibEntries.map((e) => (
                      <div key={e.key} className="ik-card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ flex: "1 1 220px" }}><span className="ik-seg-speaker">{e.key}</span>{formatRef(e)}</span>
                        <button className="ik-mini" onClick={() => insertAtCursor(`[@${e.key}]`)}>Insert citation</button>
                      </div>
                    ))}
                    <div className="ik-actions" style={{ margin: 0 }}>
                      <GhostButton onClick={() => setDoc({ text: doc.text + "\n\n## References\n\n" + bibEntries.map((e) => `- ${formatRef(e)}`).join("\n") + "\n" })}>Append references list</GhostButton>
                    </div>
                  </div>
                ) : <p className="ik-empty">No parseable entries yet.</p>}
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="ik-empty">No drafts on the desk. Start one, upload one, or open a template.</p>
      )}
      {focusMode && doc && (
        <div className="ik-focusov">
          <div className="ik-focushead">
            <span className="ik-eyebrow">{doc.title} — typewriter mode</span>
            <button className="ik-mini" onClick={() => setFocusMode(false)}>Esc — back to the desk</button>
          </div>
          <textarea ref={taRef} className={"ik-focused" + (fmt === "fountain" ? " ik-mono" : "")} spellCheck={true} autoFocus
            value={doc.text} onChange={(e) => setDoc({ text: e.target.value })} onSelect={onSelect}
            onKeyDown={(e) => { if (e.key === "Escape") setFocusMode(false); }} />
          <p className="ik-hint" style={{ textAlign: "center", margin: "8px 0 0" }}>{words.toLocaleString()} words · auto-saved</p>
        </div>
      )}
    </section>
  );
}

/* ============================================================
   PROMPT FORGE — writing prompt generator + storage library
   ============================================================ */
const PROMPT_TYPES = ["Scene spark", "Chapter opener", "Trope twist", "Dialogue duel", "Dark what-if", "Villain logic", "Song seed", "Intimacy tension"];
function PromptForge({ prompts, setPrompts, ctx, sendToDesk }) {
  const [type, setType] = useState(PROMPT_TYPES[0]);
  const [fresh, setFresh] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const forge = async () => {
    setBusy(true); setErr("");
    try {
      const arr = await callClaudeJson(
        `Forge 5 original "${type}" writing prompts for this author's world — dark romance / suspense register, specific to their series, cast, and modes where possible. Each under 40 words, each a dare, none generic. Respond ONLY with a JSON array of 5 strings.\n\nStory context:\n${ctx}`
      );
      setFresh((Array.isArray(arr) ? arr : []).map(asStr).filter(Boolean).slice(0, 5));
    } catch (e) { setErr("The forge failed twice — wait a beat and strike again."); }
    finally { setBusy(false); }
  };
  const save = (text) => { setPrompts([...prompts, { id: String(Date.now() + Math.random()), type, text }]); setFresh(fresh.filter((f) => f !== text)); };
  return (
    <section>
      <ModuleHead title="Prompt Forge" blurb="Dares, not prompts. Forged from your actual universe — save the ones that draw blood." />
      <div className="ik-actions" style={{ marginTop: 0 }}>
        <Field label="Prompt type"><Select value={type} onChange={(e) => setType(e.target.value)} options={PROMPT_TYPES} /></Field>
        <SealButton busy={busy} onClick={forge}>Strike the forge</SealButton>
      </div>
      {err && <div className="ik-error">{err}</div>}
      {fresh.length > 0 && (
        <div className="ik-vault" style={{ marginBottom: 18 }}>
          {fresh.map((f, i) => (
            <div key={i} className="ik-card" style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 260px" }}>{f}</span>
              <span className="ik-output-actions">
                <button className="ik-mini" onClick={() => save(f)}>Save to library</button>
                <button className="ik-mini" onClick={() => sendToDesk(`${type}: ${f}`, f)}>Write it</button>
              </span>
            </div>
          ))}
        </div>
      )}
      <Field label={`Prompt library (${prompts.length})`}>
        {prompts.length ? (
          <div className="ik-vault">
            {prompts.map((p) => (
              <div key={p.id} className="ik-card" style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ flex: "1 1 260px" }}><span className="ik-seg-speaker">{p.type}</span>{p.text}</span>
                <span className="ik-output-actions">
                  <button className="ik-mini" onClick={() => navigator.clipboard?.writeText(p.text)}>Copy</button>
                  <button className="ik-mini" onClick={() => sendToDesk(`${p.type}: ${p.text}`, p.text)}>Write it</button>
                  <button className="ik-mini" onClick={() => setPrompts(prompts.filter((x) => x.id !== p.id))}>Delete</button>
                </span>
              </div>
            ))}
          </div>
        ) : <p className="ik-empty">The library is empty. Forge something worth keeping.</p>}
      </Field>
    </section>
  );
}

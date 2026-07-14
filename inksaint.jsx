import { useState, useRef, useEffect } from "react";

/* ============================================================
   INKSAINT — a dark fiction command center
   Story Builder · Character Vault · Plot Engine · Chapter Studio
   Dark Modes · Publishing Toolkit — every generator runs on Claude
   ============================================================ */

const HOUSE_STYLE = `HOUSE STYLE (non-negotiable): Humanized dialogue and inner monologue written as fragments, not literary reflection. No purple prose, no overused romance phrasing ("breath she didn't know she was holding," "electricity," "shattered," etc). Grounded sensory specificity over scenic sweep. Voice-forward, contemporary, adult. Never soften the requested heat level.`;

async function callClaude(prompt, { system = "", maxLen = 1000 } = {}) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
      system: `${system}\n\n${HOUSE_STYLE}`.trim(),
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "The engine stalled.");
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function stripFences(text) {
  return text.replace(/```json|```/g, "").trim();
}

/* ---------- shared context ---------- */
function buildContext(profile, presets, characters) {
  const p = profile;
  const lines = [
    p.title && `Title: ${p.title}`,
    p.genre && `Genre: ${p.genre}`,
    p.trope && `Core trope: ${p.trope}`,
    p.tone && `Tone: ${p.tone}`,
    `Heat level: ${p.heat}`,
    p.pov && `POV: ${p.pov}`,
    p.chapters && `Chapter count: ${p.chapters}`,
    p.wordGoal && `Word count goal: ${p.wordGoal}`,
    p.reader && `Target reader: ${p.reader}`,
    `Format: ${p.series}`,
    p.premise && `Working premise: ${p.premise}`,
  ].filter(Boolean);
  if (presets.length) lines.push(`Active dark-mode presets: ${presets.join(", ")}`);
  if (characters.length) {
    lines.push(
      "Cast: " +
        characters
          .map((c) => `${c.name || "Unnamed"} (${c.role || "role tbd"} — goal: ${c.goal || "?"}; wound: ${c.wound || "?"})`)
          .join(" | ")
    );
  }
  return lines.join("\n");
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

function TextInput(props) {
  return <input className="ik-input" {...props} />;
}

function Select({ options, ...props }) {
  return (
    <select className="ik-input ik-select" {...props}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

const FLAMES = ["Sweet", "Sensual", "Steamy", "Explicit", "Dark / Explicit"];
function HeatDial({ value, onChange }) {
  const idx = FLAMES.indexOf(value);
  return (
    <div className="ik-heat" role="radiogroup" aria-label="Heat level">
      {FLAMES.map((f, i) => (
        <button
          key={f}
          type="button"
          role="radio"
          aria-checked={value === f}
          className={"ik-flame" + (i <= idx ? " lit" : "")}
          onClick={() => onChange(f)}
          title={f}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M12 2c1 4-4 5.5-4 10a4.5 4.5 0 0 0 9 0c0-2-1-3.4-2-4.6-.3 1.2-1 2-2 2.4.6-2.6-.2-5.6-1-7.8z"
              fill={i <= idx ? "url(#fl)" : "none"}
              stroke={i <= idx ? "none" : "var(--faint)"}
              strokeWidth="1.4"
            />
          </svg>
        </button>
      ))}
      <svg width="0" height="0" aria-hidden="true">
        <defs>
          <linearGradient id="fl" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#8E2B3E" />
            <stop offset="1" stopColor="#C8A15B" />
          </linearGradient>
        </defs>
      </svg>
      <span className="ik-heat-name">{value}</span>
    </div>
  );
}

function SealButton({ onClick, children, busy, disabled }) {
  return (
    <button className="ik-seal" onClick={onClick} disabled={busy || disabled}>
      {busy ? "Working…" : children}
    </button>
  );
}

function GhostButton({ onClick, children, active }) {
  return (
    <button className={"ik-ghost" + (active ? " on" : "")} onClick={onClick}>
      {children}
    </button>
  );
}

function Output({ title, text, busy, error, onClear }) {
  const [copied, setCopied] = useState(false);
  if (!text && !busy && !error) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (e) {}
  };
  return (
    <div className="ik-output">
      <div className="ik-output-bar">
        <span className="ik-eyebrow">{title}</span>
        <span className="ik-output-actions">
          {text && (
            <button className="ik-mini" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          {(text || error) && (
            <button className="ik-mini" onClick={onClear}>
              Clear
            </button>
          )}
        </span>
      </div>
      {busy && (
        <div className="ik-busy">
          <span className="ik-pulse" /> The ink is still wet…
        </div>
      )}
      {error && <div className="ik-error">{error} — try again.</div>}
      {text && <pre className="ik-prose">{text}</pre>}
    </div>
  );
}

/* ---------- generator hook ---------- */
function useGen() {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [label, setLabel] = useState("Output");
  const run = async (title, prompt, opts) => {
    setBusy(true);
    setError("");
    setText("");
    setLabel(title);
    try {
      const out = await callClaude(prompt, opts);
      setText(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const clear = () => {
    setText("");
    setError("");
  };
  return { busy, text, error, label, run, clear };
}

/* ============================================================
   MODULE — Story Builder
   ============================================================ */
function StoryBuilder({ profile, setProfile, ctx }) {
  const gen = useGen();
  const set = (k) => (e) => setProfile({ ...profile, [k]: e.target.value });
  return (
    <section>
      <ModuleHead
        title="Story Builder"
        blurb="Set the terms of the book once. Every engine downstream reads from this page."
      />
      <div className="ik-grid2">
        <Field label="Story title">
          <TextInput value={profile.title} onChange={set("title")} placeholder="Signed in Synn" />
        </Field>
        <Field label="Genre">
          <TextInput value={profile.genre} onChange={set("genre")} placeholder="Dark romance / crime thriller" />
        </Field>
        <Field label="Core trope">
          <TextInput value={profile.trope} onChange={set("trope")} placeholder="Forbidden protection" />
        </Field>
        <Field label="Tone">
          <TextInput value={profile.tone} onChange={set("tone")} placeholder="Velvet menace, slow-bleed tension" />
        </Field>
        <Field label="POV">
          <Select
            value={profile.pov}
            onChange={set("pov")}
            options={["Dual first person", "Rotating multi-first", "Single first person", "Third limited", "Third — multi POV"]}
          />
        </Field>
        <Field label="Series or standalone">
          <Select value={profile.series} onChange={set("series")} options={["Standalone", "Series opener", "Mid-series entry", "Series finale", "Interconnected standalone"]} />
        </Field>
        <Field label="Chapter count">
          <TextInput value={profile.chapters} onChange={set("chapters")} placeholder="52" inputMode="numeric" />
        </Field>
        <Field label="Word count goal">
          <TextInput value={profile.wordGoal} onChange={set("wordGoal")} placeholder="95,000" />
        </Field>
      </div>
      <Field label="Target reader">
        <TextInput value={profile.reader} onChange={set("reader")} placeholder="Adult dark-romance readers who want morally gray, high heat, real consequences" />
      </Field>
      <Field label="Heat level" hint="Explicit tiers are written for adult fiction — the engine won't fade to black unless you tell it to.">
        <HeatDial value={profile.heat} onChange={(h) => setProfile({ ...profile, heat: h })} />
      </Field>
      <Field label="Working premise (optional — the Plot Engine can forge one)">
        <textarea className="ik-input ik-area" rows={3} value={profile.premise} onChange={set("premise")} placeholder="One to three sentences of raw idea. Rough is fine." />
      </Field>
      <div className="ik-actions">
        <SealButton
          busy={gen.busy}
          onClick={() =>
            gen.run(
              "Story bible seed",
              `Using this story profile, write a compact story bible seed: (1) a sharpened premise paragraph, (2) the central dramatic question, (3) three pressure points that will break the protagonist, (4) what the ending must cost. Keep it tight and usable.\n\n${ctx}`
            )
          }
        >
          Forge story bible seed
        </SealButton>
      </div>
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ============================================================
   MODULE — Character Vault
   ============================================================ */
const BLANK_CHAR = {
  name: "", age: "", role: "", goal: "", wound: "", secret: "",
  voice: "", relationships: "", conflicts: "", dialogue: "", visual: "",
};
const CHAR_FIELDS = [
  ["name", "Name"], ["age", "Age"], ["role", "Role"], ["goal", "Goal"],
  ["wound", "Wound"], ["secret", "Secret"], ["voice", "Voice style"],
  ["relationships", "Relationship map"], ["conflicts", "Conflict history"],
  ["dialogue", "Dialogue sample"], ["visual", "Visual prompt"],
];

function CharacterVault({ characters, setCharacters, ctx }) {
  const [openIdx, setOpenIdx] = useState(characters.length ? 0 : -1);
  const [busyIdx, setBusyIdx] = useState(-1);
  const [err, setErr] = useState("");

  const add = () => {
    setCharacters([...characters, { ...BLANK_CHAR }]);
    setOpenIdx(characters.length);
  };
  const update = (i, k, v) => {
    const next = characters.slice();
    next[i] = { ...next[i], [k]: v };
    setCharacters(next);
  };
  const remove = (i) => {
    setCharacters(characters.filter((_, x) => x !== i));
    setOpenIdx(-1);
  };

  const generate = async (i) => {
    setBusyIdx(i);
    setErr("");
    const c = characters[i];
    try {
      const raw = await callClaude(
        `Build a complete character profile for a dark fiction cast. Respond ONLY with a JSON object, no preamble, no markdown fences, with exactly these string keys: name, age, role, goal, wound, secret, voice, relationships, conflicts, dialogue, visual.\n- "voice" = how they talk and think (rhythm, register, tells)\n- "relationships" = map of ties to the rest of the cast\n- "conflicts" = conflict history that still bleeds into the present\n- "dialogue" = a 4–6 line dialogue sample in their voice (fragments, human, no dialect caricature)\n- "visual" = a vivid visual/casting prompt.\nKeep any fields the author already filled and build the rest around them.\n\nStory context:\n${ctx}\n\nAuthor's partial profile: ${JSON.stringify(c)}`,
        { system: "You return only valid JSON. Every value is a string." }
      );
      const parsed = JSON.parse(stripFences(raw));
      const next = characters.slice();
      next[i] = { ...BLANK_CHAR, ...c, ...Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)])) };
      setCharacters(next);
    } catch (e) {
      setErr("The vault jammed — generate again and it usually opens.");
    } finally {
      setBusyIdx(-1);
    }
  };

  return (
    <section>
      <ModuleHead title="Character Vault" blurb="Every soul in the book, on one shelf. Fill what you know; the vault forges the rest around it." />
      {err && <div className="ik-error" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="ik-vault">
        {characters.map((c, i) => (
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
                      {["relationships", "conflicts", "dialogue", "visual"].includes(k) ? (
                        <textarea className="ik-input ik-area" rows={3} value={c[k]} onChange={(e) => update(i, k, e.target.value)} />
                      ) : (
                        <TextInput value={c[k]} onChange={(e) => update(i, k, e.target.value)} />
                      )}
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
      <div className="ik-actions">
        <GhostButton onClick={add}>+ Add a soul to the vault</GhostButton>
      </div>
      {!characters.length && <p className="ik-empty">The vault is empty. Add your first character to start the map.</p>}
    </section>
  );
}

/* ============================================================
   MODULE — Plot Engine
   ============================================================ */
const PLOT_TOOLS = [
  ["Premise", "Write 3 alternate premise paragraphs for this book. Each one a different angle of attack. Number them."],
  ["Logline", "Write 5 loglines. One sentence each. Protagonist, want, obstacle, stakes. No taglines, no rhetorical questions."],
  ["Three-act outline", "Write a three-act outline. Act headers, then beats as short punchy lines. Mark the midpoint reversal and the all-is-lost moment explicitly."],
  ["Chapter outline", "Write a chapter-by-chapter outline matching the chapter count in the profile (default 30 if unset). One line per chapter: POV tag, what happens, what turns. End every 5th chapter on a hook."],
  ["Scene cards", "Write 8 scene cards for the next stretch of the book. Each card: SLUG (location/time), IN (emotional state entering), TURN (what changes), OUT (state leaving), HOOK (last image or line)."],
  ["Plot twist bank", "Generate 10 plot twists ranked from grounded to nuclear. For each: the twist, the earliest chapter it could detonate, and the one clue to plant beforehand."],
  ["Cliffhanger endings", "Write 8 chapter-ending cliffhangers tuned to this story. Give each as the final 2–3 lines of prose that would close the chapter, in the book's voice."],
  ["Series arc", "Map a series arc across the books implied by the profile (default 3 if unset). For each book: the promise, the betrayal, the price, and the thread left burning for the next."],
  ["Reader hook", "Write the first 150 words of the book — the open that makes the target reader unable to put it down. Then a one-line note on why it works."],
];

function PlotEngine({ ctx }) {
  const gen = useGen();
  return (
    <section>
      <ModuleHead title="Plot Engine" blurb="Structure on demand. Every generator reads the full story profile, cast, and active dark modes." />
      <div className="ik-toolgrid">
        {PLOT_TOOLS.map(([name, instruction]) => (
          <button key={name} className="ik-tool" disabled={gen.busy} onClick={() => gen.run(name, `${instruction}\n\nStory context:\n${ctx}`)}>
            {name}
          </button>
        ))}
      </div>
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ============================================================
   MODULE — Chapter Studio
   ============================================================ */
const STUDIO_TOOLS = [
  ["Write next chapter", "Using the pasted text as the most recent material, write the opening 500–700 words of the next chapter. Match voice and POV exactly."],
  ["Rewrite with more emotion", "Rewrite the pasted passage with deeper interiority and rawer emotion. Fragments over reflection. Do not add length for its own sake."],
  ["Add suspense", "Rewrite the pasted passage to tighten suspense: withhold, delay, shorten sentences at pressure points, end on unease."],
  ["Humanize grammar", "Rewrite the pasted passage so it reads human, not literary: contractions, fragments, interrupted thoughts, natural rhythm. Kill anything that sounds like an AI or an MFA."],
  ["Expand scene", "Expand the pasted scene by roughly 60%: more beats, more sensory grounding, more subtext in the silences. No filler."],
  ["Make dialogue sharper", "Rewrite the dialogue in the pasted passage: cut pleasantries, sharpen subtext, give each speaker a distinct rhythm, trim tags."],
  ["Reduce exposition", "Rewrite the pasted passage converting exposition into action, dialogue, or implication. Cut what the reader can infer."],
  ["Add sensory detail", "Rewrite the pasted passage layering in grounded sensory specificity — smell, texture, temperature, sound. Specific over sweeping."],
  ["Strengthen ending hook", "Rewrite only the final paragraph of the pasted passage so the chapter ends on a hook the reader can't walk away from. Show 3 options."],
];

function ChapterStudio({ ctx }) {
  const [draft, setDraft] = useState("");
  const gen = useGen();
  return (
    <section>
      <ModuleHead title="Chapter Studio" blurb="Paste the page. Pick the knife." />
      <Field label="Working text">
        <textarea className="ik-input ik-area" rows={10} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Paste a scene, a chapter, or the last page you wrote…" />
      </Field>
      <div className="ik-toolgrid">
        {STUDIO_TOOLS.map(([name, instruction]) => (
          <button
            key={name}
            className="ik-tool"
            disabled={gen.busy || !draft.trim()}
            onClick={() => gen.run(name, `${instruction}\n\nStory context:\n${ctx}\n\nPASTED TEXT:\n${draft}`)}
          >
            {name}
          </button>
        ))}
      </div>
      {!draft.trim() && <p className="ik-empty">The studio needs pages. Paste text above to unlock the tools.</p>}
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ============================================================
   MODULE — Dark Modes (presets)
   ============================================================ */
const PRESETS = [
  "Slow burn", "Enemies to lovers", "Forbidden romance", "Betrayal", "Obsession",
  "Second chance", "Southern gothic", "Dark R&B mood", "New Orleans suspense", "High tension dual POV",
];

function DarkModes({ presets, setPresets, ctx }) {
  const gen = useGen();
  const toggle = (p) => setPresets(presets.includes(p) ? presets.filter((x) => x !== p) : [...presets, p]);
  return (
    <section>
      <ModuleHead title="Dark Modes" blurb="Standing atmospheres. Light the ones this book lives in — every generator in the studio obeys them." />
      <div className="ik-presets">
        {PRESETS.map((p) => (
          <GhostButton key={p} active={presets.includes(p)} onClick={() => toggle(p)}>{p}</GhostButton>
        ))}
      </div>
      <div className="ik-actions">
        <SealButton
          busy={gen.busy}
          disabled={!presets.length}
          onClick={() =>
            gen.run(
              "Mood bible",
              `Write a one-page mood bible fusing these presets into a single coherent atmosphere for the book: ${presets.join(", ")}. Cover: the emotional weather, the pacing rule, three recurring images, what the narration never does, and one line of prose demonstrating the register.\n\nStory context:\n${ctx}`
            )
          }
        >
          Fuse into a mood bible
        </SealButton>
      </div>
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ============================================================
   MODULE — Publishing Toolkit
   ============================================================ */
const PUB_TOOLS = [
  ["Book description", "Write a retail book description: hook line, 2 short paragraphs, tropes list, content-warning line appropriate to the heat level."],
  ["Amazon blurb", "Write an Amazon blurb optimized for dark romance browsers: bolded hook, short punchy paragraphs, one-line trope stack, a dare to the reader at the end."],
  ["Back cover copy", "Write back cover copy: 120–160 words, present tense, ends on the central dramatic question."],
  ["Author bio", "Write 3 author bios (50, 100, 150 words) for a dark romance/thriller author. Confident, a little dangerous, zero clichés about coffee."],
  ["Series page copy", "Write series page copy: the world in one paragraph, then a one-line teaser per book implied by the profile."],
  ["TikTok caption", "Write 6 BookTok captions with hooks and hashtag sets. Each under 150 characters before tags. Voice: reader-to-reader, not ad copy."],
  ["Trailer script", "Write a 45-second book trailer script: VO lines, on-screen text cards, music/mood cues, final title card."],
  ["Playlist", "Build a 12-track playlist concept for this book: for each slot give a mood descriptor, tempo, and the story beat it scores. Do NOT quote lyrics — describe the sound and feeling only."],
  ["Character quote cards", "Write 8 original in-character quotes designed for shareable quote cards. Attribute each to a cast member. Short, brutal, save-worthy."],
  ["Email launch copy", "Write a 3-email launch sequence: tease, cover/preorder reveal, release day. Subject lines + body for each. Voice matches the book."],
];

function Publishing({ ctx }) {
  const gen = useGen();
  return (
    <section>
      <ModuleHead title="Publishing Toolkit" blurb="The book after the book. Everything a launch needs, in the book's own voice." />
      <div className="ik-toolgrid">
        {PUB_TOOLS.map(([name, instruction]) => (
          <button key={name} className="ik-tool" disabled={gen.busy} onClick={() => gen.run(name, `${instruction}\n\nStory context:\n${ctx}`)}>
            {name}
          </button>
        ))}
      </div>
      <Output title={gen.label} text={gen.text} busy={gen.busy} error={gen.error} onClear={gen.clear} />
    </section>
  );
}

/* ============================================================
   Shell — sidebar, header, styles
   ============================================================ */
function ModuleHead({ title, blurb }) {
  return (
    <header className="ik-modhead">
      <h2>{title}</h2>
      <p>{blurb}</p>
    </header>
  );
}

const NAV = [
  ["builder", "Story Builder", "The terms of the book"],
  ["vault", "Character Vault", "Every soul on one shelf"],
  ["plot", "Plot Engine", "Structure on demand"],
  ["studio", "Chapter Studio", "Paste the page, pick the knife"],
  ["modes", "Dark Modes", "Standing atmospheres"],
  ["publish", "Publishing Toolkit", "The book after the book"],
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
  const ctx = buildContext(profile, presets, characters);
  const mainRef = useRef(null);
  useEffect(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }, [active]);

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
            <span className="ik-tag">dark fiction command center</span>
          </div>
        </div>
        <nav className="ik-nav">
          {NAV.map(([id, name, sub]) => (
            <button key={id} className={"ik-navbtn" + (active === id ? " on" : "")} onClick={() => setActive(id)}>
              <span className="ik-navname">{name}</span>
              <span className="ik-navsub">{sub}</span>
            </button>
          ))}
        </nav>
        <div className="ik-sidefoot">
          <span className="ik-eyebrow">On the record</span>
          <p>{profile.title ? profile.title : "Untitled manuscript"} · {profile.heat}{presets.length ? ` · ${presets.length} mode${presets.length > 1 ? "s" : ""} lit` : ""}{characters.length ? ` · ${characters.length} in the vault` : ""}</p>
        </div>
      </aside>
      <main className="ik-main" ref={mainRef}>
        {active === "builder" && <StoryBuilder profile={profile} setProfile={setProfile} ctx={ctx} />}
        {active === "vault" && <CharacterVault characters={characters} setCharacters={setCharacters} ctx={ctx} />}
        {active === "plot" && <PlotEngine ctx={ctx} />}
        {active === "studio" && <ChapterStudio ctx={ctx} />}
        {active === "modes" && <DarkModes presets={presets} setPresets={setPresets} ctx={ctx} />}
        {active === "publish" && <Publishing ctx={ctx} />}
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
.ik-root button:focus-visible, .ik-root input:focus-visible, .ik-root select:focus-visible, .ik-root textarea:focus-visible { outline:2px solid var(--gold); outline-offset:2px; }

/* sidebar */
.ik-side { width:264px; flex-shrink:0; border-right:1px solid var(--line); padding:26px 18px; display:flex; flex-direction:column; gap:26px; position:sticky; top:0; height:100vh; }
.ik-brand { display:flex; gap:12px; align-items:center; }
.ik-wordmark { display:block; font-family:'Fraunces',serif; font-weight:700; font-size:20px; letter-spacing:.14em; color:var(--parchment); }
.ik-tag { display:block; font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--faint); margin-top:2px; }
.ik-nav { display:flex; flex-direction:column; gap:4px; }
.ik-navbtn { text-align:left; background:none; border:1px solid transparent; border-radius:6px; padding:10px 12px; transition:background .15s, border-color .15s; }
.ik-navbtn:hover { background:var(--panel); }
.ik-navbtn.on { background:var(--panel); border-color:var(--line); box-shadow:inset 2px 0 0 var(--wine); }
.ik-navname { display:block; color:var(--parchment); font-weight:600; font-size:14px; }
.ik-navsub { display:block; color:var(--faint); font-size:12px; margin-top:1px; }
.ik-sidefoot { margin-top:auto; border-top:1px solid var(--line); padding-top:14px; font-size:12.5px; color:var(--faint); }
.ik-sidefoot p { margin:6px 0 0; }

/* main */
.ik-main { flex:1; padding:38px clamp(20px, 5vw, 64px) 80px; max-height:100vh; overflow-y:auto; }
.ik-modhead h2 { font-family:'Fraunces',serif; font-weight:600; font-size:clamp(26px, 3.2vw, 34px); color:var(--parchment); margin:0 0 6px; letter-spacing:.01em; }
.ik-modhead p { margin:0 0 26px; color:var(--faint); max-width:56ch; }
.ik-eyebrow { font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--gold); }

/* fields */
.ik-grid2 { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:14px 18px; margin-bottom:14px; }
.ik-field { display:flex; flex-direction:column; gap:6px; margin-bottom:14px; }
.ik-grid2 .ik-field { margin-bottom:0; }
.ik-label { font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--faint); }
.ik-hint { font-size:12px; color:var(--faint); }
.ik-input { background:var(--panel); border:1px solid var(--line); border-radius:6px; color:var(--parchment); padding:10px 12px; font-family:'Karla',sans-serif; font-size:14.5px; width:100%; }
.ik-input::placeholder { color:#5d5162; }
.ik-select { appearance:none; }
.ik-area { resize:vertical; line-height:1.6; }

/* heat dial */
.ik-heat { display:flex; align-items:center; gap:4px; }
.ik-flame { background:none; border:none; padding:4px; border-radius:6px; transition:transform .12s; }
.ik-flame:hover { transform:translateY(-2px); }
.ik-flame.lit svg { filter:drop-shadow(0 0 6px rgba(200,161,91,.45)); }
.ik-heat-name { margin-left:10px; font-family:'Fraunces',serif; font-style:italic; color:var(--gold); font-size:15px; }

/* buttons */
.ik-actions { display:flex; gap:12px; align-items:center; margin:18px 0 6px; flex-wrap:wrap; }
.ik-seal { background:linear-gradient(135deg, var(--wine), var(--wine-deep)); color:var(--parchment); border:1px solid #A23A4E; border-radius:999px; padding:11px 24px; font-weight:600; font-size:14px; letter-spacing:.03em; transition:box-shadow .15s, transform .12s; }
.ik-seal:hover:not(:disabled) { box-shadow:0 0 0 1px #A23A4E, 0 6px 22px rgba(142,43,62,.35); transform:translateY(-1px); }
.ik-seal:disabled { opacity:.5; cursor:default; }
.ik-ghost { background:none; border:1px solid var(--line); border-radius:999px; color:var(--smoke); padding:9px 18px; font-size:13.5px; transition:border-color .15s, color .15s, background .15s; }
.ik-ghost:hover { border-color:var(--gold); color:var(--parchment); }
.ik-ghost.on { border-color:var(--gold); color:var(--gold); background:rgba(200,161,91,.08); }
.ik-mini { background:none; border:1px solid var(--line); border-radius:5px; color:var(--smoke); padding:4px 10px; font-size:12px; }
.ik-mini:hover { border-color:var(--gold); color:var(--parchment); }

/* tool grid */
.ik-toolgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:10px; margin:6px 0 10px; }
.ik-tool { background:var(--panel); border:1px solid var(--line); border-radius:8px; color:var(--parchment); padding:14px 14px; text-align:left; font-weight:600; font-size:14px; transition:border-color .15s, background .15s, transform .12s; }
.ik-tool:hover:not(:disabled) { border-color:var(--wine); background:var(--panel2); transform:translateY(-1px); }
.ik-tool:disabled { opacity:.45; cursor:default; }

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

@media (prefers-reduced-motion: reduce) {
  .ik-root * { animation:none !important; transition:none !important; }
}
@media (max-width: 760px) {
  .ik-root { flex-direction:column; }
  .ik-side { width:100%; height:auto; position:static; flex-direction:column; gap:14px; border-right:none; border-bottom:1px solid var(--line); padding:18px; }
  .ik-nav { flex-direction:row; flex-wrap:wrap; }
  .ik-navsub { display:none; }
  .ik-sidefoot { display:none; }
  .ik-main { max-height:none; padding:24px 16px 60px; }
}
`;

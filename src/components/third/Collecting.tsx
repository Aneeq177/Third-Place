import { useEffect, useRef, useState } from "react";
import { Check, Copy, Keyboard, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import type { Constraints, Group, NoteResponse, Transport } from "@/shared/types";
import { fmtDay, fmtTime } from "./time";

type SpeechRecEvent = { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecCtor = new () => SpeechRec;

function speechCtor(): SpeechRecCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecCtor; webkitSpeechRecognition?: SpeechRecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const MAX_SECONDS = 20;
const TRANSPORTS: Transport[] = ["walk", "bike", "transit", "rideshare", "drive"];

const NOTE_PROMPTS = [
  { q: "When are you free?", hint: "Friday after 7, Saturday afternoon…" },
  { q: "What do you feel like doing?", hint: "coffee shop, live music, outdoors…" },
  { q: "What part of town?", hint: "East Austin, near campus, wherever…" },
  { q: "What's your budget?", hint: "under $20, $30–40, keep it free…" },
  { q: "Any food or access needs?", hint: "vegetarian, gluten-free, need a seat…" },
];

function MicLevel({ stream }: { stream: MediaStream }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) {
        const n = (v - 128) / 128;
        sum += n * n;
      }
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      raf = window.requestAnimationFrame(tick);
    };
    void ctx.resume().then(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      void ctx.close();
    };
  }, [stream]);
  return (
    <div className="mt-3 h-3 w-full overflow-hidden rounded-full border-2 border-input">
      <div className="h-full bg-leaf transition-all" style={{ width: `${Math.max(6, level * 100)}%` }} />
    </div>
  );
}

function NotePrompts({ talking, forText }: { talking?: boolean; forText?: boolean }) {
  const label = talking
    ? "Hit these while you talk"
    : forText
      ? "Cover these if you can"
      : "Glance at these, then talk";
  return (
    <div className={`mt-4 space-y-2 rounded-2xl bg-muted px-4 py-3 ${talking ? "ring-2 ring-primary/40" : ""}`}>
      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <ol className="space-y-2">
        {NOTE_PROMPTS.map((p, i) => (
          <li key={p.q} className="flex gap-3 text-sm">
            <span className="font-display w-5 shrink-0 font-bold text-primary">{i + 1}.</span>
            <span>
              <span className="font-semibold">{p.q}</span>
              <span className="block text-muted-foreground">{p.hint}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

type PrefDraft = {
  vibe: string;
  area: string;
  budgetMin: string;
  budgetMax: string;
  dietary: string;
  accessibility: string;
  transport: string;
  windows: Constraints["freeWindows"];
};

const csv = (s: string) =>
  s
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

function fromConstraints(c: Constraints): PrefDraft {
  return {
    vibe: c.vibe.join(", "),
    area: c.area,
    budgetMin: c.budgetPerPerson.min == null ? "" : String(c.budgetPerPerson.min),
    budgetMax: c.budgetPerPerson.max == null ? "" : String(c.budgetPerPerson.max),
    dietary: c.dietary.join(", "),
    accessibility: c.accessibility.join(", "),
    transport: c.transport.join(", "),
    windows: c.freeWindows,
  };
}

function toConstraints(memberName: string, transcript: string, p: PrefDraft): Constraints {
  const num = (s: string) => {
    const n = Number(s.trim());
    return s.trim() === "" || Number.isNaN(n) ? null : n;
  };
  return {
    memberName,
    freeWindows: p.windows,
    budgetPerPerson: { min: num(p.budgetMin), max: num(p.budgetMax) },
    vibe: csv(p.vibe),
    dietary: csv(p.dietary),
    accessibility: csv(p.accessibility),
    area: p.area.trim(),
    transport: csv(p.transport).filter((t): t is Transport => (TRANSPORTS as string[]).includes(t)),
    rawTranscript: transcript,
  };
}

function PrefsCard({
  prefs,
  setPrefs,
  busy,
  onSave,
}: {
  prefs: PrefDraft;
  setPrefs: (p: PrefDraft) => void;
  busy: boolean;
  onSave: () => void;
}) {
  const field = (label: string, key: keyof Pick<PrefDraft, "vibe" | "area" | "dietary" | "accessibility" | "transport">, hint: string) => (
    <label className="block text-sm">
      <span className="font-semibold">{label}</span>
      <input
        value={prefs[key]}
        onChange={(e) => setPrefs({ ...prefs, [key]: e.target.value })}
        placeholder={hint}
        className="mt-1 h-11 w-full rounded-xl border-2 border-input bg-background px-3 outline-none"
      />
    </label>
  );

  return (
    <section className="chunky rounded-3xl bg-card p-5">
      <h3 className="font-display text-xl font-bold">Your saved preferences</h3>
      <p className="mt-1 text-sm text-muted-foreground">Fix anything we got wrong. Comma-separate tags.</p>
      {prefs.windows.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {prefs.windows.map((w) => (
            <li key={w.start} className="rounded-xl bg-muted px-3 py-2">
              {fmtDay(w.start)} · {fmtTime(w.start)}–{fmtTime(w.end)}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid gap-3">
        {field("What you want", "vibe", "coffee shop, live music")}
        {field("Part of town", "area", "East Austin")}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="font-semibold">Budget min $</span>
            <input
              inputMode="numeric"
              value={prefs.budgetMin}
              onChange={(e) => setPrefs({ ...prefs, budgetMin: e.target.value })}
              placeholder="any"
              className="mt-1 h-11 w-full rounded-xl border-2 border-input bg-background px-3 outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="font-semibold">Budget max $</span>
            <input
              inputMode="numeric"
              value={prefs.budgetMax}
              onChange={(e) => setPrefs({ ...prefs, budgetMax: e.target.value })}
              placeholder="any"
              className="mt-1 h-11 w-full rounded-xl border-2 border-input bg-background px-3 outline-none"
            />
          </label>
        </div>
        {field("Food needs", "dietary", "vegetarian, gluten-free")}
        {field("Access needs", "accessibility", "needs seating")}
        {field("How you'll get there", "transport", "walk, bike, drive")}
      </div>
      <button
        onClick={onSave}
        disabled={busy}
        className="chunky press mt-4 h-12 w-full rounded-2xl bg-secondary font-display font-semibold disabled:opacity-60"
      >
        {busy ? "Saving…" : "Update preferences"}
      </button>
    </section>
  );
}

export function CollectingScreen({ group, me, onChange }: { group: Group; me: string; onChange: () => void }) {
  const mine = group.members.find((m) => m.name.toLowerCase() === me.toLowerCase());
  const submitted = group.members.filter((m) => m.constraints);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [live, setLive] = useState("");
  const [listenHint, setListenHint] = useState("");
  const [meterStream, setMeterStream] = useState<MediaStream | null>(null);
  const [draft, setDraft] = useState(mine?.constraints?.rawTranscript ?? "");
  const [prefs, setPrefs] = useState<PrefDraft | null>(mine?.constraints ? fromConstraints(mine.constraints) : null);
  const speechRef = useRef<SpeechRec | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveRef = useRef("");
  const recordingRef = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (mine?.constraints) {
      setDraft(mine.constraints.rawTranscript);
      setPrefs(fromConstraints(mine.constraints));
    }
  }, [mine?.constraints]);

  useEffect(
    () => () => {
      recordingRef.current = false;
      if (timer.current) window.clearInterval(timer.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        speechRef.current?.stop();
      } catch {
        /* already stopped */
      }
    },
    [],
  );

  const sendNote = async (fn: () => Promise<NoteResponse>) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res.transcript.trim()) setDraft(res.transcript.trim());
      if (res.constraints) setPrefs(fromConstraints(res.constraints));
      toast.success("Got it! Your wishes have been noted. 📝");
      setLive("");
      liveRef.current = "";
      onChange();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const finishRecording = () => {
    const spoken = liveRef.current.trim();
    setDraft((prev) => [prev.trim(), spoken].filter(Boolean).join(" ").trim());
    setLive("");
    liveRef.current = "";
  };

  const start = async () => {
    const SR = speechCtor();
    if (!SR) {
      setListenHint("Tap-to-talk captions only work in Chrome or Edge. Type in the box below.");
      toast.error("This browser can't hear you live. Use Chrome, or type the note.");
      setMode("text");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setListenHint("Mic is blocked. Click the lock icon in the address bar → allow microphone, then tap again.");
      toast.error("Allow the microphone, then tap to talk again.");
      return;
    }

    // Do not start MediaRecorder. It holds the mic and Chrome captions hear silence.
    streamRef.current = stream;
    setMeterStream(stream);
    liveRef.current = "";
    setLive("");
    setListenHint("Listening… talk now.");
    recordingRef.current = true;

    const speech = new SR();
    speech.continuous = true;
    speech.interimResults = true;
    speech.lang = "en-US";
    speech.onresult = (e) => {
      let finalText = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const piece = e.results[i]![0].transcript;
        if (e.results[i]!.isFinal) finalText += piece;
        else interim += piece;
      }
      const next = `${finalText}${interim ? ` ${interim}` : ""}`.trim();
      liveRef.current = next;
      setLive(next);
      if (next) setListenHint("");
    };
    speech.onerror = (e) => {
      if (e.error === "not-allowed") {
        setListenHint("Mic is blocked. Allow microphone in the address bar.");
        toast.error("No mic access. You can type it instead!");
        setMode("text");
        return;
      }
      if (e.error === "audio-capture") {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setMeterStream(null);
        setListenHint("Mic was busy. Keep talking — retrying captions.");
        return;
      }
      if (e.error === "network") {
        setListenHint("Captions need internet. Chrome sends audio to Google to turn it into text.");
        return;
      }
      if (e.error === "no-speech") setListenHint("Still listening — talk a bit louder or closer to the mic.");
    };
    speech.onend = () => {
      if (!recordingRef.current) return;
      window.setTimeout(() => {
        if (!recordingRef.current) return;
        try {
          speech.start();
        } catch {
          /* Chrome throws if a start is already pending */
        }
      }, 80);
    };
    try {
      speech.start();
    } catch {
      setListenHint("Couldn't start captions. Refresh and use Chrome, or type below.");
    }
    speechRef.current = speech;
    setSecs(0);
    setRecording(true);
    timer.current = window.setInterval(() => {
      setSecs((s) => {
        if (s + 1 >= MAX_SECONDS) stop();
        return s + 1;
      });
    }, 1000);
  };

  const stop = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    recordingRef.current = false;
    setRecording(false);
    setMeterStream(null);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try {
      speechRef.current?.stop();
    } catch {
      /* already stopped */
    }
    speechRef.current = null;
    window.setTimeout(finishRecording, 120);
  };

  const plan = async () => {
    setPlanning(true);
    try {
      await api.generatePlans(group.id);
      onChange();
    } catch (e) {
      toast.error(errorMessage(e));
      setPlanning(false);
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/g/${group.id}`;
    try {
      if (navigator.share) await navigator.share({ title: group.name, text: "Drop a voice note so we can actually hang out:", url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied. Go drop it in the group chat!");
      }
    } catch {
      /* cancelled */
    }
  };

  const saveDraft = () => {
    const spoken = draft.trim();
    if (!spoken) {
      toast.error("Add a bit of text, or talk first.");
      return;
    }
    void sendNote(() => api.submitTextNote(group.id, me, spoken));
  };

  const savePrefs = () => {
    if (!prefs) return;
    void sendNote(() => api.updateConstraints(group.id, me, toConstraints(me, draft.trim(), prefs)));
  };

  if (planning) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <div className="animate-wobble text-7xl">🧭</div>
        <p className="mt-6 font-display text-2xl font-bold">Crunching everyone's schedules…</p>
        <p className="mt-2 text-muted-foreground">Checking hours, budgets, and who refuses to go to a loud bar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="chunky rounded-3xl bg-card p-5">
        <h2 className="font-display text-2xl font-bold">
          {mine?.constraints ? "Want to add or fix your note?" : `Hey ${me}, when are you free?`}
        </h2>
        <p className="mt-1 text-muted-foreground">
          {mode === "voice"
            ? "Talk, then edit anything we misheard before you save."
            : "Same prompts as the voice note. Skip anything that doesn't matter."}
        </p>

        <NotePrompts talking={recording} forText={mode === "text"} />

        {mode === "voice" ? (
          <div className="mt-6 flex flex-col items-center">
            <button
              onClick={recording ? stop : start}
              disabled={busy}
              aria-label={recording ? "Stop recording" : "Record voice note"}
              className={`chunky press flex h-32 w-32 items-center justify-center rounded-full ${recording ? "bg-destructive" : "bg-primary"} text-primary-foreground disabled:opacity-60`}
            >
              {recording ? <Square className="h-12 w-12" fill="currentColor" /> : <Mic className="h-14 w-14" />}
            </button>
            <p className="mt-4 font-display text-lg font-semibold">
              {busy ? "Saving what you said…" : recording ? `${MAX_SECONDS - secs}s left — talk fast!` : draft ? "Tap to add more" : "Tap to talk"}
            </p>
            {recording && (
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full border-2 border-input">
                <div className="h-full bg-primary transition-all" style={{ width: `${(secs / MAX_SECONDS) * 100}%` }} />
              </div>
            )}
            {recording && meterStream && <MicLevel stream={meterStream} />}
            {(recording || listenHint) && (
              <div className="mt-4 w-full rounded-2xl border-2 border-dashed border-input bg-background p-4 text-left">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  {recording ? "Hearing you…" : "Mic"}
                </p>
                <p className="mt-1 text-lg leading-snug">
                  {live || listenHint || "Start talking — words show up here."}
                </p>
                {recording && !live && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Use Chrome or Edge on this same page. If the green bar isn't moving, the wrong mic is selected.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : null}

        <div className={mode === "voice" ? "mt-4" : "mt-4"}>
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground" htmlFor="note-draft">
            What we heard — edit if needed
          </label>
          <textarea
            id="note-draft"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder="Friday after 7, coffee shop in East Austin, about $10…"
            className="mt-1 w-full rounded-2xl border-2 border-input bg-background p-4 text-lg outline-none"
          />
          <button
            disabled={busy || !draft.trim()}
            onClick={saveDraft}
            className="chunky press mt-3 h-14 w-full rounded-2xl bg-primary font-display text-lg font-bold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Reading your mind…" : mine?.constraints ? "Re-save my note" : "Save my note"}
          </button>
        </div>

        <button
          onClick={() => setMode(mode === "voice" ? "text" : "voice")}
          className="mx-auto mt-4 flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground underline"
        >
          {mode === "voice" ? (
            <>
              <Keyboard className="h-4 w-4" /> Hide the mic
            </>
          ) : (
            <>
              <Mic className="h-4 w-4" /> Show the mic
            </>
          )}
        </button>
      </section>

      {prefs && <PrefsCard prefs={prefs} setPrefs={setPrefs} busy={busy} onSave={savePrefs} />}

      <section className="chunky rounded-3xl bg-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-bold">The crew</h3>
          <span className="rounded-full bg-sun px-3 py-1 text-sm font-bold">
            {submitted.length}/{group.members.length} in
          </span>
        </div>
        <ul className="mt-3 space-y-2">
          {group.members.map((m) => (
            <li key={m.name} className="flex items-center justify-between rounded-2xl bg-muted px-4 py-3">
              <span className="font-semibold">{m.name}</span>
              {m.constraints ? (
                <span className="flex items-center gap-1 text-sm font-semibold text-leaf">
                  <Check className="h-4 w-4" /> said their piece
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">thinking about it… 🤔</span>
              )}
            </li>
          ))}
        </ul>
        <button onClick={share} className="chunky press mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-sky font-display text-lg font-semibold">
          <Copy className="h-5 w-5" /> Invite the stragglers
        </button>
      </section>

      <button
        onClick={plan}
        disabled={submitted.length < 2}
        className="chunky press h-16 w-full rounded-2xl bg-accent font-display text-xl font-bold disabled:opacity-50"
      >
        {submitted.length < 2 ? "Need 2+ notes to make a plan" : "✨ Make the plan!"}
      </button>
    </div>
  );
}

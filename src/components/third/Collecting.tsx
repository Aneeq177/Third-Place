import { useEffect, useRef, useState } from "react";
import { Check, Copy, Keyboard, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import type { Group } from "@/shared/types";

const MAX_SECONDS = 20;

export function CollectingScreen({ group, me, onChange }: { group: Group; me: string; onChange: () => void }) {
  const mine = group.members.find((m) => m.name.toLowerCase() === me.toLowerCase());
  const submitted = group.members.filter((m) => m.constraints);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
    recRef.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const send = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success("Got it! Your wishes have been noted. 📝");
      setText("");
      onChange();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        send(() => api.submitAudioNote(group.id, me, blob));
      };
      rec.start();
      recRef.current = rec;
      setSecs(0);
      setRecording(true);
      timer.current = window.setInterval(() => {
        setSecs((s) => {
          if (s + 1 >= MAX_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      toast.error("No mic access. You can type it instead!");
      setMode("text");
    }
  };
  const stop = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setRecording(false);
    if (recRef.current?.state === "recording") recRef.current.stop();
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
          {mine?.constraints ? "Want to redo your note?" : `Hey ${me}, when are you free?`}
        </h2>
        <p className="mt-1 text-muted-foreground">
          Say when you're free, your budget, what you're into, food stuff, and where you'd rather be. 20 seconds, tops.
        </p>

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
              {busy ? "Listening back…" : recording ? `${MAX_SECONDS - secs}s left — talk fast!` : "Tap to talk"}
            </p>
            {recording && (
              <div className="mt-3 h-3 w-full overflow-hidden rounded-full border-2 border-input">
                <div className="h-full bg-primary transition-all" style={{ width: `${(secs / MAX_SECONDS) * 100}%` }} />
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="Friday after 7 works, nothing too loud, I need somewhere to sit, ~$30…"
              className="w-full rounded-2xl border-2 border-input bg-background p-4 text-lg outline-none"
            />
            <button
              disabled={busy || !text.trim()}
              onClick={() => send(() => api.submitTextNote(group.id, me, text.trim()))}
              className="chunky press mt-3 h-14 w-full rounded-2xl bg-primary font-display text-lg font-bold text-primary-foreground disabled:opacity-60"
            >
              {busy ? "Reading your mind…" : "Send it"}
            </button>
          </div>
        )}
        <button
          onClick={() => setMode(mode === "voice" ? "text" : "voice")}
          className="mx-auto mt-4 flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground underline"
        >
          {mode === "voice" ? <><Keyboard className="h-4 w-4" /> In a library? Type it instead</> : <><Mic className="h-4 w-4" /> Actually, I'll talk</>}
        </button>
      </section>

      <section className="chunky rounded-3xl bg-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-bold">The crew</h3>
          <span className="rounded-full bg-sun px-3 py-1 text-sm font-bold">{submitted.length}/{group.members.length} in</span>
        </div>
        <ul className="mt-3 space-y-2">
          {group.members.map((m) => (
            <li key={m.name} className="flex items-center justify-between rounded-2xl bg-muted px-4 py-3">
              <span className="font-semibold">{m.name}</span>
              {m.constraints ? (
                <span className="flex items-center gap-1 text-sm font-semibold text-leaf"><Check className="h-4 w-4" /> said their piece</span>
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

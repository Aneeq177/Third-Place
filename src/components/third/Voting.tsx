import { useState } from "react";
import { MapPin, Star } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import type { Group, Plan } from "@/shared/types";
import { fmtDay, fmtTime, mapsUrl } from "./time";

const tints = ["bg-sun", "bg-sky", "bg-leaf"];
const medals = ["🥇", "🥈", "🥉"];

export function VotingScreen({ group, me, onGroup, onChange }: { group: Group; me: string; onGroup: (g: Group) => void; onChange: () => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const myVote = group.plans.find((p) => p.votes.some((v) => v.toLowerCase() === me.toLowerCase()))?.id;
  const needed = Math.floor(group.members.length / 2) + 1;

  const vote = async (p: Plan) => {
    setPending(p.id);
    try {
      const { group: g } = await api.vote(group.id, p.id, me);
      onGroup(g);
      if (g.status !== "confirmed") toast(`Vote locked in for “${p.title}”`);
    } catch (e) {
      toast.error(errorMessage(e));
      onChange();
    } finally {
      setPending(null);
    }
  };

  return (
    <div>
      <h2 className="animate-pop-in font-display text-3xl font-bold">Ta-da! Three ways to actually hang out.</h2>
      <p className="mt-1 text-muted-foreground">
        Pick one. First to {needed} vote{needed > 1 ? "s" : ""} wins, and then nobody's allowed to cancel.
      </p>
      <div className="mt-5 space-y-6">
        {[...group.plans].sort((a, b) => a.rank - b.rank).map((p, i) => (
          <article
            key={p.id}
            className={`chunky animate-pop-in overflow-hidden rounded-3xl bg-card ${myVote === p.id ? "ring-4 ring-primary" : ""}`}
            style={{ animationDelay: `${0.25 + i * 0.35}s` }}
          >
            <div className={`${tints[i % 3]} border-b-2 border-input px-5 py-4`}>
              <div className="flex items-center justify-between text-sm font-bold">
                <span>{medals[i]} Plan {p.rank}</span>
                <span>{p.score}% match</span>
              </div>
              <h3 className="mt-1 font-display text-2xl font-bold leading-tight">{p.title}</h3>
              <p className="mt-1 text-sm font-semibold">
                {fmtDay(p.start)} · {fmtTime(p.start)}–{fmtTime(p.end)} · ${p.estimatedCostPerPerson.min}–{p.estimatedCostPerPerson.max}/person
              </p>
            </div>
            <div className="space-y-4 p-5">
              <p>{p.summary}</p>
              <ol className="space-y-3">
                {p.stops.map((s) => (
                  <li key={s.venue.id + s.start} className="rounded-2xl bg-muted p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-display text-lg font-semibold">{s.venue.name}</span>
                      <span className="shrink-0 text-sm font-semibold">{fmtTime(s.start)}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {s.activity} · {s.venue.category}
                      {s.venue.rating != null && (
                        <> · <Star className="inline h-3.5 w-3.5 -translate-y-px" fill="currentColor" /> {s.venue.rating}</>
                      )}
                    </p>
                    <a
                      href={mapsUrl(s.venue.name, s.venue.address)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary underline"
                    >
                      <MapPin className="h-4 w-4" /> {s.venue.area} — open map
                    </a>
                  </li>
                ))}
              </ol>
              <div>
                <p className="font-display font-semibold">Why this works</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {p.why.map((w) => <li key={w}>✅ {w}</li>)}
                </ul>
              </div>
              {p.tradeoffs.length > 0 && (
                <div>
                  <p className="font-display font-semibold">Heads up</p>
                  <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                    {p.tradeoffs.map((t) => <li key={t}>⚠️ {t}</li>)}
                  </ul>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="text-sm">
                  <span className="font-display text-2xl font-bold">{p.votes.length}</span> vote{p.votes.length === 1 ? "" : "s"}
                  {p.votes.length > 0 && <p className="text-muted-foreground">{p.votes.join(", ")}</p>}
                </div>
                <button
                  onClick={() => vote(p)}
                  disabled={pending !== null || myVote === p.id}
                  className="chunky press h-14 shrink-0 rounded-2xl bg-primary px-6 font-display text-lg font-bold text-primary-foreground disabled:opacity-60"
                >
                  {myVote === p.id ? "Your pick ✓" : pending === p.id ? "Voting…" : "This one!"}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

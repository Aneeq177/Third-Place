import { CalendarPlus, MapPin, Share2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import type { Group } from "@/shared/types";
import { fmtDay, fmtTime, mapsUrl } from "./time";

export function ConfirmedScreen({ group }: { group: Group }) {
  const plan = group.plans.find((p) => p.id === group.confirmedPlanId);
  if (!plan) return null;

  const share = async () => {
    const url = `${window.location.origin}/g/${group.id}`;
    const text = `It's happening: ${plan.title}, ${fmtDay(plan.start)} at ${fmtTime(plan.start)}. No flaking.`;
    try {
      if (navigator.share) await navigator.share({ title: plan.title, text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast.success("Invite copied!");
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="space-y-5">
      <div className="animate-pop-in text-center">
        <div className="text-6xl">🎉</div>
        <h2 className="mt-2 font-display text-3xl font-bold">It's a plan!</h2>
        <p className="text-muted-foreground">Mark it down. Put the phone away. See you there.</p>
      </div>

      <article className="chunky animate-pop-in -rotate-1 overflow-hidden rounded-3xl bg-card" style={{ animationDelay: "0.2s" }}>
        <div className="border-b-2 border-dashed border-input bg-accent px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-widest">You're invited · {group.name}</p>
          <h3 className="mt-1 font-display text-2xl font-bold leading-tight">{plan.title}</h3>
        </div>
        <div className="space-y-3 p-5">
          <p className="font-display text-xl font-semibold">
            {fmtDay(plan.start)}
            <br />
            {fmtTime(plan.start)} – {fmtTime(plan.end)}
          </p>
          {plan.stops.map((s) => (
            <a
              key={s.venue.id + s.start}
              href={mapsUrl(s.venue.name, s.venue.address)}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-2 rounded-2xl bg-muted p-3"
            >
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span>
                <span className="font-semibold">{fmtTime(s.start)} · {s.venue.name}</span>
                <span className="block text-sm text-muted-foreground">{s.venue.address}</span>
              </span>
            </a>
          ))}
          <p className="text-sm">
            ~${plan.estimatedCostPerPerson.min}–{plan.estimatedCostPerPerson.max} each · Going: {group.members.map((m) => m.name).join(", ")}
          </p>
        </div>
      </article>

      <button
        onClick={() => api.downloadIcs(group).catch((e) => toast.error(errorMessage(e)))}
        className="chunky press flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-display text-xl font-bold text-primary-foreground"
      >
        <CalendarPlus className="h-6 w-6" /> Add to calendar
      </button>
      <button onClick={share} className="chunky press flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-sky font-display text-lg font-semibold">
        <Share2 className="h-5 w-5" /> Share the invite
      </button>
      <p className="text-center text-sm text-muted-foreground">Now close this tab. Seriously. Go text them "see you Friday" and mean it.</p>
    </div>
  );
}

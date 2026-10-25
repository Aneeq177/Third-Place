import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { Group } from "@/shared/types";
import { CollectingScreen } from "@/components/third/Collecting";
import { VotingScreen } from "@/components/third/Voting";
import { ConfirmedScreen } from "@/components/third/Confirmed";
import { NamePicker } from "@/components/third/NamePicker";

export const Route = createFileRoute("/g/$id")({
  head: () => ({
    meta: [
      { title: "Your hangout — Third Place" },
      { name: "description", content: "Drop a voice note, vote on a plan, and actually meet up." },
      { property: "og:title", content: "You're invited to hang out — Third Place" },
      { property: "og:description", content: "Leave a 20-second voice note so we can pick a plan." },
    ],
  }),
  ssr: false,
  component: GroupPage,
});

const meKey = (id: string) => `thirdplace.me.${id}`;

function GroupPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [me, setMeState] = useState<string | null>(null);
  useEffect(() => setMeState(localStorage.getItem(meKey(id))), [id]);
  const setMe = (n: string | null) => {
    if (n) localStorage.setItem(meKey(id), n);
    else localStorage.removeItem(meKey(id));
    setMeState(n);
  };

  const q = useQuery({
    queryKey: ["group", id],
    queryFn: () => api.getGroup(id),
    refetchInterval: 3000,
  });
  const setGroup = (g: Group) => qc.setQueryData(["group", id], g);
  const refresh = () => qc.invalidateQueries({ queryKey: ["group", id] });

  if (q.isLoading) return <Shell><p className="animate-wobble text-center font-display text-2xl">Loading the vibes…</p></Shell>;
  if (q.error || !q.data)
    return (
      <Shell>
        <p className="text-center text-lg">{errorMessage(q.error)}</p>
        <Link to="/" className="chunky press mt-6 block rounded-2xl bg-primary py-4 text-center font-display text-lg font-bold text-primary-foreground">
          Start a new hangout
        </Link>
      </Shell>
    );

  const g = q.data;
  return (
    <Shell>
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <Link to="/" className="font-display text-sm font-semibold uppercase tracking-widest text-primary">Third Place</Link>
          <h1 className="font-display text-3xl font-bold leading-tight">{g.name}</h1>
          <p className="text-sm text-muted-foreground">{g.city}</p>
        </div>
        {me && (
          <button onClick={() => setMe(null)} className="rounded-full border-2 border-input bg-card px-3 py-2 text-sm font-semibold">
            I'm {me} ✎
          </button>
        )}
      </header>
      {!me ? (
        <NamePicker group={g} onPick={setMe} />
      ) : g.status === "collecting" ? (
        <CollectingScreen group={g} me={me} onChange={refresh} />
      ) : g.status === "voting" ? (
        <VotingScreen group={g} me={me} onGroup={setGroup} onChange={refresh} />
      ) : (
        <ConfirmedScreen group={g} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-md px-5 pb-16 pt-6">{children}</main>;
}

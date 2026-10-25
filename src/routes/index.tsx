import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Third Place — turn \"we should hang out\" into a plan" },
      {
        name: "description",
        content: "Friends leave quick voice notes, AI figures out when, where and what, and the group votes on 3 plans.",
      },
      { property: "og:title", content: "Third Place — actually hang out" },
      { property: "og:description", content: "Voice notes in, a real plan out. Then put your phone down." },
    ],
  }),
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [friend, setFriend] = useState("");
  const [friends, setFriends] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const addFriend = () => {
    const f = friend.trim();
    if (f && !friends.some((x) => x.toLowerCase() === f.toLowerCase())) setFriends([...friends, f]);
    setFriend("");
  };

  const create = async () => {
    if (!name.trim()) {
      toast("Give your crew a name first!");
      return;
    }
    setBusy(true);
    try {
      const g = await api.createGroup({ name: name.trim(), memberNames: friends });
      navigate({ to: "/g/$id", params: { id: g.id } });
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-10 pt-8">
      <p className="font-display text-sm font-semibold uppercase tracking-widest text-primary">Third Place</p>
      <h1 className="mt-3 font-display text-5xl font-bold leading-[1.02]">
        "We should hang out" <span className="inline-block -rotate-2 rounded-xl bg-accent px-2">is not a plan.</span>
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Everyone leaves a 20-second voice note. A robot does the scheduling homework. You vote. Then you go outside.
      </p>

      <section className="chunky mt-8 rounded-3xl bg-card p-5">
        <label className="font-display text-lg font-semibold" htmlFor="crew">
          Name your crew
        </label>
        <input
          id="crew"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Friday crew, The Group Chat That Never Meets…"
          className="mt-2 h-14 w-full rounded-2xl border-2 border-input bg-background px-4 text-lg outline-none focus:ring-4 focus:ring-ring/30"
        />

        <label className="mt-5 block font-display text-lg font-semibold" htmlFor="friend">
          Who's in? <span className="text-sm font-normal text-muted-foreground">(optional, they can join later)</span>
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="friend"
            value={friend}
            onChange={(e) => setFriend(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addFriend())}
            placeholder="Maya"
            className="h-14 min-w-0 flex-1 rounded-2xl border-2 border-input bg-background px-4 text-lg outline-none focus:ring-4 focus:ring-ring/30"
          />
          <button onClick={addFriend} className="chunky press h-14 rounded-2xl bg-secondary px-5 font-display font-semibold">
            Add
          </button>
        </div>
        {friends.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {friends.map((f) => (
              <span key={f} className="inline-flex items-center gap-1 rounded-full border-2 border-input bg-sun px-3 py-1 font-semibold">
                {f}
                <button aria-label={`Remove ${f}`} onClick={() => setFriends(friends.filter((x) => x !== f))} className="p-1">
                  <X className="h-4 w-4" />
                </button>
              </span>
            ))}
          </div>
        )}

        <button
          onClick={create}
          disabled={busy}
          className="chunky press mt-6 h-16 w-full rounded-2xl bg-primary font-display text-xl font-bold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Summoning friends…" : "Start the hangout →"}
        </button>
      </section>

      <p className="mt-6 text-center text-sm text-muted-foreground">No accounts. No endless group chat. Just a link.</p>
    </main>
  );
}

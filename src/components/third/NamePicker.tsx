import { useState } from "react";
import type { Group } from "@/shared/types";

export function NamePicker({ group, onPick }: { group: Group; onPick: (n: string) => void }) {
  const [name, setName] = useState("");
  return (
    <section className="chunky rounded-3xl bg-card p-5">
      <h2 className="font-display text-2xl font-bold">First things first: who are you?</h2>
      {group.members.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {group.members.map((m) => (
            <button key={m.name} onClick={() => onPick(m.name)} className="chunky press h-14 rounded-2xl bg-sun font-display text-lg font-semibold">
              {m.name}
            </button>
          ))}
        </div>
      )}
      <p className="mt-5 text-sm text-muted-foreground">{group.members.length ? "Not on the list?" : "Type your name to join."}</p>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onPick(name.trim());
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="h-14 min-w-0 flex-1 rounded-2xl border-2 border-input bg-background px-4 text-lg outline-none"
        />
        <button className="chunky press h-14 rounded-2xl bg-primary px-5 font-display font-bold text-primary-foreground">Join</button>
      </form>
    </section>
  );
}

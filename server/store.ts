import { randomBytes } from "node:crypto";
import type { Group, Member } from "../shared/types";
import { config } from "./config";
import { AppError } from "./errors";
import { log } from "./log";
import { mockConstraints } from "./mockData";
import { nowISO } from "./time";

export const DEMO_GROUP_ID = "g_demo";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function newId(): string {
  const bytes = randomBytes(6);
  return "g_" + [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** In-memory group store. State is lost on restart; the demo group is re-seeded each boot. */
export class Store {
  private groups = new Map<string, Group>();

  create(name: string, memberNames: string[] = [], id?: string): Group {
    const now = nowISO();
    const group: Group = {
      id: id ?? this.uniqueId(),
      name,
      city: config.city,
      createdAt: now,
      status: "collecting",
      members: [],
      plans: [],
      confirmedPlanId: null,
    };
    for (const n of memberNames) this.ensureMember(group, n);
    this.groups.set(group.id, group);
    return group;
  }

  private uniqueId(): string {
    let id = newId();
    while (this.groups.has(id)) id = newId();
    return id;
  }

  get(id: string): Group {
    const g = this.groups.get(id);
    if (!g) throw new AppError(404, "GROUP_NOT_FOUND", `No group with id ${id}`);
    return g;
  }

  findMember(group: Group, name: string): Member | undefined {
    return group.members.find((m) => sameName(m.name, name));
  }

  /** Case-insensitive; keeps the name as first submitted. */
  ensureMember(group: Group, name: string): Member {
    const existing = this.findMember(group, name);
    if (existing) return existing;
    const member: Member = { name: name.trim(), joinedAt: nowISO(), constraints: null };
    group.members.push(member);
    return member;
  }

  size() {
    return this.groups.size;
  }

  /** Demo group "Friday crew" with Maya, Jordan and Priya's notes from mock/constraints.sample.json. */
  seedDemo(): Group {
    const samples = mockConstraints();
    const group = this.create("Friday crew", [], DEMO_GROUP_ID);
    for (const c of samples) {
      const m = this.ensureMember(group, c.memberName);
      m.constraints = structuredClone(c);
    }
    log.info("store", `seeded demo group ${group.id} with ${group.members.length} members`);
    return group;
  }
}

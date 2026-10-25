import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";

vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });

describe("voting (mock mode)", () => {
  beforeEach(() => localStorage.clear());

  it("confirms a plan only when its votes exceed half the group", async () => {
    const g = await api.createGroup({ name: "Crew", memberNames: ["Maya", "Jordan", "Priya"] });
    await api.submitTextNote(g.id, "Maya", "Friday");
    await api.submitTextNote(g.id, "Jordan", "Friday");
    await api.generatePlans(g.id);
    const one = await api.vote(g.id, "p_1", "Maya");
    expect(one.group.status).toBe("voting");
    const two = await api.vote(g.id, "p_1", "Jordan");
    expect(two.group.status).toBe("confirmed");
    expect(two.group.confirmedPlanId).toBe("p_1");
  }, 20000);
});

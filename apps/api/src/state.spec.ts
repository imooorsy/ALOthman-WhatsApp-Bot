import {
  ConversationMachine as Machine,
  secretaryLink,
  statuses,
} from "@osman/shared";
describe("conversation state machine", () => {
  it.each([
    ["continue", "agent_active"],
    ["handoff", "human"],
    ["handoff_urgent", "urgent"],
    ["not_suitable", "not_suitable"],
    ["completed", "waiting_schedule"],
  ] as const)("%s maps to %s", (action, status) =>
    expect(Machine.agentAction(action)).toBe(status),
  );
  it.each(statuses)(
    "never calls the agent outside agent_active: %s",
    (status) =>
      expect(Machine.inbound(status, false, false).callAgent).toBe(
        status === "agent_active",
      ),
  );
  it.each(statuses)("global pause routes inbound to human: %s", (status) =>
    expect(Machine.inbound(status, true, false)).toMatchObject({
      status: "human",
      callAgent: false,
      notify: true,
    }),
  );
  it("routes attachments to human by default", () =>
    expect(Machine.inbound("agent_active", false, true)).toMatchObject({
      status: "human",
      callAgent: false,
      reason: "مرفق",
    }));
  it("supports configurable attachment handling", () =>
    expect(
      Machine.inbound("agent_active", false, true, {
        attachmentHandoff: false,
        notifyWaiting: true,
        notifyNotSuitable: false,
      }).callAgent,
    ).toBe(true));
  it("stores not_suitable silently and notifies for waiting_schedule", () => {
    expect(Machine.inbound("not_suitable", false, false).notify).toBe(false);
    expect(Machine.inbound("waiting_schedule", false, false).notify).toBe(true);
  });
  it("blocks another employee from taking or returning an assigned chat", () => {
    expect(() => Machine.staff("take", "other", "me")).toThrow();
    expect(() => Machine.staff("resume", "other", "me")).toThrow();
    expect(Machine.staff("resume", "me", "me")).toEqual({
      status: "agent_active",
      assignedStaffId: null,
    });
  });
  it("enforces the exact 24 hour boundary and statuses", () => {
    const now = Date.now();
    expect(Machine.canCompose("human", new Date(now - 86399999), now)).toBe(
      true,
    );
    expect(Machine.canCompose("urgent", new Date(now - 86400000), now)).toBe(
      false,
    );
    expect(Machine.canCompose("agent_active", new Date(now), now)).toBe(false);
  });
});
describe("secretary link", () => {
  it("encodes Arabic, ampersands and newlines safely", () => {
    const client = {
      name: "أحمد & علي",
      phone: "+966501234567",
      category: "تجاري",
      summary: "نص\n?& #",
    };
    const url = new URL(secretaryLink("+966509876543", client));
    expect(url.hostname).toBe("wa.me");
    expect(url.pathname).toBe("/966509876543");
    expect(url.searchParams.get("text")).toContain("أحمد & علي");
    expect(url.searchParams.get("text")).toContain("نص\n?& #");
    expect(url.searchParams.get("text")).toMatch(/بانتظار تحديد موعد$/);
  });
  it("blocks missing or malformed numbers", () => {
    for (const number of ["", "javascript:alert(1)", "+12"])
      expect(() =>
        secretaryLink(number, {
          name: null,
          phone: "+966501234567",
          category: null,
          summary: null,
        }),
      ).toThrow();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared mock state for the service-role client. Lives in a hoisted block
// so the vi.mock factory below can close over it.
const h = vi.hoisted(() => ({
  state: {
    owned: null as { id: string } | null,
    ownedCustomField: null as { id: string } | null,
    deal: null as { id: string } | null,
    calendarEvent: null as { id: string } | null,
    account: null as { default_currency: string } | null,
    aiReplyText: "hot",
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    fromCalls: [] as string[],
    updateCalls: [] as { table: string; filters: [string, string, unknown][]; payload?: unknown }[],
    upsertCalls: [] as { table: string; payload: unknown }[],
    insertCalls: [] as { table: string; payload: unknown }[],
  },
}));

vi.mock("./admin-client", () => {
  const { state } = h;

  function resolve(ops: {
    table: string;
    type: string;
    payload?: unknown;
    filters: [string, string, unknown][];
  }) {
    const { table, type } = ops;
    if (table === "contacts") {
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters, payload: ops.payload });
        return { data: null, error: null };
      }
      // ownership guard / condition read
      return { data: state.owned, error: null };
    }
    if (table === "custom_fields") {
      // account-scoped ownership lookup for a custom field definition
      return { data: state.ownedCustomField, error: null };
    }
    if (table === "contact_custom_values") {
      if (type === "upsert") {
        state.upsertCalls.push({ table, payload: ops.payload });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "automations") return { data: state.automations, error: null };
    if (table === "automation_logs") {
      if (type === "insert") return { data: { id: "log1" }, error: null };
      if (type === "update") return { data: null, error: null };
      return { data: { steps_executed: [], status: "success" }, error: null };
    }
    if (table === "automation_steps") return { data: state.steps, error: null };
    if (table === "deals") {
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters, payload: ops.payload });
        return { data: null, error: null };
      }
      if (type === "insert") {
        state.insertCalls.push({ table, payload: ops.payload });
        return { data: null, error: null };
      }
      return { data: state.deal, error: null };
    }
    if (table === "calendar_events") {
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters, payload: ops.payload });
        return { data: null, error: null };
      }
      return { data: state.calendarEvent, error: null };
    }
    if (table === "accounts") {
      return { data: state.account ?? { default_currency: "USD" }, error: null };
    }
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = {
      table,
      type: "select",
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = "insert"), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = "update"), (ops.payload = p), b),
      delete: () => ((ops.type = "delete"), b),
      upsert: (p: unknown) => ((ops.type = "upsert"), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(["eq", k, v]), b),
      gte: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t);
        return builder(t);
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
}));

vi.mock("@/lib/ai/generate", () => ({
  generateReply: vi.fn(async () => ({ text: h.state.aiReplyText, handoff: false })),
}));

vi.mock("@/lib/ai/config", () => ({
  loadAiConfig: vi.fn(async () => ({ provider: "openai", apiKey: "x" })),
}));

import { runAutomationsForTrigger } from "./engine";
import { generateReply } from "@/lib/ai/generate";

const ACCOUNT = "acct-1";

beforeEach(() => {
  h.state.owned = null;
  h.state.ownedCustomField = null;
  h.state.deal = null;
  h.state.calendarEvent = null;
  h.state.account = null;
  h.state.aiReplyText = "hot";
  h.state.automations = [];
  h.state.steps = [];
  h.state.fromCalls = [];
  h.state.updateCalls = [];
  h.state.upsertCalls = [];
  h.state.insertCalls = [];
});

describe("runAutomationsForTrigger — tenant isolation", () => {
  it("refuses to dispatch when the contact is not in the account (GHSA-63cv-2c49-m5v3)", async () => {
    // Ownership lookup returns nothing — the contact belongs to another tenant.
    h.state.owned = null;
    // If the guard failed, this automation would run an update_contact_field step.
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "victim-contact-uuid",
      context: { message_text: "manual trigger" },
    });

    // Bailed at the guard: never fetched automations, never wrote a contact.
    expect(h.state.fromCalls).toContain("contacts");
    expect(h.state.fromCalls).not.toContain("automations");
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("proceeds past the guard when the contact belongs to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = []; // no matching automations; just prove we got past the guard

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.fromCalls).toContain("automations");
  });

  it("scopes the update_contact_field write to the automation's account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const filters = h.state.updateCalls[0].filters;
    expect(filters).toContainEqual(["eq", "id", "c1"]);
    expect(filters).toContainEqual(["eq", "account_id", ACCOUNT]);
  });
});

describe("update_contact_field — custom fields", () => {
  it("upserts contact_custom_values when the field is account-owned", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "Premium")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // No direct contacts column write for a custom field.
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].payload).toEqual({
      contact_id: "c1",
      custom_field_id: "cf1",
      value: "Premium",
    });
  });

  it("interpolates {{ vars.* }} into the custom value", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "{{ vars.source }}")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { vars: { source: "WhatsApp Ad" } },
    });

    expect(h.state.upsertCalls).toHaveLength(1);
    expect(
      (h.state.upsertCalls[0].payload as { value: string }).value,
    ).toBe("WhatsApp Ad");
  });

  it("refuses to write a custom field from another account", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = null; // account-scoped lookup finds nothing
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:foreign-cf", "x")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.upsertCalls).toHaveLength(0);
    expect(h.state.updateCalls).toHaveLength(0);
  });
});

function automationWithUpdateStep() {
  return {
    id: "a1",
    account_id: ACCOUNT,
    user_id: "u1",
    trigger_type: "new_message_received",
    trigger_config: {},
    is_active: true,
  };
}

function updateStep() {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field: "company", value: "pwned-by-automation" },
  };
}

function customStep(field: string, value: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field, value },
  };
}

function singleStep(step_type: string, step_config: Record<string, unknown>) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type,
    position: 0,
    parent_step_id: null,
    step_config,
  };
}

function baseAutomation() {
  return {
    id: "a1",
    account_id: ACCOUNT,
    user_id: "u1",
    trigger_type: "new_message_received",
    trigger_config: {},
    is_active: true,
  };
}

describe("update_deal step", () => {
  it("updates the contact's most recent deal scoped to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.deal = { id: "d1" };
    h.state.automations = [baseAutomation()];
    h.state.steps = [singleStep("update_deal", { stage_id: "st2", status: "won" })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    const dealUpdates = h.state.updateCalls.filter((c) => c.table === "deals");
    expect(dealUpdates).toHaveLength(1);
    const filters = dealUpdates[0].filters;
    expect(filters).toContainEqual(["eq", "id", "d1"]);
    expect(filters).toContainEqual(["eq", "account_id", ACCOUNT]);
  });

  it("creates a deal when create_if_missing and none exists", async () => {
    h.state.owned = { id: "c1" };
    h.state.deal = null; // no existing deal
    h.state.account = { default_currency: "BRL" };
    h.state.automations = [baseAutomation()];
    h.state.steps = [
      singleStep("update_deal", {
        stage_id: "st1",
        pipeline_id: "p1",
        title: "Lead from keyword",
        create_if_missing: true,
        value: 500,
      }),
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { vars: {} },
    });

    const inserts = h.state.insertCalls.filter((c) => c.table === "deals");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toMatchObject({
      account_id: ACCOUNT,
      pipeline_id: "p1",
      stage_id: "st1",
      contact_id: "c1",
      title: "Lead from keyword",
      value: 500,
      currency: "BRL",
      status: "open",
    });
  });

  it("skips when no deal exists and create_if_missing is false", async () => {
    h.state.owned = { id: "c1" };
    h.state.deal = null;
    h.state.automations = [baseAutomation()];
    h.state.steps = [singleStep("update_deal", { stage_id: "st2" })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls.filter((c) => c.table === "deals")).toHaveLength(0);
    expect(h.state.insertCalls.filter((c) => c.table === "deals")).toHaveLength(0);
  });
});

describe("calendar_update_status step", () => {
  it("picks the contact's next upcoming event and updates its status", async () => {
    h.state.owned = { id: "c1" };
    h.state.calendarEvent = { id: "ev1" };
    h.state.automations = [baseAutomation()];
    h.state.steps = [singleStep("calendar_update_status", { status: "cancelled" })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    const eventUpdates = h.state.updateCalls.filter((c) => c.table === "calendar_events");
    expect(eventUpdates).toHaveLength(1);
    expect(eventUpdates[0].payload).toMatchObject({ status: "cancelled" });
    const filters = eventUpdates[0].filters;
    expect(filters).toContainEqual(["eq", "id", "ev1"]);
    expect(filters).toContainEqual(["eq", "account_id", ACCOUNT]);
  });

  it("skips when the contact has no upcoming event", async () => {
    h.state.owned = { id: "c1" };
    h.state.calendarEvent = null;
    h.state.automations = [baseAutomation()];
    h.state.steps = [singleStep("calendar_update_status", { status: "cancelled" })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls.filter((c) => c.table === "calendar_events")).toHaveLength(0);
  });
});

describe("ai_classify step", () => {
  it("calls the model with the labels and stores the matched label into vars", async () => {
    vi.mocked(generateReply).mockClear();
    h.state.owned = { id: "c1" };
    h.state.aiReplyText = "warm";
    h.state.automations = [baseAutomation()];
    h.state.steps = [
      singleStep("ai_classify", {
        prompt: "Classify purchase intent.",
        labels: ["hot", "warm", "cold"],
        store_var: "lead_tier",
      }),
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "I'm comparing options", vars: {} },
    });

    expect(generateReply).toHaveBeenCalledTimes(1);
    const [call] = vi.mocked(generateReply).mock.calls;
    expect(call[0].systemPrompt).toContain("hot, warm, cold");
    expect(call[0].systemPrompt).toContain("Classify purchase intent");
  });

  it("uses the configured fallback without calling the model on an empty message", async () => {
    vi.mocked(generateReply).mockClear();
    h.state.owned = { id: "c1" };
    h.state.automations = [baseAutomation()];
    h.state.steps = [
      singleStep("ai_classify", {
        prompt: "Classify.",
        labels: ["hot", "warm", "cold"],
        store_var: "lead_tier",
        fallback: "cold",
      }),
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "  ", vars: {} },
    });

    expect(generateReply).not.toHaveBeenCalled();
  });

  it("throws a friendly error when no labels are configured", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [baseAutomation()];
    h.state.steps = [singleStep("ai_classify", { prompt: "Classify.", labels: [] })];

    // The engine catches step errors and records a failed log; the run must
    // not reject. Assert nothing threw by awaiting without rejection.
    await expect(
      runAutomationsForTrigger({
        accountId: ACCOUNT,
        triggerType: "new_message_received",
        contactId: "c1",
        context: { message_text: "hello", vars: {} },
      }),
    ).resolves.toBeUndefined();
  });
});

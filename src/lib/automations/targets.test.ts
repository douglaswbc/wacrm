import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  tagRows: [] as { contact_id: string; contacts?: { account_id: string } }[],
  dealRows: [] as { contact_id: string }[],
  calls: [] as { table: string; filters: [string, string, unknown][] }[],
}));

vi.mock("./admin-client", () => {
  const state = h;

  function resolve(ops: {
    table: string;
    filters: [string, string, unknown][];
  }) {
    state.calls.push({ table: ops.table, filters: ops.filters });
    if (ops.table === "contact_tags") return { data: state.tagRows, error: null };
    if (ops.table === "deals") return { data: state.dealRows, error: null };
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = { table, filters: [] as [string, string, unknown][] };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (k: string, v: unknown) => (ops.filters.push(["eq", k, v]), b),
      in: (k: string, v: unknown) => (ops.filters.push(["in", k, v]), b),
      not: () => b,
      lt: (k: string, v: unknown) => (ops.filters.push(["lt", k, v]), b),
      lte: (k: string, v: unknown) => (ops.filters.push(["lte", k, v]), b),
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
      from: (t: string) => builder(t),
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

import {
  resolveTargetMode,
  resolveTargetContacts,
} from "./targets";

const ACCOUNT = "acct-1";

beforeEach(() => {
  h.tagRows = [];
  h.dealRows = [];
  h.calls = [];
});

describe("resolveTargetMode", () => {
  it("uses target_mode when present", () => {
    expect(resolveTargetMode({ target_mode: "tags" })).toBe("tags");
    expect(resolveTargetMode({ target_mode: "pipeline" })).toBe("pipeline");
    expect(resolveTargetMode({ target_mode: "both" })).toBe("both");
  });

  it("infers pipeline from pipeline_id, else defaults to tags", () => {
    expect(resolveTargetMode({ pipeline_id: "p1" })).toBe("pipeline");
    expect(resolveTargetMode({})).toBe("tags");
  });
});

describe("resolveTargetContacts — pipeline mode", () => {
  const pipelineCfg = {
    target_mode: "pipeline",
    pipeline_id: "p1",
    stage_id: "st1",
    deal_status: "open",
  };

  it("returns unique contact_ids scoped to the account and pipeline", async () => {
    h.dealRows = [
      { contact_id: "c1" },
      { contact_id: "c2" },
      { contact_id: "c1" },
    ];

    const ids = await resolveTargetContacts(ACCOUNT, pipelineCfg);

    expect(ids).toEqual(["c1", "c2"]);
    const dealCall = h.calls.find((c) => c.table === "deals")!;
    expect(dealCall.filters).toContainEqual(["eq", "account_id", ACCOUNT]);
    expect(dealCall.filters).toContainEqual(["eq", "pipeline_id", "p1"]);
    expect(dealCall.filters).toContainEqual(["eq", "stage_id", "st1"]);
    expect(dealCall.filters).toContainEqual(["eq", "status", "open"]);
  });

  it("adds updated_at/created_at cutoffs when deal_inactivity_days is set", async () => {
    h.dealRows = [{ contact_id: "c1" }];
    const days = 7;

    const ids = await resolveTargetContacts(ACCOUNT, {
      ...pipelineCfg,
      deal_inactivity_days: days,
    });

    expect(ids).toEqual(["c1"]);
    const dealCall = h.calls.find((c) => c.table === "deals")!;
    const lt = dealCall.filters.find(([op]) => op === "lt")!;
    const lte = dealCall.filters.find(([op]) => op === "lte")!;
    expect(lt[1]).toBe("updated_at");
    expect(lte[1]).toBe("created_at");

    const expected = Date.now() - days * 86_400_000;
    expect(Date.parse(lt[2] as string)).toBeLessThanOrEqual(expected + 5_000);
    expect(Date.parse(lt[2] as string)).toBeGreaterThan(expected - 5_000);
    expect(Date.parse(lte[2] as string)).toBeCloseTo(
      Date.parse(lt[2] as string),
      -1,
    );
  });

  it("omits inactivity filters when deal_inactivity_days is not set", async () => {
    h.dealRows = [{ contact_id: "c1" }];

    await resolveTargetContacts(ACCOUNT, pipelineCfg);

    const dealCall = h.calls.find((c) => c.table === "deals")!;
    expect(dealCall.filters.some(([op]) => op === "lt" || op === "lte")).toBe(
      false,
    );
  });
});

describe("resolveTargetContacts — tags mode", () => {
  it("returns unique contact_ids scoped to the account", async () => {
    h.tagRows = [
      { contact_id: "c1", contacts: { account_id: ACCOUNT } },
      { contact_id: "c2", contacts: { account_id: ACCOUNT } },
      { contact_id: "c1", contacts: { account_id: ACCOUNT } },
    ];

    const ids = await resolveTargetContacts(ACCOUNT, {
      target_mode: "tags",
      tag_ids: ["t1", "t2"],
    });

    expect(ids).toEqual(["c1", "c2"]);
    const tagCall = h.calls.find((c) => c.table === "contact_tags")!;
    expect(tagCall.filters).toContainEqual(["in", "tag_id", ["t1", "t2"]]);
    expect(tagCall.filters).toContainEqual(["eq", "contacts.account_id", ACCOUNT]);
  });

  it("returns [] when no tag_ids are configured", async () => {
    await expect(
      resolveTargetContacts(ACCOUNT, { target_mode: "tags" }),
    ).resolves.toEqual([]);
  });
});

describe("resolveTargetContacts — both mode (intersection)", () => {
  it("returns only contacts in both the tags and pipeline sets", async () => {
    h.tagRows = [
      { contact_id: "c1", contacts: { account_id: ACCOUNT } },
      { contact_id: "c2", contacts: { account_id: ACCOUNT } },
    ];
    h.dealRows = [{ contact_id: "c2" }, { contact_id: "c3" }];

    const ids = await resolveTargetContacts(ACCOUNT, {
      target_mode: "both",
      tag_ids: ["t1"],
      pipeline_id: "p1",
    });

    expect(ids).toEqual(["c2"]);
  });

  it("returns [] when the tag set is empty", async () => {
    h.tagRows = [];
    h.dealRows = [{ contact_id: "c1" }];

    const ids = await resolveTargetContacts(ACCOUNT, {
      target_mode: "both",
      tag_ids: ["t1"],
      pipeline_id: "p1",
    });

    expect(ids).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { anonClient, makeUser } from "../helpers/clients";

const ID = "00000000-0000-0000-0000-0000000000aa";

// Internal building blocks: the database functions call them as their owner. Signed-in users and
// visitors must not be able to call them directly (they would bypass the role checks of the public functions).
const INTERNAL: [string, Record<string, unknown>][] = [
  ["_ledger", { p_enrollment_id: ID }],
  ["_balance", { p_enrollment_id: ID }],
  ["_remaining_minutes", { p_enrollment_id: ID }],
  ["_remaining_value", { p_enrollment_id: ID }],
  ["_offer_free_seats", { p_class_id: ID }],
  ["lesson_earning", { p_lesson_id: ID }],
  ["current_class_rate", { p_class_id: ID }],
  ["enrollment_access", { p_enrollment_id: ID }],
  ["can_manage_lessons", { p_class_id: ID }],
  ["create_renewal_invoice", { p_enrollment_id: ID, p_actor: ID }],
  ["mark_invoice_paid", { p_invoice_id: ID }],
  ["log_invoice_event", { p_invoice_id: ID, p_action: "x" }],
  ["notify", { p_user: ID, p_kind: "x", p_title: "fake", p_body: "", p_link: null }],
  ["require_admin", {}],
  ["fail", { p_code: "X", p_message: "y" }],
  ["run_scheduled_jobs", {}],
];

describe("internal functions cannot be called by users or visitors", () => {
  it.each(INTERNAL)("%s is refused to a signed-in student", async (name, args) => {
    const student = await makeUser("student");
    const { error } = await student.client.rpc(name, args);
    expect(error, `${name} should be refused`).not.toBeNull();
    expect(error!.code).toBe("42501"); // permission denied: the function exists but is not for users
  });

  it("refuses an anonymous visitor on the public functions and on the internal ones", async () => {
    const anon = anonClient();
    for (const [name, args] of [["list_open_classes", {}], ["enroll_in_class", { p_class_id: ID, p_accept_terms: true }], ["is_admin", {}], ...INTERNAL] as [string, Record<string, unknown>][]) {
      const { error } = await anon.rpc(name, args);
      expect(error, `${name} should be refused to a visitor`).not.toBeNull();
    }
  });
});

describe("trigger and formatting helpers are not callable either", () => {
  it("refuses a student calling a trigger function or a formatting helper", async () => {
    const student = await makeUser("student");
    for (const [name, args] of [["rupiah_text", { p_amount: 1 }], ["wib_text", { p_ts: new Date().toISOString() }]] as [string, Record<string, unknown>][]) {
      const { error } = await student.client.rpc(name, args);
      expect(error, `${name} should be refused`).not.toBeNull();
    }
  });
});

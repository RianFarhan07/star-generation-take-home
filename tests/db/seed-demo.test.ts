import { describe, expect, it } from "vitest";
import { SEED, signIn } from "../helpers/clients";
import { previousMonth } from "../helpers/fixtures";

// Read-only checks of the demo history in supabase/seed.sql. They describe the state right after
// `npm run db:reset`; no other test creates or changes data for the seed users.
describe("demo history in the seed", () => {
  it("gives Budi 1.5 hours left (Low) and one unpaid renewal invoice issued by the system", async () => {
    const budi = await signIn(SEED.budi.email);
    const enrollment = await budi.from("enrollments").select("id, status").eq("class_id", SEED.classId).single();
    expect(enrollment.data!.status).toBe("active");

    const { data, error } = await budi.rpc("enrollment_balance", { p_enrollment_id: enrollment.data!.id });
    expect(error).toBeNull();
    expect(data[0]).toMatchObject({ purchased_minutes: 720, used_minutes: 630, remaining_minutes: 90, low_hours: true });

    const invoices = await budi.from("invoices").select("kind, status, amount, issued_by").eq("enrollment_id", enrollment.data!.id).order("issued_at");
    expect(invoices.data).toEqual([
      { kind: "initial", status: "paid", amount: 1800000, issued_by: null },
      { kind: "renewal", status: "unpaid", amount: 1800000, issued_by: null },
    ]);
  });

  it("has a submitted logbook ready for the admin: 4 lessons, Rp600,000 to approve", async () => {
    const admin = await signIn(SEED.admin.email);
    const books = await admin.from("logbooks").select("id, month, status").eq("class_id", SEED.classId).order("month");
    expect(books.data!.map((b) => b.status)).toEqual(["submitted", "draft"]);
    const submitted = books.data![0];
    const preview = await admin.rpc("preview_logbook_earnings", { p_logbook_id: submitted.id });
    expect(preview.data).toHaveLength(4);
    expect((preview.data as { amount: number }[]).reduce((sum, r) => sum + r.amount, 0)).toBe(600000);
  });

  it("has last month's logbook as a draft with one lesson still missing its entry", async () => {
    const admin = await signIn(SEED.admin.email);
    const month = previousMonth().firstDay;
    const book = await admin.from("logbooks").select("id, status").eq("class_id", SEED.classId).eq("month", month).single();
    expect(book.data!.status).toBe("draft");
    const entries = await admin.from("logbook_entries").select("id").eq("logbook_id", book.data!.id);
    expect(entries.data).toHaveLength(2);

    const andi = await signIn(SEED.andi.email);
    const statement = await andi.rpc("tutor_earnings_statement", { p_month: month });
    const rows = statement.data as { status: string; has_entry: boolean }[];
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => !r.has_entry)).toHaveLength(1);
    expect(rows.every((r) => r.status === "taught")).toBe(true);
  });

  it("has two upcoming lessons for Budi's schedule", async () => {
    const budi = await signIn(SEED.budi.email);
    const upcoming = await budi.from("lessons").select("id").eq("class_id", SEED.classId).gt("starts_at", new Date().toISOString());
    expect(upcoming.data).toHaveLength(2);
  });

  it("leaves one seat so the reviewer can enroll Sari and watch Citra be refused", async () => {
    const citra = await signIn(SEED.citra.email);
    const { data } = await citra.rpc("list_open_classes");
    const row = (data as { class_id: string; seats_left: number; my_enrollment_id: string | null }[]).find((r) => r.class_id === SEED.classId);
    expect(row).toMatchObject({ seats_left: 1, my_enrollment_id: null });
  });

  it("gives Dewi no class and Sari no enrollment", async () => {
    const dewi = await signIn(SEED.dewi.email);
    expect((await dewi.from("classes").select()).data).toEqual([]);
    const sari = await signIn(SEED.sari.email);
    expect((await sari.from("enrollments").select()).data).toEqual([]);
  });
});

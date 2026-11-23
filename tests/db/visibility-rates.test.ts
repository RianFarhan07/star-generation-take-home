import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, makeUser, SEED, signIn } from "../helpers/clients";
import { adminClient, createClass } from "../helpers/fixtures";

// Read-only checks on the seed users plus fresh users for the catalog.
describe("rates are visible to admin only", () => {
  it("returns no class_rates rows to the class's own tutor", async () => {
    const andi = await signIn(SEED.andi.email);
    const { data, error } = await andi.from("class_rates").select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("returns no class_rates rows to a student", async () => {
    const budi = await signIn(SEED.budi.email);
    const { data, error } = await budi.from("class_rates").select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("returns the rate history to the admin", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.from("class_rates").select().eq("class_id", SEED.classId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].student_rate_per_hour).toBe(150000);
    expect(data![0].tutor_rate_per_hour).toBe(100000);
  });

  it("gives an anonymous visitor nothing", async () => {
    const anon = anonClient();
    const rates = await anon.from("class_rates").select();
    const profiles = await anon.from("profiles").select();
    expect(rates.error !== null || rates.data?.length === 0).toBe(true);
    expect(profiles.error !== null || profiles.data?.length === 0).toBe(true);
  });
});

describe("class and profile visibility", () => {
  it("lets the assigned tutor read the class, without any rate column", async () => {
    const andi = await signIn(SEED.andi.email);
    const { data } = await andi.from("classes").select().eq("id", SEED.classId);
    expect(data).toHaveLength(1);
    expect(data![0]).not.toHaveProperty("student_rate_per_hour");
  });

  it("shows another tutor no classes", async () => {
    const dewi = await signIn(SEED.dewi.email);
    const { data, error } = await dewi.from("classes").select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("lets a student read their own profile but not another student's", async () => {
    const budi = await signIn(SEED.budi.email);
    const own = await budi.from("profiles").select().eq("id", SEED.budi.id);
    const other = await budi.from("profiles").select().eq("id", SEED.sari.id);
    expect(own.data).toHaveLength(1);
    expect(other.data).toEqual([]);
  });
});

describe("catalog (list_open_classes)", () => {
  let classId: string;
  beforeAll(async () => {
    const tutor = await makeUser("tutor");
    classId = await createClass(await adminClient(), { tutorId: tutor.id });
  });

  it("shows a student the package price and seats left, and never the tutor rate", async () => {
    const student = await makeUser("student");
    const { data, error } = await student.client.rpc("list_open_classes");
    expect(error).toBeNull();
    const row = (data as Record<string, unknown>[]).find((r) => r.class_id === classId);
    expect(row).toBeDefined();
    expect(row!.package_hours).toBe(12);
    expect(row!.package_price).toBe(1800000);
    expect(row!.seats_left).toBe(2);
    expect(row!.my_enrollment_id).toBeNull();
    for (const key of Object.keys(row!)) expect(key).not.toContain("tutor_rate");
  });
});

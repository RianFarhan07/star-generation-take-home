import { describe, expect, it } from "vitest";
import { expectCode, makeUser } from "../helpers/clients";
import { adminClient, createClass } from "../helpers/fixtures";

describe("class administration", () => {
  it("lets only an admin create a class", async () => {
    const tutor = await makeUser("tutor");
    const student = await makeUser("student");
    const args = {
      p_name: "Nope",
      p_description: "",
      p_tutor_id: tutor.id,
      p_capacity: 2,
      p_package_hours: 12,
      p_student_rate: 150000,
      p_tutor_rate: 100000,
    };
    await expectCode(tutor.client.rpc("create_class", args), "NOT_ALLOWED");
    await expectCode(student.client.rpc("create_class", args), "NOT_ALLOWED");
  });

  it("rejects a class with capacity 0 or a non-tutor as its tutor", async () => {
    const admin = await adminClient();
    const student = await makeUser("student");
    const base = { p_name: "X", p_description: "", p_package_hours: 12, p_student_rate: 150000, p_tutor_rate: 100000 };
    await expectCode(admin.rpc("create_class", { ...base, p_tutor_id: student.id, p_capacity: 2 }), "VALIDATION");
    const tutor = await makeUser("tutor");
    await expectCode(admin.rpc("create_class", { ...base, p_tutor_id: tutor.id, p_capacity: 0 }), "VALIDATION");
  });

  it("keeps a rate history: changing rates adds a row instead of overwriting", async () => {
    const admin = await adminClient();
    const tutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: tutor.id });
    const { error } = await admin.rpc("set_class_rates", { p_class_id: classId, p_student_rate: 175000, p_tutor_rate: 120000 });
    expect(error).toBeNull();
    const { data } = await admin.from("class_rates").select().eq("class_id", classId).order("effective_from");
    expect(data).toHaveLength(2);
    expect(data![0].student_rate_per_hour).toBe(150000);
    expect(data![1].student_rate_per_hour).toBe(175000);
  });

  it("does not let a tutor change rates, details or capacity", async () => {
    const admin = await adminClient();
    const tutor = await makeUser("tutor");
    const classId = await createClass(admin, { tutorId: tutor.id });
    await expectCode(tutor.client.rpc("set_class_rates", { p_class_id: classId, p_student_rate: 1, p_tutor_rate: 1 }), "NOT_ALLOWED");
    await expectCode(
      tutor.client.rpc("update_class_details", { p_class_id: classId, p_name: "Mine now", p_description: "", p_package_hours: 1 }),
      "NOT_ALLOWED",
    );
    await expectCode(tutor.client.rpc("set_class_capacity", { p_class_id: classId, p_capacity: 99 }), "NOT_ALLOWED");
  });

  it("blocks direct table writes by signed-in users (writes only go through functions)", async () => {
    const tutor = await makeUser("tutor");
    const classId = await createClass(await adminClient(), { tutorId: tutor.id });
    const insert = await tutor.client.from("classes").insert({ name: "Sneaky", tutor_id: tutor.id, capacity: 99 });
    expect(insert.error).not.toBeNull();
    const update = await tutor.client.from("classes").update({ capacity: 99 }).eq("id", classId).select();
    expect(update.error !== null || update.data?.length === 0).toBe(true);
  });
});

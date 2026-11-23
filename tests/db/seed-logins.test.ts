import { describe, expect, it } from "vitest";
import { SEED, signIn } from "../helpers/clients";

describe("seeded logins", () => {
  const users = [SEED.admin, SEED.andi, SEED.dewi, SEED.budi, SEED.sari, SEED.citra];

  it.each(users)("$email can sign in and gets the fixed user id", async (user) => {
    const client = await signIn(user.email);
    const { data, error } = await client.auth.getUser();
    expect(error).toBeNull();
    expect(data.user?.id).toBe(user.id);
  });

  it("rejects a wrong password", async () => {
    await expect(signIn(SEED.admin.email, "wrong-password")).rejects.toThrow(/Sign-in failed/);
  });
});

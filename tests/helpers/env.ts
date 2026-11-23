import { config } from "dotenv";

// Loads local Supabase keys for the integration tests. Missing file is fine for unit tests.
config({ path: ".env.local", quiet: true });

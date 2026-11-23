import { redirect } from "next/navigation";

// Replaced by the overview page in the improvements step.
export default function AdminHome() {
  redirect("/admin/classes");
}

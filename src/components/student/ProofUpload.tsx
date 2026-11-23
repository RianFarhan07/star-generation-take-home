"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ALLOWED = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Optional proof of transfer. The file goes to the student's own folder of a private bucket
 * ("<student id>/..."); the form then sends only the stored path. A screenshot is not proof by itself
 * (the admin checks the bank statement), it just helps the admin find the transfer.
 */
export function ProofUpload({ userId, invoiceId }: { userId: string; invoiceId: string }) {
  const [path, setPath] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPath("");
    setMessage(null);
    if (!file) return;
    if (!ALLOWED.includes(file.type)) return setMessage("Please choose a PNG, JPEG, WebP or PDF file.");
    if (file.size > MAX_BYTES) return setMessage("The file is larger than 5 MB.");

    setBusy(true);
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "bin";
    const target = `${userId}/${invoiceId}-${Date.now()}.${extension}`;
    const { error } = await createClient().storage.from("payment-proofs").upload(target, file, { contentType: file.type });
    setBusy(false);
    if (error) return setMessage("The file could not be uploaded. You can send your report without it.");
    setPath(target);
    setMessage("Proof attached.");
  }

  return (
    <div>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">Proof of transfer (optional)</span>
      <input
        type="file"
        accept={ALLOWED.join(",")}
        onChange={onChange}
        className="block w-full text-sm file:mr-3 file:rounded-card file:border file:border-cloud file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold"
      />
      <input type="hidden" name="proofPath" value={path} />
      {busy ? <p className="mt-1 text-xs text-muted">Uploading…</p> : null}
      {message ? <p className="mt-1 text-xs text-muted">{message}</p> : null}
    </div>
  );
}

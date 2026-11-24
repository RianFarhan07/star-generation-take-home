"use client";

import { useRef, useState } from "react";
import { buttonClass } from "@/components/ui/Button";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { formatRupiah, parseRupiah } from "@/lib/money";

/**
 * The submit button of the "I have paid" form. When the amount typed is less than the invoice it first explains
 * what that means (the admin can only confirm a transfer that covers the invoice) and lets the student fix the
 * amount or report it anyway, instead of sending a report that is certain to come back.
 */
export function ReportPaymentButton({ invoiceAmount, label }: { invoiceAmount: number; label: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const [typed, setTyped] = useState(0);

  function check(event: React.MouseEvent<HTMLButtonElement>) {
    const target = event.currentTarget.form;
    if (!target || !target.checkValidity()) return; // let the browser point at the missing field first
    form.current = target;
    const field = target.elements.namedItem("amount");
    const amount = field instanceof HTMLInputElement ? parseRupiah(field.value) : null;
    if (amount !== null && amount > 0 && amount < invoiceAmount) {
      event.preventDefault();
      setTyped(amount);
      dialog.current?.showModal();
    }
  }

  function reportAnyway() {
    dialog.current?.close();
    form.current?.requestSubmit();
  }

  return (
    <>
      <SubmitButton onClick={check}>{label}</SubmitButton>
      <dialog
        ref={dialog}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-card border border-cloud bg-white p-0 text-navy shadow-lg backdrop:bg-navy/40"
      >
        <div className="space-y-3 p-5 text-sm">
          <h2 className="text-base font-bold">This is less than the invoice</h2>
          <dl className="grid grid-cols-2 gap-1 rounded-card bg-field p-3">
            <dt className="text-muted">Invoice</dt>
            <dd className="text-right font-semibold">{formatRupiah(invoiceAmount)}</dd>
            <dt className="text-muted">You are reporting</dt>
            <dd className="text-right font-semibold">{formatRupiah(typed)}</dd>
            <dt className="text-muted">Still missing</dt>
            <dd className="text-right font-bold text-destructive">{formatRupiah(invoiceAmount - typed)}</dd>
          </dl>
          <p>
            The admin can only confirm a transfer that covers the whole invoice, so this report cannot be confirmed as it is. If you have paid
            only part of it, transfer the rest first and then report the <strong>total</strong> you transferred (both transfers added up).
          </p>
          <p className="text-muted">
            If you send this report anyway, the admin will normally return it to you with what is missing, and your seat stays held while you pay
            the rest. If the transfer cannot be found on the bank statement it can be rejected, which releases the seat.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass("secondary")} onClick={() => dialog.current?.close()}>
              Change the amount
            </button>
            <button type="button" className={buttonClass("primary")} onClick={reportAnyway}>
              Report anyway
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

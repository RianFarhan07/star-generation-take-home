"use client";

import type { InputHTMLAttributes } from "react";
import { formatGrouped } from "@/lib/money";
import { Input } from "./Field";

const CLEAN = /^\d{1,3}(\.\d{3})*$/; // a number whose dots are all proper thousands separators

/** Regroups what was typed and puts the caret back after the same number of digits it was after before. */
function regroup(input: HTMLInputElement, afterDelete: boolean) {
  const caret = input.selectionStart ?? input.value.length;
  const digitsBeforeCaret = input.value.slice(0, caret).replace(/\D/g, "").length;
  const grouped = formatGrouped(input.value, { afterDelete });
  if (grouped !== input.value) {
    input.value = grouped;
    let position = 0;
    let seen = 0;
    while (position < grouped.length && seen < digitsBeforeCaret) {
      if (/\d/.test(grouped[position])) seen += 1;
      position += 1;
    }
    input.setSelectionRange(position, position);
  }
  input.dataset.clean = CLEAN.test(input.value) ? "1" : "0";
}

/**
 * A text box for an amount in rupiah that shows thousands dots as the person types ("1800000" -> "1.800.000").
 * The value sent is what is shown; the server reads it with parseRupiah, which accepts exactly this format.
 */
export function MoneyInput({ defaultValue, onInput, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <Input
      inputMode="numeric"
      autoComplete="off"
      defaultValue={defaultValue === undefined ? undefined : formatGrouped(String(defaultValue))}
      data-clean={defaultValue !== undefined && CLEAN.test(formatGrouped(String(defaultValue))) ? "1" : "0"}
      onInput={(event) => {
        const input = event.currentTarget;
        // A deletion in a cleanly grouped number is regrouped; in anything else the text is left as typed.
        const deleted = (event.nativeEvent as InputEvent).inputType?.startsWith("delete") ?? false;
        regroup(input, deleted && input.dataset.clean === "1");
        onInput?.(event);
      }}
      {...props}
    />
  );
}

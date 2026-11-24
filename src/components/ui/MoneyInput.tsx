"use client";

import type { InputHTMLAttributes } from "react";
import { formatGrouped } from "@/lib/money";
import { Input } from "./Field";

/** Puts the caret back after the same number of digits it was after before the text was regrouped. */
function regroup(input: HTMLInputElement) {
  const caret = input.selectionStart ?? input.value.length;
  const digitsBeforeCaret = input.value.slice(0, caret).replace(/\D/g, "").length;
  const grouped = formatGrouped(input.value);
  if (grouped === input.value) return;
  input.value = grouped;
  let position = 0;
  let seen = 0;
  while (position < grouped.length && seen < digitsBeforeCaret) {
    if (/\d/.test(grouped[position])) seen += 1;
    position += 1;
  }
  input.setSelectionRange(position, position);
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
      onInput={(event) => {
        regroup(event.currentTarget);
        onInput?.(event);
      }}
      {...props}
    />
  );
}

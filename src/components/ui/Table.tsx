import type { ReactNode } from "react";

/** A bordered card holding a table: muted header, thin Cloud lines between rows. Scrolls inside the card on small screens. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card border border-cloud bg-white">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th className={`border-b border-cloud px-3 py-2 text-left text-xs font-medium text-muted ${className}`}>{children}</th>;
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`border-b border-cloud px-3 py-2.5 align-middle ${className}`}>{children}</td>;
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="[&:last-child>td]:border-b-0">{children}</tr>;
}

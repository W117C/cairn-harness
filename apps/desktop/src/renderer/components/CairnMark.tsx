/** Decorative brand mark; CSS masks inherit the surrounding theme color. */
export function CairnMark({ outline = false, className = "" }: { outline?: boolean; className?: string }) {
  return <span aria-hidden="true" className={`cairn-mark${outline ? " cairn-mark-outline" : ""} ${className}`} />;
}

import { TextMorph } from "torph/react";
import { cn } from "@/lib/utils";

/**
 * A number or short label that morphs when it changes: digits roll by place value, words swap letter by letter.
 * Only for display. torph keeps a hidden copy of the text for screen readers next to the animated letters, so the
 * element's textContent holds the text twice. Don't use it where a test or a label reads the text.
 */
export function Morph({ value, className }: { value: string | number; className?: string }) {
  return (
    <TextMorph className={cn("num", className)} ease={{ stiffness: 260, damping: 26 }}>
      {String(value)}
    </TextMorph>
  );
}

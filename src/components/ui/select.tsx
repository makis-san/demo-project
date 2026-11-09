import { cn } from "@/lib/utils";
import { forwardRef, type SelectHTMLAttributes } from "react";
import { fieldClass } from "./input";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

// A native select, so phones get their own picker. The chevron is drawn by .select-chevron in styles.css.
const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(fieldClass, "select-chevron cursor-pointer pr-10", className)} {...props}>
    {children}
  </select>
));
Select.displayName = "Select";

export { Select };
export type { SelectProps };

import { Eye, EyeOff } from "lucide-react";
import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Password field with a show/hide toggle (design-system.md 11.3).
 * The toggle carries an accessible name; the input keeps the standard
 * autocomplete contract for password managers.
 */
export function PasswordInput({
  id,
  label,
  autoComplete,
  value,
  onChange,
  minLength = 8,
  hint,
}: {
  id: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
  minLength?: number;
  hint?: string;
}) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 pr-11"
        />
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
          className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-text-subtle transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      {hint ? (
        <p className="text-[12px] text-text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

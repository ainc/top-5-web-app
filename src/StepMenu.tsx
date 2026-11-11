// Previous, menu, and next, shared by the person picker and the team menu.
// Both used to carry their own open state, outside-click close, keyboard
// handling, and wrap. A change to one of those then had to be copied by hand.
// Callers still own the option labels and the words on the closed button.

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

export type StepOption = {
  value: string;
  label: string;
};

type StepMenuProps = {
  options: StepOption[];
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  closedLabel: string;
  previousLabel: string;
  nextLabel: string;
  menuLabel: string;
  listLabel: string;
  trailing?: ReactNode;
};

export function StepMenu({
  options,
  value,
  onChange,
  compact = false,
  closedLabel,
  previousLabel,
  nextLabel,
  menuLabel,
  listLabel,
  trailing = null,
}: StepMenuProps) {
  const index = options.findIndex((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // An empty list, or a value that is not in the list, does nothing so a
  // stale key cannot wrap onto the wrong option.
  function step(direction: -1 | 1) {
    if (options.length < 2 || index < 0) return;
    const next = (index + direction + options.length) % options.length;
    onChange(options[next].value);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    boxRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, value]);

  function onMenuKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (open) step(1);
      else setOpen(true);
    } else if (event.key === "ArrowUp" && open) {
      event.preventDefault();
      step(-1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((shown) => !shown);
    }
  }

  return (
    <div className={compact ? "person-switch is-compact" : "person-switch"}>
      <div className="person-switch-box" ref={boxRef}>
        <button type="button" className="person-step" aria-label={previousLabel} disabled={options.length < 2} onClick={() => step(-1)}>
          ‹
        </button>
        <div className="person-menu">
          <button
            type="button"
            className="person-menu-button"
            aria-label={menuLabel}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((shown) => !shown)}
            onKeyDown={onMenuKey}
          >
            {closedLabel}
          </button>
          {open ? (
            <ul id={listId} className="person-menu-list" role="listbox" aria-label={listLabel}>
              {options.map((option) => (
                <li key={`option:${option.value}`} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button type="button" className="person-step" aria-label={nextLabel} disabled={options.length < 2} onClick={() => step(1)}>
          ›
        </button>
      </div>
      {trailing}
    </div>
  );
}

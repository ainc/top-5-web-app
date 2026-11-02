// Person menu shared by My week and the dashboard.
// The 5 Across judges app puts a previous/next control on either side of the
// pitch dropdown so a judge can move through companies without opening the
// menu. Kyle asked for the same pair here, plus a way back to the signed-in
// person's own week.
// Previous and next wrap. A five-person roster is short, and a dead button at
// either end made the control look broken during the rainmaker review.
// The return button is optional. My week uses it to reselect the signed-in
// person. The dashboard uses it to leave this page for that person's My week.
// It stays hidden until a Google account is linked to a roster name, because
// there is no "your week" to return to.
// The menu is ours, not a native <select>. Chrome on Windows paints that
// popup as a blank blue bar over the page once the site is in dark mode, and
// remounting the select did not stop it.

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { pickerName } from "../names";

type PersonChoice = {
  key: string;
  person: string;
};

type PersonPickerProps = {
  people: PersonChoice[];
  value: string;
  nicknames: Record<string, string>;
  signedInName: string;
  onChange: (key: string) => void;
  onReturn?: () => void;
  returnDisabled?: boolean;
};

export function PersonPicker({
  people,
  value,
  nicknames,
  signedInName,
  onChange,
  onReturn,
  returnDisabled = false,
}: PersonPickerProps) {
  const index = people.findIndex((person) => person.key === value);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = index >= 0 ? people[index] : undefined;

  // Step by one roster row. An empty list, or a value that is not in the list,
  // does nothing so a stale key cannot wrap onto the wrong person.
  function step(direction: -1 | 1) {
    if (people.length < 2 || index < 0) return;
    const next = (index + direction + people.length) % people.length;
    onChange(people[next].key);
  }

  function labelFor(person: PersonChoice) {
    return pickerName(person.person, nicknames, person.person === signedInName);
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
    <div className="person-switch">
      <div className="person-switch-box" ref={boxRef}>
        <button
          type="button"
          className="person-step"
          aria-label="Previous person"
          disabled={people.length < 2}
          onClick={() => step(-1)}
        >
          ‹
        </button>
        <div className="person-menu">
          <button
            type="button"
            className="person-menu-button"
            aria-label="Look at someone's tasks"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((shown) => !shown)}
            onKeyDown={onMenuKey}
          >
            {current ? labelFor(current) : "Choose a person"}
          </button>
          {open ? (
            <ul id={listId} className="person-menu-list" role="listbox" aria-label="Look at someone's tasks">
              {people.map((person) => (
                <li key={person.key} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={person.key === value}
                    onClick={() => {
                      onChange(person.key);
                      setOpen(false);
                    }}
                  >
                    {labelFor(person)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button
          type="button"
          className="person-step"
          aria-label="Next person"
          disabled={people.length < 2}
          onClick={() => step(1)}
        >
          ›
        </button>
      </div>
      {onReturn ? (
        <button type="button" className="my-week-jump" disabled={returnDisabled} onClick={onReturn}>
          My week
        </button>
      ) : null}
    </div>
  );
}

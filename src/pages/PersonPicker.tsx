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

  // Step by one roster row. An empty list, or a value that is not in the list,
  // does nothing so a stale key cannot wrap onto the wrong person.
  function step(direction: -1 | 1) {
    if (people.length < 2 || index < 0) return;
    const next = (index + direction + people.length) % people.length;
    onChange(people[next].key);
  }

  return (
    <div className="person-switch">
      <div className="person-switch-box">
        <button
          type="button"
          className="person-step"
          aria-label="Previous person"
          disabled={people.length < 2}
          onClick={() => step(-1)}
        >
          ‹
        </button>
        <select aria-label="Look at someone's tasks" value={value} onChange={(event) => onChange(event.target.value)}>
          {people.map((person) => (
            <option key={person.key} value={person.key}>
              {pickerName(person.person, nicknames, person.person === signedInName)}
            </option>
          ))}
        </select>
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

// Person menu shared by My week and the dashboard.
// The 5 Across judges app puts a previous/next control on either side of the
// pitch dropdown so a judge can move through companies without opening the
// menu. Kyle asked for the same pair here, plus a way back to the signed-in
// person's own week.
// Previous and next wrap. A five-person roster is short, and a dead button at
// either end made the control look broken during the rainmaker review.
// The return button is optional. The dashboard uses it to leave this page for
// that person's My week. It stays hidden until a Google account is linked to
// a roster name, because there is no "your week" to return to.
// My week asks for the compact switcher. It sits beside the page title and
// reads "Viewing: You" when the list is the signed-in person. The previous
// and next buttons stay on that compact control. The wide picker adds the
// My week return button beside them.
// The menu itself is StepMenu. The labels below are the only person-specific
// part: nicknames, and "You" for the signed-in roster name.

import { pickerName } from "../names";
import { StepMenu } from "../StepMenu";

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
  compact?: boolean;
};

export function PersonPicker({
  people,
  value,
  nicknames,
  signedInName,
  onChange,
  onReturn,
  returnDisabled = false,
  compact = false,
}: PersonPickerProps) {
  const current = people.find((person) => person.key === value);

  function labelFor(person: PersonChoice) {
    return pickerName(person.person, nicknames, person.person === signedInName);
  }

  // The closed compact control names the viewer, not the roster nickname.
  // "You" is the signed-in person. Everyone else is their display name.
  function closedLabel() {
    if (!current) return "Choose a person";
    if (!compact) return labelFor(current);
    if (current.person === signedInName) return "Viewing: You";
    return `Viewing: ${pickerName(current.person, nicknames, false)}`;
  }

  return (
    <StepMenu
      scope="person"
      compact={compact}
      options={people.map((person) => ({ value: person.key, label: labelFor(person) }))}
      value={value}
      onChange={onChange}
      closedLabel={closedLabel()}
      previousLabel="Previous person"
      nextLabel="Next person"
      menuLabel={compact ? "Whose week" : "Look at someone's tasks"}
      listLabel="Look at someone's tasks"
      trailing={
        !compact && onReturn ? (
          <button type="button" className="my-week-jump" disabled={returnDisabled} onClick={onReturn}>
            My week
          </button>
        ) : null
      }
    />
  );
}

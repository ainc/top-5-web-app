import { expect, it } from "vitest";
import { onReload, reload } from "./reloadBoard";

// A save calls reload(). The board and the signed-in profile each subscribe.
// This checks that a call reaches every current subscriber and that a
// subscriber removed on unmount does not run again.
it("tells each subscriber once, and skips one that unsubscribed", () => {
  const seen: string[] = [];
  const stopFirst = onReload(() => seen.push("board"));
  const stopSecond = onReload(() => seen.push("profile"));
  reload();
  stopSecond();
  reload();
  stopFirst();
  reload();
  expect(seen).toEqual(["board", "profile", "board"]);
});

// Shown for any address that is not a real page. The illustration already
// says 404, so the words under it only tell the person how to get back.
// Storyset's license asks for a credit when the picture is used.

import { NavLink } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="page not-found">
      <div className="not-found-art">
        <img src="/404-animal.png" alt="A cat tangled in yarn beside a sign that says 404 error" />
      </div>
      <h1>That page does not exist</h1>
      <p>The address does not match a page in Top 5.</p>
      <NavLink className="not-found-home" to="/">
        Back to My week
      </NavLink>
      <p className="not-found-credit">
        Illustration by{" "}
        <a href="https://storyset.com/illustration/404-error-with-a-cute-animal/pana">Storyset</a>
      </p>
    </section>
  );
}

// Shown while the open season is still loading. The words stay for screen
// readers. The rings are the thing a person sees: dashed circles that grow
// outward and fade, one after another.

import type { CSSProperties } from "react";

const RIPPLE_COUNT = 16;

export function ScorecardLoading() {
  return (
    <div className="scorecard-loading" role="status">
      <span
        className="loading-ripples"
        aria-hidden="true"
        style={
          {
            "--ripple-count": String(RIPPLE_COUNT),
            "--ripple-tan": String(Math.tan(Math.PI / RIPPLE_COUNT)),
          } as CSSProperties
        }
      >
        {Array.from({ length: RIPPLE_COUNT }, (_, index) => (
          <span
            key={index}
            className="loading-ripple"
            style={{ "--ripple-index": String(index) } as CSSProperties}
          />
        ))}
      </span>
      <span className="scorecard-loading-label">Loading the scorecard…</span>
    </div>
  );
}

// Shown while the open season is still loading. The words stay for screen
// readers. The wheel is the thing a person sees.

export function ScorecardLoading() {
  return (
    <div className="scorecard-loading" role="status">
      <span className="loading-wheel" aria-hidden="true" />
      <span className="scorecard-loading-label">Loading the scorecard…</span>
    </div>
  );
}

/** The fixed backdrop behind every screen: the logo's three bars, blurred, for the glass panels to frost. */
export function Stage() {
  return (
    <div className="stage" aria-hidden="true">
      <div className="stage__bars">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

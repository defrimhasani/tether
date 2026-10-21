/** Decorative pixel-art landscape behind the main canvas. Styles live in index.css under `.scenery`. */
export function Scenery() {
  return (
    <div className="scenery" aria-hidden>
      <div className="stars" />
      <div className="orb" />
      <div className="clouds" />
      <div className="range far" />
      <div className="range near" />
      <div className="plane" />
    </div>
  );
}

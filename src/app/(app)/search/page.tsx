/**
 * The Search page. On a phone it is deliberately empty: the search box lives in the top bar (TopBar shows it here and
 * only here) and its suggestions and results open right under it. A desktop already has that box on every page, so a
 * visitor who lands here gets a pointer to it instead of a blank screen.
 */
export default function SearchPage() {
  return (
    <p className="hidden md:block p-6 text-sm text-muted">Use the search box at the top to find songs, playlists and FX.</p>
  );
}

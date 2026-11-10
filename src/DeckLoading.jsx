export function DeckLoading({ children }) {
  return <p className="deck-loading" role="status">
    <span className="deck-spinner" aria-hidden="true" />
    {children}
  </p>;
}
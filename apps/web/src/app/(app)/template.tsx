/** Re-mounts on every navigation, so each screen eases in like a pushed view. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}

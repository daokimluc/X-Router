// Re-mounts on every navigation, so it re-runs the entrance animation each
// time the route changes (a layout would not). Wraps the Suspense/loading
// boundary, giving every console page a consistent fade-in-up on arrival.
export default function ConsoleTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="animate-fade-in-up">{children}</div>;
}

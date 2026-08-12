// Re-mounts on each navigation between marketing pages, replaying the entrance
// animation. Sits below the persistent SiteHeader/SiteFooter in the layout.
export default function MarketingTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="animate-fade-in-up">{children}</div>;
}

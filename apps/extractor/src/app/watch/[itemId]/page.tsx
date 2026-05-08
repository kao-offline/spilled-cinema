import { WatchShell } from "./watch-shell";

export default async function WatchPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  return <WatchShell itemId={itemId} />;
}

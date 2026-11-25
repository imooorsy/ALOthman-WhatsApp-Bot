import { Chats } from "../../../components/chats";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Chats selectedId={id} />;
}

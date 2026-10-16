import { Clarify } from '@/components/app/clarify';

export default async function IntentPage({ params }: PageProps<'/app/intents/[id]'>) {
  const { id } = await params;
  return <Clarify intentId={id} />;
}

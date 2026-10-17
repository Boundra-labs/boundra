import { MandateReview } from '@/components/app/mandate-review';

export default async function MandatePage({ params }: PageProps<'/app/mandates/[id]'>) {
  const { id } = await params;
  return <MandateReview mandateId={id} />;
}

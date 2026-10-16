import { OwnerHome } from '@/components/app/owner-home';

/** Account setup, then a new goal; `?goal=` carries the text typed on the homepage. */
export default async function AppHome({ searchParams }: PageProps<'/app'>) {
  const { goal } = await searchParams;
  return <OwnerHome initialGoal={typeof goal === 'string' ? goal.slice(0, 2000) : ''} />;
}

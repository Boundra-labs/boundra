import { OwnerHome } from '@/components/app/owner-home';

/**
 * Account setup, then the overview or a new goal. `?goal=` carries the text typed on the homepage;
 * `?new=1` starts a new goal even when a mandate exists.
 */
export default async function AppHome({ searchParams }: PageProps<'/app'>) {
  const { goal, new: startNew } = await searchParams;
  return (
    <OwnerHome
      initialGoal={typeof goal === 'string' ? goal.slice(0, 2000) : ''}
      startNew={startNew === '1'}
    />
  );
}

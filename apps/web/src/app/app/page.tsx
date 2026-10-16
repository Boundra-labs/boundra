import { StartIntent } from '@/components/app/start-intent';

/** Start a mandate from a goal; `?goal=` carries the text typed on the homepage. */
export default async function AppHome({ searchParams }: PageProps<'/app'>) {
  const { goal } = await searchParams;
  return <StartIntent initialGoal={typeof goal === 'string' ? goal.slice(0, 2000) : ''} />;
}

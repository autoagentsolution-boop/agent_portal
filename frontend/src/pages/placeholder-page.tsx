import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

export function PlaceholderPage({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
          <CardDescription>This page is wired in {phase}.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            Backend endpoints exist; UI implementation is on the schedule.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

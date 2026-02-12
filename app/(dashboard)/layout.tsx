import DashboardShell from '../components/DashboardShell';

export const runtime = 'edge';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardShell>{children}</DashboardShell>;
}

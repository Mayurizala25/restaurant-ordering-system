import { AdminProvider } from "./_lib/admin-provider";

export const instant = false;

export default function AdminLayout({
  children,
}: LayoutProps<"/admin">) {
  return <AdminProvider>{children}</AdminProvider>;
}

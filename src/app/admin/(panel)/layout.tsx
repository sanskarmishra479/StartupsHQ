import { AdminShell } from "@/components/admin/shell/AdminShell";
import { requirePanel } from "../_lib/session";

// Everything past sign-in. The session is checked here and again by each page's own reads.

export default async function PanelLayout({ children }: LayoutProps<"/admin">) {
  const { user, isAdmin } = await requirePanel();
  return (
    <AdminShell user={{ email: user.email, name: user.name, isAdmin }}>
      {children}
    </AdminShell>
  );
}

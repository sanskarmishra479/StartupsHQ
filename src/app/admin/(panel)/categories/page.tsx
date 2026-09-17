import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/PageHeader";
import { CategoryCopyEditor } from "@/components/admin/tools/CategoryCopyEditor";
import { PUBLIC_READ } from "@/server/auth/context";
import { getCategoryDirectory } from "@/server/cache/categories";
import { listCategoryCopy } from "@/server/services/admin-panel";
import { requirePanel } from "../../_lib/session";

// FR-205: copy for existing facet values only — the list is the public directory itself, so a
// value with no published company has no page and nothing to edit.

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesAdminPage() {
  const { ctx } = await requirePanel();
  const [directory, copy] = await Promise.all([
    getCategoryDirectory(PUBLIC_READ),
    listCategoryCopy(ctx),
  ]);
  return (
    <>
      <PageHeader
        title="Categories"
        description="Headings, introductions and search snippets for category pages."
      />
      <CategoryCopyEditor directory={directory} copy={copy} />
    </>
  );
}

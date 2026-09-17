import { Logo } from "@/components/brand/Logo";

// Sign-in, enrolment and password reset: one narrow column, nothing else on the page.

export default function AuthLayout({ children }: LayoutProps<"/admin">) {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-4 py-12"
    >
      <p className="flex items-center gap-2">
        <Logo wordmark className="text-base" />
        <span className="meta text-fg-subtle">Admin</span>
      </p>
      {children}
    </main>
  );
}

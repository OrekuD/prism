import { Outlet } from "react-router-dom";
import { PublicFooter } from "@/components/public/public-footer";
import { PublicNav } from "@/components/public/public-nav";

/**
 * Public layout (design-system.md 10.2): public nav, 1120px framed rail
 * with 1px side borders, page content, and the compact footer.
 */
export function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-text">
      <PublicNav />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-[1120px] border-x border-border">
          <Outlet />
          <PublicFooter />
        </div>
      </main>
    </div>
  );
}

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
      <main className="flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col border-x border-border">
          <div className="flex flex-1 flex-col">
            <Outlet />
          </div>
          <PublicFooter />
        </div>
      </main>
    </div>
  );
}

import { Outlet } from "react-router-dom";
import { MarketingHeader } from "./MarketingHeader";
import { MarketingFooter } from "./MarketingFooter";

export function MarketingLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader />
      <main>
        <Outlet />
      </main>
      <MarketingFooter />
    </div>
  );
}


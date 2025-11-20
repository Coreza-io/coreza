import { Link } from "react-router-dom";
import { TrendingUp } from "lucide-react";

export function MarketingFooter() {
  return (
    <footer className="py-12 px-4 border-t border-border bg-card/30 mt-16">
      <div className="container mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <Link to="/" className="flex items-center gap-2">
            <div className="p-2 bg-gradient-primary rounded-lg">
              <TrendingUp className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <span className="text-xl font-bold">Coreza</span>
              <p className="text-sm text-muted-foreground">
                Professional Trading Workflow Platform
              </p>
            </div>
          </Link>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <Link to="/documentation" className="hover:text-foreground transition-colors">
              Documentation
            </Link>
            <Link to="/support" className="hover:text-foreground transition-colors">
              Support
            </Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">
              Terms
            </Link>
          </div>
        </div>
        <div className="text-center mt-8 text-sm text-muted-foreground">
          © {new Date().getFullYear()} Coreza. All rights reserved.
        </div>
      </div>
    </footer>
  );
}


import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TrendingUp, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const navLinks = [
  { label: "Features", hash: "#features" },
  { label: "Pricing", to: "/pricing" },
  { label: "How it Works", hash: "#how-it-works" },
  { label: "Documentation", to: "/documentation" },
  { label: "Support", to: "/support" },
];

export function MarketingHeader() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const isLandingPage = location.pathname === "/";

  const renderNavLink = (link: (typeof navLinks)[number]) => {
    if (link.hash) {
      if (isLandingPage) {
        return (
          <a
            key={link.label}
            href={link.hash}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {link.label}
          </a>
        );
      }

      return (
        <Link
          key={link.label}
          to={{ pathname: "/", hash: link.hash }}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {link.label}
        </Link>
      );
    }

    return (
      <Link
        key={link.label}
        to={link.to!}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {link.label}
      </Link>
    );
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="p-2 bg-gradient-primary rounded-lg shadow-glow">
            <TrendingUp className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold">Coreza</span>
        </Link>
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map(renderNavLink)}
        </div>
        {!loading && user ? (
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" className="rounded-full p-3">
                <User className="h-4 w-4" />
                <span className="text-sm font-medium">{user?.identities?.[0]?.identity_data?.first_name}</span>
              </Button>
            </Link>
          </div>
        ) : loading ? (
          <div className="flex items-center gap-4">
            <User className="h-4 w-4" />
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <Link to="/login">
              <Button variant="ghost">Login</Button>
            </Link>
            <Link to="/signup">
              <Button className="bg-gradient-primary hover:shadow-glow">
                Get Started
              </Button>
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}


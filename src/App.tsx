import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { UserPreferencesProvider } from "@/contexts/UserPreferencesContext";
import Landing from "./pages/Landing";
import Pricing from "./pages/Pricing";
import Documentation from "./pages/Documentation";
import Support from "./pages/Support";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Interface from "./pages/Interface";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <UserPreferencesProvider>
        <ThemeProvider defaultTheme="dark" storageKey="coreza-theme">
          <TooltipProvider>
            <div className="min-h-screen bg-background text-foreground transition-colors">
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route path="/pricing" element={<Pricing />} />
                  <Route path="/documentation" element={<Documentation />} />
                  <Route path="/support" element={<Support />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/signup" element={<Signup />} />
                  <Route path="/dashboard/*" element={<Interface />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </div>
          </TooltipProvider>
        </ThemeProvider>
      </UserPreferencesProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
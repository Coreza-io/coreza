import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { 
  Search, BookOpen, Code, Zap, TrendingUp, Database, 
  Brain, Settings, Lock, FileText, ExternalLink, ChevronRight,
  Activity, BarChart3, Bot, Shield, Clock, Workflow
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const Documentation = () => {
  const categories = [
    {
      title: "Getting Started",
      icon: Zap,
      gradient: "bg-gradient-to-br from-primary/20 to-primary/5",
      items: [
        "Quick Start Guide",
        "Installation & Setup",
        "Your First Workflow",
        "Understanding Nodes",
      ],
    },
    {
      title: "Node Reference",
      icon: Workflow,
      gradient: "bg-gradient-to-br from-blue-500/20 to-blue-500/5",
      items: [
        "Indicators (RSI, MACD, EMA, BB)",
        "Broker Nodes (Alpaca, Schwab, Dhan)",
        "Logic Nodes (If, Loop, Switch)",
        "AI Nodes (OpenAI, ChatModel)",
      ],
    },
    {
      title: "Integrations",
      icon: Database,
      gradient: "bg-gradient-to-br from-purple-500/20 to-purple-500/5",
      items: [
        "Broker Setup (API Keys, OAuth)",
        "Data Providers",
        "AI Services",
        "Email & Notifications",
      ],
    },
    {
      title: "Advanced Topics",
      icon: Brain,
      gradient: "bg-gradient-to-br from-orange-500/20 to-orange-500/5",
      items: [
        "Workflow Best Practices",
        "Performance Optimization",
        "Backtesting Strategies",
        "Risk Management Patterns",
      ],
    },
    {
      title: "API Reference",
      icon: Code,
      gradient: "bg-gradient-to-br from-green-500/20 to-green-500/5",
      items: [
        "REST API",
        "WebSocket Feeds",
        "Webhook Integrations",
        "Authentication",
      ],
    },
    {
      title: "Examples & Tutorials",
      icon: BookOpen,
      gradient: "bg-gradient-to-br from-pink-500/20 to-pink-500/5",
      items: [
        "Momentum Trading Strategy",
        "News-Based Trading",
        "Portfolio Rebalancing",
        "Multi-Timeframe Analysis",
      ],
    },
  ];

  const quickLinks = [
    { title: "GitHub Repository", icon: Code, url: "#" },
    { title: "Community Discord", icon: ExternalLink, url: "#" },
    { title: "Video Tutorials", icon: Activity, url: "#" },
    { title: "API Status", icon: BarChart3, url: "#" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              <Zap className="h-6 w-6 text-primary" />
              <span className="font-bold text-xl">Coreza</span>
            </Link>
            <div className="flex items-center gap-6">
              <Link to="/#features" className="text-muted-foreground hover:text-foreground transition-colors">
                Features
              </Link>
              <Link to="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">
                Pricing
              </Link>
              <Link to="/documentation" className="text-foreground font-medium">
                Documentation
              </Link>
              <Link to="/support" className="text-muted-foreground hover:text-foreground transition-colors">
                Support
              </Link>
              <div className="flex items-center gap-4 ml-4">
                <Link 
                  to="/login"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  Login
                </Link>
                <Link 
                  to="/signup"
                  className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Get Started
                </Link>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-20 pb-12 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="text-5xl md:text-6xl font-bold mb-6">
              Documentation
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Everything you need to build powerful trading workflows
            </p>
            
            {/* Search Bar */}
            <div className="max-w-2xl mx-auto relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5" />
              <Input
                type="text"
                placeholder="Search documentation..."
                className="pl-12 h-14 text-lg"
              />
            </div>
          </motion.div>
        </div>
      </section>

      {/* Documentation Categories */}
      <section className="py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {categories.map((category, index) => {
              const Icon = category.icon;
              return (
                <motion.div
                  key={category.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                >
                  <Card className="h-full hover:shadow-lg transition-shadow group cursor-pointer">
                    <CardHeader>
                      <div className={`w-12 h-12 rounded-lg ${category.gradient} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                        <Icon className="h-6 w-6 text-primary" />
                      </div>
                      <CardTitle className="text-xl">{category.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {category.items.map((item) => (
                          <li key={item} className="flex items-start gap-2 text-muted-foreground hover:text-foreground transition-colors">
                            <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            <span className="text-sm">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Quick Links */}
      <section className="py-12 px-4 bg-muted/30">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold mb-8 text-center">Quick Links</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {quickLinks.map((link) => {
              const Icon = link.icon;
              return (
                <a
                  key={link.title}
                  href={link.url}
                  className="flex items-center gap-3 p-4 rounded-lg bg-card border border-border hover:border-primary/50 transition-all group"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <span className="font-medium">{link.title}</span>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Zap className="h-5 w-5 text-primary" />
                <span className="font-bold">Coreza</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Visual trading workflow automation platform
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-3">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/#features" className="hover:text-foreground transition-colors">Features</Link></li>
                <li><Link to="/pricing" className="hover:text-foreground transition-colors">Pricing</Link></li>
                <li><Link to="/documentation" className="hover:text-foreground transition-colors">Documentation</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/support" className="hover:text-foreground transition-colors">Support</Link></li>
                <li><Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link></li>
                <li><Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3">Connect</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">GitHub</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Discord</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Twitter</a></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-border/40 text-center text-sm text-muted-foreground">
            <p>© 2024 Coreza. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Documentation;

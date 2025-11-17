import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { 
  Search, Zap, BookOpen, MessageCircle, Mail, ExternalLink,
  ChevronDown, CheckCircle2, AlertCircle
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const Support = () => {
  const supportOptions = [
    {
      title: "Documentation",
      description: "Browse comprehensive guides and tutorials",
      icon: BookOpen,
      link: "/documentation",
      gradient: "bg-gradient-to-br from-blue-500/20 to-blue-500/5",
    },
    {
      title: "Community",
      description: "Join our Discord and connect with other traders",
      icon: MessageCircle,
      link: "#",
      gradient: "bg-gradient-to-br from-purple-500/20 to-purple-500/5",
      external: true,
    },
    {
      title: "Email Support",
      description: "Get direct help from our team (24h response)",
      icon: Mail,
      link: "#contact",
      gradient: "bg-gradient-to-br from-orange-500/20 to-orange-500/5",
    },
  ];

  const faqs = [
    {
      question: "How do I connect my broker account?",
      answer: "Navigate to Settings > Integrations, select your broker (Alpaca, Schwab, or Dhan), and follow the OAuth flow or enter your API credentials. All credentials are encrypted and stored securely.",
    },
    {
      question: "What indicators are available?",
      answer: "Coreza supports all major technical indicators including RSI, MACD, EMA, Bollinger Bands, Ichimoku, Stochastic, ADX, Volume Oscillator, Support/Resistance, and more. Each indicator is a drag-and-drop node in the workflow canvas.",
    },
    {
      question: "How do I backtest my strategy?",
      answer: "Use the Backtest feature in your workflow settings. Specify a date range, initial capital, and commission rates. The system will simulate your strategy against historical data and provide detailed performance metrics.",
    },
    {
      question: "How does billing work?",
      answer: "Plans are billed monthly or annually. You can upgrade, downgrade, or cancel anytime. Annual plans save 20%. Free plan includes 100 executions/month. All paid plans start with a 14-day free trial.",
    },
    {
      question: "Can I export my workflows?",
      answer: "Yes! You can export workflows as JSON files from the workflow menu. This allows you to backup, share, or migrate workflows between accounts.",
    },
    {
      question: "What's the difference between plans?",
      answer: "Plans differ in execution limits, number of broker connections, available features (AI analysis, advanced backtesting), and support level. See our Pricing page for detailed comparison.",
    },
    {
      question: "How secure is my data?",
      answer: "We use AES-256 encryption for data at rest, TLS for data in transit, and store broker credentials encrypted. We never have access to your actual trading accounts, only execute orders via secure API connections.",
    },
    {
      question: "How do I schedule workflows?",
      answer: "Add a Scheduler node to your workflow. You can set cron expressions for precise timing (e.g., market open, every 15 minutes) or use simple presets (daily, hourly, etc.).",
    },
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
              <Link to="/documentation" className="text-muted-foreground hover:text-foreground transition-colors">
                Documentation
              </Link>
              <Link to="/support" className="text-foreground font-medium">
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
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="text-5xl md:text-6xl font-bold mb-6">
              How can we help you?
            </h1>
            <p className="text-xl text-muted-foreground mb-8">
              Get assistance with your trading workflows
            </p>
            
            {/* Search Bar */}
            <div className="max-w-2xl mx-auto relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5" />
              <Input
                type="text"
                placeholder="Search for help..."
                className="pl-12 h-14 text-lg"
              />
            </div>
          </motion.div>
        </div>
      </section>

      {/* System Status Banner */}
      <section className="px-4 pb-12">
        <div className="max-w-4xl mx-auto">
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 flex items-center justify-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <span className="text-sm font-medium">All systems operational</span>
          </div>
        </div>
      </section>

      {/* Support Options */}
      <section className="py-12 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-3 gap-6">
            {supportOptions.map((option, index) => {
              const Icon = option.icon;
              return (
                <motion.div
                  key={option.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                >
                  <Link to={option.link}>
                    <Card className="h-full hover:shadow-lg transition-all group cursor-pointer">
                      <CardHeader>
                        <div className={`w-12 h-12 rounded-lg ${option.gradient} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                          <Icon className="h-6 w-6 text-primary" />
                        </div>
                        <CardTitle className="flex items-center gap-2">
                          {option.title}
                          {option.external && <ExternalLink className="h-4 w-4" />}
                        </CardTitle>
                        <CardDescription>{option.description}</CardDescription>
                      </CardHeader>
                    </Card>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Popular Help Topics (FAQ) */}
      <section className="py-12 px-4 bg-muted/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold mb-8 text-center">Popular Help Topics</h2>
          <Accordion type="single" collapsible className="space-y-4">
            {faqs.map((faq, index) => (
              <AccordionItem key={index} value={`item-${index}`} className="bg-card border border-border rounded-lg px-6">
                <AccordionTrigger className="hover:no-underline">
                  <span className="text-left font-medium">{faq.question}</span>
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* Contact Form */}
      <section id="contact" className="py-16 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold mb-4">Still need help?</h2>
            <p className="text-muted-foreground">Send us a message and we'll get back to you within 24 hours</p>
          </div>
          
          <Card>
            <CardContent className="pt-6">
              <form className="space-y-6">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" placeholder="Your name" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" placeholder="you@example.com" />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="technical">Technical Support</SelectItem>
                      <SelectItem value="billing">Billing</SelectItem>
                      <SelectItem value="feature">Feature Request</SelectItem>
                      <SelectItem value="bug">Bug Report</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Input id="subject" placeholder="Brief description of your issue" />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea 
                    id="message" 
                    placeholder="Provide details about your question or issue..."
                    rows={6}
                  />
                </div>
                
                <Button type="submit" className="w-full" size="lg">
                  Send Message
                </Button>
              </form>
            </CardContent>
          </Card>
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

export default Support;

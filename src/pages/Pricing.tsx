import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  TrendingUp,
  Zap,
  Shield,
  Users,
  BarChart3,
  Network,
  Brain,
  Infinity,
  Mail,
  MessageCircle,
  Clock,
} from "lucide-react";
import { motion } from "framer-motion";

const Pricing = () => {
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");

  const plans = [
    {
      name: "Free",
      description: "Perfect for testing and learning",
      price: { monthly: 0, annual: 0 },
      featured: false,
      cta: "Start Free",
      ctaVariant: "outline" as const,
      features: [
        { text: "100 workflow executions/month", included: true },
        { text: "5 active workflows", included: true },
        { text: "Basic technical indicators", included: true },
        { text: "1 broker connection", included: true },
        { text: "Community support", included: true },
        { text: "Email notifications", included: true },
        { text: "Advanced indicators", included: false },
        { text: "AI analysis", included: false },
        { text: "Backtesting", included: false },
      ],
      gradient: "bg-gradient-data",
    },
    {
      name: "Trader",
      description: "For individual traders",
      price: { monthly: 29, annual: 280 },
      featured: false,
      cta: "Start Free Trial",
      ctaVariant: "default" as const,
      features: [
        { text: "5,000 executions/month", included: true },
        { text: "Unlimited active workflows", included: true },
        { text: "All technical indicators", included: true },
        { text: "2 broker connections", included: true },
        { text: "Email support", included: true },
        { text: "SMS alerts", included: true },
        { text: "Basic backtesting", included: true },
        { text: "AI analysis (limited)", included: true },
        { text: "Priority support", included: false },
      ],
      gradient: "bg-gradient-indicators",
    },
    {
      name: "Professional",
      description: "For serious traders",
      price: { monthly: 79, annual: 760 },
      featured: true,
      cta: "Start Free Trial",
      ctaVariant: "default" as const,
      features: [
        { text: "25,000 executions/month", included: true },
        { text: "Unlimited workflows", included: true },
        { text: "All indicators + AI analysis", included: true },
        { text: "Unlimited broker connections", included: true },
        { text: "Priority email support", included: true },
        { text: "Advanced backtesting", included: true },
        { text: "Custom indicators", included: true },
        { text: "API access", included: true },
        { text: "Dedicated account manager", included: false },
      ],
      gradient: "bg-gradient-primary",
    },
    {
      name: "Enterprise",
      description: "For firms & teams",
      price: { monthly: null, annual: null },
      featured: false,
      cta: "Contact Sales",
      ctaVariant: "outline" as const,
      features: [
        { text: "Unlimited executions", included: true },
        { text: "Dedicated infrastructure", included: true },
        { text: "Custom integrations", included: true },
        { text: "White-label options", included: true },
        { text: "SLA guarantees (99.9%)", included: true },
        { text: "Dedicated account manager", included: true },
        { text: "Custom training", included: true },
        { text: "24/7 phone support", included: true },
        { text: "On-premise deployment", included: true },
      ],
      gradient: "bg-gradient-broker",
    },
  ];

  const faqs = [
    {
      question: "What counts as a workflow execution?",
      answer: "An execution is counted each time your workflow runs, whether triggered manually, by schedule, or by market events. If a workflow runs 10 times a day, that's 10 executions.",
    },
    {
      question: "Can I upgrade or downgrade my plan?",
      answer: "Yes! You can change your plan at any time. Upgrades take effect immediately, and downgrades apply at the end of your current billing period.",
    },
    {
      question: "What happens if I exceed my execution limit?",
      answer: "Your workflows will continue running, and you'll be charged $0.01 per additional execution on Free/Trader plans, and $0.005 on Professional plans. Enterprise has no limits.",
    },
    {
      question: "Is there a free trial?",
      answer: "Yes! All paid plans come with a 14-day free trial. No credit card required to start. You can cancel anytime during the trial without being charged.",
    },
    {
      question: "Which brokers do you support?",
      answer: "We support Alpaca, Charles Schwab, Dhan, and more. Professional and Enterprise plans can request custom broker integrations.",
    },
    {
      question: "How secure is my data?",
      answer: "We use bank-level encryption (AES-256) for data at rest and TLS 1.3 for data in transit. Broker credentials are encrypted with your personal encryption key that never leaves your device.",
    },
  ];

  const allPlansInclude = [
    { icon: Shield, text: "Bank-level encryption" },
    { icon: Zap, text: "Real-time market data" },
    { icon: Network, text: "Visual workflow builder" },
    { icon: BarChart3, text: "Performance analytics" },
    { icon: Clock, text: "Scheduled execution" },
    { icon: Mail, text: "Email notifications" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="p-2 bg-gradient-primary rounded-lg shadow-glow">
              <TrendingUp className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">Coreza</span>
          </Link>
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
        </div>
      </nav>

      {/* Hero Section */}
      <div className="pt-32 pb-20 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Badge className="mb-4 bg-gradient-primary">Flexible Pricing</Badge>
            <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              Choose Your Trading Plan
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Start free and scale as you grow. All plans include our powerful workflow builder and core features.
            </p>

            {/* Billing Toggle */}
            <div className="flex items-center justify-center gap-4 mb-12">
              <span className={billingPeriod === "monthly" ? "text-foreground font-medium" : "text-muted-foreground"}>
                Monthly
              </span>
              <button
                onClick={() => setBillingPeriod(billingPeriod === "monthly" ? "annual" : "monthly")}
                className="relative w-14 h-8 bg-muted rounded-full transition-colors hover:bg-muted/80"
              >
                <div
                  className={`absolute top-1 left-1 w-6 h-6 bg-gradient-primary rounded-full transition-transform ${
                    billingPeriod === "annual" ? "translate-x-6" : ""
                  }`}
                />
              </button>
              <span className={billingPeriod === "annual" ? "text-foreground font-medium" : "text-muted-foreground"}>
                Annual
              </span>
              {billingPeriod === "annual" && (
                <Badge variant="secondary" className="ml-2">
                  Save 20%
                </Badge>
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Pricing Cards */}
      <div className="container mx-auto px-4 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="h-full"
            >
              <Card
                className={`h-full flex flex-col relative transition-all duration-300 hover:shadow-xl ${
                  plan.featured
                    ? "border-primary shadow-glow scale-105"
                    : "hover:border-accent"
                }`}
              >
                {plan.featured && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <Badge className="bg-gradient-primary shadow-glow">Most Popular</Badge>
                  </div>
                )}
                <CardHeader>
                  <div className={`w-12 h-12 rounded-lg ${plan.gradient} mb-4 flex items-center justify-center`}>
                    {plan.name === "Free" && <Zap className="h-6 w-6 text-primary-foreground" />}
                    {plan.name === "Trader" && <TrendingUp className="h-6 w-6 text-primary-foreground" />}
                    {plan.name === "Professional" && <Brain className="h-6 w-6 text-primary-foreground" />}
                    {plan.name === "Enterprise" && <Users className="h-6 w-6 text-primary-foreground" />}
                  </div>
                  <CardTitle className="text-2xl">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="mb-6">
                    {plan.price.monthly === null ? (
                      <div className="text-3xl font-bold">Custom</div>
                    ) : (
                      <>
                        <div className="text-4xl font-bold">
                          ${billingPeriod === "monthly" ? plan.price.monthly : Math.floor(plan.price.annual / 12)}
                          <span className="text-lg text-muted-foreground font-normal">/month</span>
                        </div>
                        {billingPeriod === "annual" && plan.price.annual > 0 && (
                          <div className="text-sm text-muted-foreground mt-1">
                            ${plan.price.annual} billed annually
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <ul className="space-y-3">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check
                          className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
                            feature.included ? "text-primary" : "text-muted-foreground/30"
                          }`}
                        />
                        <span className={feature.included ? "text-foreground" : "text-muted-foreground/50"}>
                          {feature.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Link to="/signup" className="w-full">
                    <Button
                      variant={plan.ctaVariant}
                      className={`w-full ${plan.featured ? "bg-gradient-primary shadow-glow" : ""}`}
                    >
                      {plan.cta}
                    </Button>
                  </Link>
                </CardFooter>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>

      {/* All Plans Include */}
      <div className="container mx-auto px-4 py-20 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">All Plans Include</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {allPlansInclude.map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="flex items-center gap-3 p-4 rounded-lg bg-card border border-border"
              >
                <div className="p-2 bg-gradient-primary rounded-lg">
                  <item.icon className="h-5 w-5 text-primary-foreground" />
                </div>
                <span className="font-medium">{item.text}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="container mx-auto px-4 py-20 border-t border-border">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold mb-4">Frequently Asked Questions</h2>
            <p className="text-muted-foreground">
              Everything you need to know about our pricing and plans
            </p>
          </motion.div>
          <div className="space-y-6">
            {faqs.map((faq, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">{faq.question}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">{faq.answer}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="container mx-auto px-4 py-20 border-t border-border">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto text-center"
        >
          <div className="bg-gradient-primary rounded-2xl p-12 shadow-glow">
            <h2 className="text-3xl md:text-4xl font-bold text-primary-foreground mb-4">
              Ready to Automate Your Trading?
            </h2>
            <p className="text-primary-foreground/90 text-lg mb-8">
              Start with our free plan and upgrade as you grow. No credit card required.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/signup">
                <Button size="lg" variant="secondary" className="shadow-lg">
                  Start Free Trial
                </Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="outline" className="bg-background/10 border-primary-foreground/20 text-primary-foreground hover:bg-background/20">
                  View Documentation
                </Button>
              </Link>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-12">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-gradient-primary rounded-lg">
                <TrendingUp className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-semibold">Coreza</span>
            </div>
            <div className="text-sm text-muted-foreground">
              © 2024 Coreza. All rights reserved.
            </div>
            <div className="flex gap-6 text-sm text-muted-foreground">
              <Link to="/privacy" className="hover:text-foreground transition-colors">
                Privacy
              </Link>
              <Link to="/terms" className="hover:text-foreground transition-colors">
                Terms
              </Link>
              <Link to="/support" className="hover:text-foreground transition-colors">
                Support
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Pricing;

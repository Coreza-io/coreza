import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  TrendingUp,
  Network,
  BarChart3,
  Brain,
  Zap,
  Shield,
  Database,
  GitBranch,
  Activity,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Settings,
  ArrowUp,
} from "lucide-react";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import { ParticleNetwork } from "@/components/effects/ParticleNetwork";

const Landing = () => {
  const [showBackToTop, setShowBackToTop] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  
  // Multi-layer parallax scroll effects for hero section
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"]
  });
  
  // Background grid - subtle movement
  const heroY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const heroOpacity = useTransform(scrollYProgress, [0, 1], [1, 0]);
  
  // Hero text - medium speed parallax
  const heroTextY = useTransform(scrollYProgress, [0, 1], ["0%", "40%"]);
  
  // Workflow nodes - slower parallax for depth
  const heroNodesY = useTransform(scrollYProgress, [0, 1], ["0%", "20%"]);
  
  // Hero container - subtle scale effect
  const heroScale = useTransform(scrollYProgress, [0, 1], [1, 0.95]);
  
  // Floating orbs - different parallax speeds for depth
  const orb1Y = useTransform(scrollYProgress, [0, 1], ["0%", "60%"]);
  const orb2Y = useTransform(scrollYProgress, [0, 1], ["0%", "-40%"]);
  const orb3Y = useTransform(scrollYProgress, [0, 1], ["0%", "80%"]);
  const orb4Y = useTransform(scrollYProgress, [0, 1], ["0%", "-30%"]);

  // Track scroll position to show/hide back to top button
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 400);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const features = [
    {
      icon: Network,
      title: "Visual Workflow Builder",
      description: "Drag-and-drop nodes to create complex trading strategies without writing code",
      gradient: "bg-gradient-indicators",
    },
    {
      icon: TrendingUp,
      title: "Multi-Broker Support",
      description: "Connect to Alpaca, Schwab, Dhan, and more brokers seamlessly",
      gradient: "bg-gradient-broker",
    },
    {
      icon: BarChart3,
      title: "Technical Indicators",
      description: "RSI, MACD, EMA, Bollinger Bands, and 10+ indicators built-in",
      gradient: "bg-gradient-data",
    },
    {
      icon: Brain,
      title: "AI-Powered Analysis",
      description: "Integrate OpenAI for sentiment analysis and intelligent decision support",
      gradient: "bg-gradient-llm",
    },
    {
      icon: Zap,
      title: "Real-Time Execution",
      description: "Execute trades with sub-second latency and live market data feeds",
      gradient: "bg-gradient-logic",
    },
    {
      icon: Shield,
      title: "Risk Management",
      description: "Built-in risk engine with position sizing and stop-loss automation",
      gradient: "bg-gradient-risk",
    },
  ];

  const steps = [
    {
      number: "01",
      title: "Design",
      description: "Build your workflow visually with drag-and-drop nodes",
      icon: Network,
    },
    {
      number: "02",
      title: "Configure",
      description: "Connect your brokers and set strategy parameters",
      icon: Settings,
    },
    {
      number: "03",
      title: "Deploy",
      description: "Activate and monitor your strategies in real-time",
      icon: Zap,
    },
  ];

  const useCases = [
    {
      title: "Momentum Trading",
      description: "Combine RSI and MACD indicators for high-probability entries",
      tags: ["RSI", "MACD", "Alerts"],
    },
    {
      title: "News-Based Trading",
      description: "Analyze market sentiment with AI and execute trades automatically",
      tags: ["AI", "Sentiment", "Real-time"],
    },
    {
      title: "Multi-Timeframe Analysis",
      description: "Scan multiple timeframes to confirm trend direction",
      tags: ["Indicators", "Logic", "Backtesting"],
    },
    {
      title: "Portfolio Rebalancing",
      description: "Automatically maintain target allocation across assets",
      tags: ["Portfolio", "Risk", "Automation"],
    },
  ];

  return (
    <div className="min-h-screen bg-background">

      {/* Hero Section */}
      <section ref={heroRef} className="pt-32 pb-20 px-4 relative overflow-hidden">
        <motion.div 
          className="landing-grid-pattern absolute inset-0 opacity-30"
          style={{ y: heroY, opacity: heroOpacity }}
        />
        
        {/* Particle Network Animation */}
        <ParticleNetwork 
          particleCount={150}
          connectionDistance={120}
          particleSpeed={0.3}
          className="opacity-60"
        />
        
        {/* Floating Gradient Orbs with Parallax */}
        <motion.div
          className="absolute top-20 left-10 w-64 h-64 bg-gradient-indicators rounded-full blur-3xl opacity-20"
          style={{ y: orb1Y }}
        />
        <motion.div
          className="absolute top-40 right-20 w-96 h-96 bg-gradient-broker rounded-full blur-3xl opacity-15"
          style={{ y: orb2Y }}
        />
        <motion.div
          className="absolute bottom-40 left-1/4 w-72 h-72 bg-gradient-llm rounded-full blur-3xl opacity-20"
          style={{ y: orb3Y }}
        />
        <motion.div
          className="absolute bottom-20 right-1/3 w-80 h-80 bg-gradient-data rounded-full blur-3xl opacity-15"
          style={{ y: orb4Y }}
        />
        
        <motion.div 
          className="container mx-auto relative z-10"
          style={{ scale: heroScale }}
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-4xl mx-auto"
            style={{ y: heroTextY }}
          >
            <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
              Automate Your Trading Workflows with{" "}
              <span className="gradient-text">Visual Intelligence</span>
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground mb-8">
              Build, test, and deploy professional trading strategies without code.
              Connect brokers, indicators, and AI in minutes.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
              <Link to="/login">
                <Button
                  size="lg"
                  className="bg-gradient-primary hover:shadow-glow text-lg px-8 py-6"
                >
                  Get Started Free <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="text-lg px-8 py-6">
                View Demo
              </Button>
            </div>

            {/* Animated Workflow Preview */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="flex items-center justify-center gap-3 flex-wrap max-w-2xl mx-auto"
              style={{ y: heroNodesY }}
            >
              {[
                { icon: Database, label: "Data", gradient: "bg-gradient-data" },
                { icon: Activity, label: "RSI", gradient: "bg-gradient-indicators" },
                { icon: GitBranch, label: "Logic", gradient: "bg-gradient-logic" },
                { icon: Zap, label: "Trade", gradient: "bg-gradient-broker" },
              ].map((node, i) => (
                <div key={i} className="flex items-center">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.5 + i * 0.15, duration: 0.4 }}
                    className={`${node.gradient} p-4 rounded-xl shadow-glow`}
                  >
                    <node.icon className="h-6 w-6 text-white" />
                    <span className="text-xs text-white mt-1 block font-medium">
                      {node.label}
                    </span>
                  </motion.div>
                  {i < 3 && (
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ delay: 0.7 + i * 0.15, duration: 0.3 }}
                      className="hidden sm:block h-0.5 w-6 bg-gradient-to-r from-primary to-purple-500 mx-2"
                      style={{ transformOrigin: "left" }}
                    />
                  )}
                </div>
              ))}
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-20 px-4 bg-card/30 scroll-mt-20">
        <div className="container mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              Everything You Need to Trade Smarter
            </h2>
            <p className="text-xl text-muted-foreground">
              Professional-grade tools for building and deploying trading strategies
            </p>
          </motion.div>

          <motion.div
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: 1,
                transition: { staggerChildren: 0.1 },
              },
            }}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.5, delay: index * 0.1, type: "spring", stiffness: 300, damping: 20 }}
                variants={{
                  hidden: { opacity: 0, y: 50 },
                  visible: { opacity: 1, y: 0 },
                }}
                whileHover={{ y: -12, scale: 1.02 }}
              >
                <Card className="p-6 hover:shadow-glow transition-all h-full border-border bg-card/50 backdrop-blur-sm animated-gradient-border">
                  <div className={`${feature.gradient} p-3 rounded-xl w-fit mb-4`}>
                    <feature.icon className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 px-4 scroll-mt-20">
        <div className="container mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold mb-4">How It Works</h2>
            <p className="text-xl text-muted-foreground">
              From idea to execution in three simple steps
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {steps.map((step, index) => (
              <motion.div
                key={index}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.6, delay: index * 0.15 }}
                variants={{
                  hidden: { opacity: 0, y: 40 },
                  visible: { opacity: 1, y: 0 },
                }}
                className="relative"
              >
                <Card className="p-8 text-center border-border bg-card/50 backdrop-blur-sm hover:shadow-glow transition-all">
                  <div className="text-6xl font-bold text-primary/20 mb-4">
                    {step.number}
                  </div>
                  <div className="bg-gradient-primary p-4 rounded-xl w-fit mx-auto mb-4">
                    <step.icon className="h-8 w-8 text-primary-foreground" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">{step.title}</h3>
                  <p className="text-muted-foreground">{step.description}</p>
                </Card>
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2">
                    <ArrowRight className="h-8 w-8 text-primary/50" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="py-20 px-4 bg-card/30">
        <div className="container mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              Popular Trading Strategies
            </h2>
            <p className="text-xl text-muted-foreground">
              Start with proven templates or build your own
            </p>
          </motion.div>

          <motion.div
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: 1,
                transition: { staggerChildren: 0.1 },
              },
            }}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto"
          >
            {useCases.map((useCase, i) => (
              <motion.div
                key={i}
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0 },
                }}
              >
                <Card className="p-6 hover:shadow-glow transition-all hover:scale-105 border-border bg-card/50 backdrop-blur-sm">
                  <h3 className="text-xl font-bold mb-2">{useCase.title}</h3>
                  <p className="text-muted-foreground mb-4">{useCase.description}</p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {useCase.tags.map((tag, j) => (
                      <span
                        key={j}
                        className="px-3 py-1 bg-primary/10 text-primary text-sm rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <Link to="/login">
                    <Button variant="ghost" className="w-full">
                      Try Template <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-primary opacity-10" />
        <div className="landing-grid-pattern absolute inset-0 opacity-20" />
        <div className="container mx-auto relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-3xl mx-auto"
          >
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Ready to Revolutionize Your Trading?
            </h2>
            <p className="text-xl text-muted-foreground mb-8">
              Join traders who are automating their strategies with Coreza
            </p>
            <Link to="/login">
              <Button
                size="lg"
                className="bg-gradient-primary hover:shadow-glow text-lg px-8 py-6"
              >
                Start Building Free <Sparkles className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>


      {/* JSON-LD Structured Data */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Coreza",
          applicationCategory: "FinanceApplication",
          description:
            "Visual trading workflow automation platform for building algorithmic trading strategies",
          offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "USD",
          },
        })}
      </script>

      {/* Back to Top Button */}
      <AnimatePresence>
        {showBackToTop && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 right-8 z-40"
          >
            <Button
              onClick={scrollToTop}
              size="icon"
              className="h-12 w-12 rounded-full shadow-lg bg-gradient-primary hover:shadow-glow transition-shadow"
              aria-label="Back to top"
            >
              <ArrowUp className="h-5 w-5" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Landing;

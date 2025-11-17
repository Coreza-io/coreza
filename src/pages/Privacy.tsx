import { Link } from "react-router-dom";
import { Zap } from "lucide-react";

const Privacy = () => {
  const sections = [
    { id: "collection", title: "Information We Collect" },
    { id: "usage", title: "How We Use Your Information" },
    { id: "security", title: "Data Storage and Security" },
    { id: "third-party", title: "Third-Party Services" },
    { id: "cookies", title: "Cookies and Tracking" },
    { id: "rights", title: "Your Rights" },
    { id: "retention", title: "Data Retention" },
    { id: "children", title: "Children's Privacy" },
    { id: "changes", title: "Changes to This Policy" },
    { id: "contact", title: "Contact Us" },
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

      <div className="max-w-7xl mx-auto px-4 py-16">
        <div className="flex flex-col lg:flex-row gap-12">
          {/* Sidebar TOC */}
          <aside className="lg:w-64 flex-shrink-0">
            <div className="lg:sticky lg:top-24">
              <h3 className="font-semibold mb-4">Contents</h3>
              <nav className="space-y-2">
                {sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {section.title}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 max-w-3xl">
            <header className="mb-12">
              <h1 className="text-4xl font-bold mb-4">Privacy Policy</h1>
              <p className="text-muted-foreground">Last updated: December 17, 2024</p>
            </header>

            <div className="prose prose-invert max-w-none space-y-8">
              <section id="collection">
                <h2 className="text-2xl font-bold mb-4">Information We Collect</h2>
                <p className="text-muted-foreground mb-4">
                  We collect information that you provide directly to us, information we obtain automatically when you use our services, and information from third-party sources.
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li><strong>Account Information:</strong> Email address, name, timezone preferences</li>
                  <li><strong>Workflow Data:</strong> Trading strategies, node configurations, execution history</li>
                  <li><strong>Broker Credentials:</strong> API keys and OAuth tokens (encrypted)</li>
                  <li><strong>Usage Analytics:</strong> Page views, feature usage, performance metrics</li>
                  <li><strong>Technical Data:</strong> IP address, browser type, device information</li>
                </ul>
              </section>

              <section id="usage">
                <h2 className="text-2xl font-bold mb-4">How We Use Your Information</h2>
                <p className="text-muted-foreground mb-4">
                  We use the information we collect to provide, maintain, and improve our services.
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li>Provide and operate the Coreza platform</li>
                  <li>Execute your trading workflows and strategies</li>
                  <li>Send notifications, alerts, and important updates</li>
                  <li>Analyze platform usage to improve features and performance</li>
                  <li>Provide customer support and respond to inquiries</li>
                  <li>Comply with legal obligations and enforce our terms</li>
                </ul>
              </section>

              <section id="security">
                <h2 className="text-2xl font-bold mb-4">Data Storage and Security</h2>
                <p className="text-muted-foreground mb-4">
                  We implement industry-standard security measures to protect your data.
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li><strong>Encryption:</strong> AES-256 encryption at rest, TLS 1.3 for data in transit</li>
                  <li><strong>Credential Security:</strong> All broker API credentials are encrypted using strong encryption</li>
                  <li><strong>Access Controls:</strong> Role-based access control and authentication</li>
                  <li><strong>Security Audits:</strong> Regular security assessments and penetration testing</li>
                  <li><strong>Infrastructure:</strong> Secure cloud infrastructure with redundancy and backups</li>
                </ul>
              </section>

              <section id="third-party">
                <h2 className="text-2xl font-bold mb-4">Third-Party Services</h2>
                <p className="text-muted-foreground mb-4">
                  We integrate with third-party services to provide functionality. We share only the minimum necessary data.
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li><strong>Broker APIs:</strong> Alpaca, Schwab, Dhan (for trade execution)</li>
                  <li><strong>AI Services:</strong> OpenAI (for AI analysis features)</li>
                  <li><strong>Payment Processing:</strong> Stripe (for subscription billing)</li>
                  <li><strong>Analytics:</strong> Anonymous usage analytics</li>
                </ul>
              </section>

              <section id="cookies">
                <h2 className="text-2xl font-bold mb-4">Cookies and Tracking</h2>
                <p className="text-muted-foreground mb-4">
                  We use cookies and similar tracking technologies to improve your experience.
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li><strong>Essential Cookies:</strong> Required for authentication and core functionality</li>
                  <li><strong>Analytics Cookies:</strong> Help us understand how you use the platform (optional)</li>
                  <li><strong>Preference Cookies:</strong> Remember your settings and preferences</li>
                </ul>
              </section>

              <section id="rights">
                <h2 className="text-2xl font-bold mb-4">Your Rights</h2>
                <p className="text-muted-foreground mb-4">
                  You have certain rights regarding your personal data under GDPR and CCPA.
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li><strong>Access:</strong> Request a copy of your personal data</li>
                  <li><strong>Correction:</strong> Update or correct inaccurate information</li>
                  <li><strong>Deletion:</strong> Request deletion of your account and data</li>
                  <li><strong>Export:</strong> Download your workflows and data in JSON format</li>
                  <li><strong>Opt-Out:</strong> Unsubscribe from marketing communications</li>
                  <li><strong>Data Portability:</strong> Transfer your data to another service</li>
                </ul>
                <p className="text-muted-foreground mt-4">
                  To exercise these rights, contact us at <a href="mailto:privacy@coreza.io" className="text-primary hover:underline">privacy@coreza.io</a>
                </p>
              </section>

              <section id="retention">
                <h2 className="text-2xl font-bold mb-4">Data Retention</h2>
                <p className="text-muted-foreground mb-4">
                  We retain your data as long as your account is active or as needed to provide services.
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li>Active account data is retained indefinitely while your account is active</li>
                  <li>Deleted accounts are purged within 30 days of deletion request</li>
                  <li>Backup copies are retained for 90 days for disaster recovery</li>
                  <li>Legal compliance data is retained as required by law</li>
                </ul>
              </section>

              <section id="children">
                <h2 className="text-2xl font-bold mb-4">Children's Privacy</h2>
                <p className="text-muted-foreground">
                  Coreza is not intended for users under 18 years of age. We do not knowingly collect personal information from children. If we become aware that a child has provided us with personal information, we will take steps to delete such information.
                </p>
              </section>

              <section id="changes">
                <h2 className="text-2xl font-bold mb-4">Changes to This Policy</h2>
                <p className="text-muted-foreground">
                  We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new policy on this page and updating the "Last updated" date. Your continued use of the service after changes constitutes acceptance of the updated policy.
                </p>
              </section>

              <section id="contact">
                <h2 className="text-2xl font-bold mb-4">Contact Us</h2>
                <p className="text-muted-foreground mb-4">
                  If you have questions about this Privacy Policy or our data practices, please contact us:
                </p>
                <ul className="list-none text-muted-foreground space-y-2">
                  <li><strong>Email:</strong> <a href="mailto:privacy@coreza.io" className="text-primary hover:underline">privacy@coreza.io</a></li>
                  <li><strong>Support:</strong> <Link to="/support" className="text-primary hover:underline">Visit our Support page</Link></li>
                </ul>
              </section>
            </div>
          </main>
        </div>
      </div>

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

export default Privacy;

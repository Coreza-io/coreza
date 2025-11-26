import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";

const Terms = () => {
  const sections = [
    { id: "acceptance", title: "Acceptance of Terms" },
    { id: "description", title: "Description of Service" },
    { id: "registration", title: "Account Registration" },
    { id: "license", title: "Use License" },
    { id: "prohibited", title: "Prohibited Activities" },
    { id: "risks", title: "Trading Risks" },
    { id: "payment", title: "Payment and Billing" },
    { id: "ip", title: "Intellectual Property" },
    { id: "disclaimers", title: "Disclaimers" },
    { id: "liability", title: "Limitation of Liability" },
    { id: "termination", title: "Termination" },
    { id: "changes", title: "Changes to Terms" },
    { id: "contact", title: "Contact Information" },
  ];

  return (
    <div className="min-h-screen bg-background">

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
              <h1 className="text-4xl font-bold mb-4">Terms of Service</h1>
              <p className="text-muted-foreground">Last updated: December 17, 2024</p>
            </header>

            <div className="prose prose-invert max-w-none space-y-8">
              <section id="acceptance">
                <h2 className="text-2xl font-bold mb-4">Acceptance of Terms</h2>
                <p className="text-muted-foreground mb-4">
                  By accessing or using the Coreza platform, you agree to be bound by these Terms of Service. If you do not agree to these terms, you may not use our service.
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li>You must be at least 18 years old to use this service</li>
                  <li>You must comply with all applicable local, state, and federal laws</li>
                  <li>You represent that you have the legal capacity to enter into this agreement</li>
                </ul>
              </section>

              <section id="description">
                <h2 className="text-2xl font-bold mb-4">Description of Service</h2>
                <p className="text-muted-foreground mb-4">
                  Coreza is a visual workflow automation platform for building and executing trading strategies.
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li>Visual drag-and-drop workflow builder</li>
                  <li>Integration with multiple broker APIs (Alpaca, Schwab, Dhan)</li>
                  <li>Technical indicators and data analysis tools</li>
                  <li>Backtesting and strategy simulation capabilities</li>
                  <li>AI-powered analysis and automation features</li>
                </ul>
                <p className="text-muted-foreground mt-4">
                  <strong>Important:</strong> Coreza is a tool for automation and does not guarantee trading profits or success. All trading decisions remain your responsibility.
                </p>
              </section>

              <section id="registration">
                <h2 className="text-2xl font-bold mb-4">Account Registration</h2>
                <p className="text-muted-foreground mb-4">
                  To use Coreza, you must create an account and provide accurate information.
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li>Provide accurate, current, and complete information during registration</li>
                  <li>Maintain and promptly update your account information</li>
                  <li>Maintain the security of your password and account</li>
                  <li>One account per person (no account sharing)</li>
                  <li>You are responsible for all activities under your account</li>
                </ul>
              </section>

              <section id="license">
                <h2 className="text-2xl font-bold mb-4">Use License</h2>
                <p className="text-muted-foreground mb-4">
                  Subject to your compliance with these Terms, Coreza grants you a limited, non-exclusive, non-transferable license to access and use the platform.
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li>For personal or internal business use only</li>
                  <li>May not resell, redistribute, or sublicense the service</li>
                  <li>May not reverse engineer or attempt to extract source code</li>
                  <li>May not use the service to build a competing product</li>
                </ul>
              </section>

              <section id="prohibited">
                <h2 className="text-2xl font-bold mb-4">Prohibited Activities</h2>
                <p className="text-muted-foreground mb-4">
                  You agree not to engage in any of the following prohibited activities:
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li>Market manipulation, wash trading, or other illegal trading activities</li>
                  <li>Violating securities laws or regulations</li>
                  <li>Abusing system resources or attempting denial-of-service attacks</li>
                  <li>Unauthorized access to other users' accounts or data</li>
                  <li>Reverse engineering, decompiling, or disassembling the platform</li>
                  <li>Creating malicious workflows or using the service for illegal purposes</li>
                  <li>Sharing your account credentials with others</li>
                </ul>
              </section>

              <section id="risks">
                <h2 className="text-2xl font-bold mb-4">Trading Risks</h2>
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6 mb-6">
                  <div className="flex gap-3">
                    <AlertTriangle className="h-6 w-6 text-destructive flex-shrink-0 mt-1" />
                    <div>
                      <h3 className="font-bold text-destructive mb-2">IMPORTANT RISK DISCLAIMER</h3>
                      <p className="text-muted-foreground text-sm">
                        Trading stocks, options, and other financial instruments involves substantial risk and may not be suitable for all investors. You could lose some or all of your investment.
                      </p>
                    </div>
                  </div>
                </div>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li><strong>No Guarantee of Profits:</strong> Past performance does not guarantee future results</li>
                  <li><strong>Your Responsibility:</strong> You are solely responsible for all trading decisions</li>
                  <li><strong>Not Financial Advice:</strong> Coreza is a tool, not a financial advisor</li>
                  <li><strong>Consult Professionals:</strong> Seek advice from licensed financial advisors</li>
                  <li><strong>Understand Risks:</strong> Ensure you understand the risks before trading</li>
                  <li><strong>No Liability:</strong> Coreza is not liable for any trading losses</li>
                </ul>
              </section>

              <section id="payment">
                <h2 className="text-2xl font-bold mb-4">Payment and Billing</h2>
                <p className="text-muted-foreground mb-4">
                  Paid plans are billed in accordance with the pricing plan you select.
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li>Subscription fees are billed monthly or annually in advance</li>
                  <li>Automatic renewal unless cancelled before the renewal date</li>
                  <li>All fees are non-refundable except as required by law</li>
                  <li>We may change prices with 30 days' notice</li>
                  <li>Failed payments may result in service suspension</li>
                  <li>You can upgrade, downgrade, or cancel anytime from your account settings</li>
                </ul>
              </section>

              <section id="ip">
                <h2 className="text-2xl font-bold mb-4">Intellectual Property</h2>
                <p className="text-muted-foreground mb-4">
                  Ownership of intellectual property is clearly defined:
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li><strong>Coreza IP:</strong> We own all rights to the platform, code, and branding</li>
                  <li><strong>Your Content:</strong> You retain all rights to your workflows and data</li>
                  <li><strong>License to Us:</strong> You grant us a license to use your content to provide the service</li>
                  <li><strong>Feedback:</strong> Any feedback you provide may be used without compensation</li>
                </ul>
              </section>

              <section id="disclaimers">
                <h2 className="text-2xl font-bold mb-4">Disclaimers</h2>
                <p className="text-muted-foreground mb-4">
                  THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND.
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li>No warranty of uninterrupted or error-free service</li>
                  <li>No warranty regarding data accuracy or reliability</li>
                  <li>Not responsible for broker API outages or failures</li>
                  <li>Not responsible for market data inaccuracies</li>
                  <li>Coreza does not provide financial, investment, or trading advice</li>
                </ul>
              </section>

              <section id="liability">
                <h2 className="text-2xl font-bold mb-4">Limitation of Liability</h2>
                <p className="text-muted-foreground mb-4">
                  TO THE MAXIMUM EXTENT PERMITTED BY LAW:
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li>Coreza's total liability is limited to the fees you paid in the last 12 months</li>
                  <li>We are not liable for indirect, incidental, or consequential damages</li>
                  <li>We are not liable for trading losses or missed trading opportunities</li>
                  <li>We are not liable for data loss if you fail to backup your workflows</li>
                  <li>We are not liable for third-party service failures (broker APIs, etc.)</li>
                </ul>
              </section>

              <section id="termination">
                <h2 className="text-2xl font-bold mb-4">Termination</h2>
                <p className="text-muted-foreground mb-4">
                  Either party may terminate this agreement:
                </p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                  <li><strong>By You:</strong> Cancel your subscription anytime from account settings</li>
                  <li><strong>By Us:</strong> We may suspend or terminate for Terms violations</li>
                  <li><strong>Data Handling:</strong> You have 30 days to export your data after termination</li>
                  <li><strong>Surviving Terms:</strong> Certain provisions survive termination (IP, disclaimers, liability)</li>
                </ul>
              </section>

              <section id="changes">
                <h2 className="text-2xl font-bold mb-4">Changes to Terms</h2>
                <p className="text-muted-foreground">
                  We may modify these Terms at any time. Material changes will be notified via email or platform notification. Your continued use after changes constitutes acceptance of the updated Terms.
                </p>
              </section>

              <section id="contact">
                <h2 className="text-2xl font-bold mb-4">Contact Information</h2>
                <p className="text-muted-foreground mb-4">
                  For questions about these Terms, please contact us:
                </p>
                <ul className="list-none text-muted-foreground space-y-2">
                  <li><strong>Email:</strong> <a href="mailto:legal@coreza.io" className="text-primary hover:underline">legal@coreza.io</a></li>
                  <li><strong>Support:</strong> <Link to="/support" className="text-primary hover:underline">Visit our Support page</Link></li>
                </ul>
              </section>
            </div>
          </main>
        </div>
      </div>

      {/* Footer */}
    </div>
  );
};

export default Terms;

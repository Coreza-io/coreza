import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, Copy, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

interface SchwabAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (credentialId: string) => void;
  userId: string;
}

type Step = "credentials" | "authorize" | "success";

export function SchwabAuthModal({
  isOpen,
  onClose,
  onSuccess,
  userId,
}: SchwabAuthModalProps) {
  const [step, setStep] = useState<Step>("credentials");
  const [loading, setLoading] = useState(false);

  // Step 1: Credentials
  const [credentialName, setCredentialName] = useState("My Schwab Account");
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");

  // Step 2: Authorization
  const [authUrl, setAuthUrl] = useState("");
  const [tempId, setTempId] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("");

  // Step 3: Success
  const [credentialId, setCredentialId] = useState("");

  const handleReset = () => {
    setStep("credentials");
    setCredentialName("My Schwab Account");
    setAppKey("");
    setAppSecret("");
    setAuthUrl("");
    setTempId("");
    setRedirectUrl("");
    setCredentialId("");
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const handleGenerateAuthUrl = async () => {
    if (!appKey.trim() || !appSecret.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter both App Key and App Secret",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `${BACKEND_URL}/oauth/schwab/generate-auth-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to generate authorization URL");
      }

      setAuthUrl(data.auth_url);
      setTempId(data.temp_id);
      setStep("authorize");

      toast({
        title: "Authorization URL Generated",
        description: "Click the link below to authorize your Schwab account",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to generate authorization URL",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteConnection = async () => {
    if (!redirectUrl.trim()) {
      toast({
        title: "Missing Redirect URL",
        description: "Please paste the redirect URL from your browser",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `${BACKEND_URL}/oauth/schwab/exchange-token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            temp_id: tempId,
            redirect_url: redirectUrl,
            credential_name: credentialName,
            user_id: userId,
          }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to complete connection");
      }

      setCredentialId(data.credential_id);
      setStep("success");

      toast({
        title: "Success!",
        description: "Your Schwab account has been connected successfully",
      });

      onSuccess(data.credential_id);
    } catch (error: any) {
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to complete connection",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: "URL copied to clipboard",
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Connect Schwab Account</DialogTitle>
          <DialogDescription>
            {step === "credentials" &&
              "Enter your Schwab API credentials to get started"}
            {step === "authorize" &&
              "Authorize Coreza to access your Schwab account"}
            {step === "success" && "Your Schwab account is now connected!"}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Enter Credentials */}
        {step === "credentials" && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="credentialName">Credential Name</Label>
              <Input
                id="credentialName"
                value={credentialName}
                onChange={(e) => setCredentialName(e.target.value)}
                placeholder="My Schwab Account"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="appKey">App Key (Client ID)</Label>
              <Input
                id="appKey"
                type="password"
                value={appKey}
                onChange={(e) => setAppKey(e.target.value)}
                placeholder="Enter your Schwab App Key"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="appSecret">App Secret (Client Secret)</Label>
              <Input
                id="appSecret"
                type="password"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder="Enter your Schwab App Secret"
              />
            </div>

            <div className="rounded-md bg-muted p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Where to find your credentials:</p>
                  <p className="text-muted-foreground mt-1">
                    Get your App Key and App Secret from the Schwab Developer
                    Portal at{" "}
                    <a
                      href="https://developer.schwab.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      developer.schwab.com
                    </a>
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleGenerateAuthUrl} disabled={loading}>
                {loading ? "Generating..." : "Generate Authorization Link"}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Authorize */}
        {step === "authorize" && (
          <div className="space-y-4 py-4">
            <div className="space-y-3">
              <Label>Step 1: Click the link below to authorize</Label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="flex-1 justify-start"
                  onClick={() => window.open(authUrl, "_blank")}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Schwab Authorization
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyToClipboard(authUrl)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <Label htmlFor="redirectUrl">
                Step 2: Paste the redirect URL here
              </Label>
              <Textarea
                id="redirectUrl"
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                placeholder="https://127.0.0.1/?code=..."
                rows={4}
                className="font-mono text-sm"
              />
              <p className="text-sm text-muted-foreground">
                After authorizing in Schwab, you'll be redirected to a URL
                starting with{" "}
                <code className="bg-muted px-1 py-0.5 rounded">
                  https://127.0.0.1/?code=
                </code>
                <br />
                Copy the entire URL from your browser's address bar and paste it
                above.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setStep("credentials")}>
                Back
              </Button>
              <Button onClick={handleCompleteConnection} disabled={loading}>
                {loading ? "Connecting..." : "Complete Connection"}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Success */}
        {step === "success" && (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center justify-center text-center space-y-4 py-6">
              <div className="rounded-full bg-primary/10 p-3">
                <CheckCircle2 className="h-12 w-12 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">
                  Connection Successful!
                </h3>
                <p className="text-muted-foreground mt-2">
                  Your Schwab account "
                  <span className="font-medium">{credentialName}</span>" is now
                  connected.
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  You can now use this credential in your workflows. Access
                  tokens will be automatically refreshed.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={handleClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

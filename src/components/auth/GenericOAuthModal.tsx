import { useState, useEffect } from "react";
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

interface GenericOAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (credentialId: string) => void;
  userId: string;
  provider: string;
}

interface ProviderConfig {
  id: string;
  name: string;
  authFlowType: "authorization_code" | "redirect_url";
  docsUrl: string;
  authUrlDisplayName: string;
  callbackPlaceholder: string;
  callbackHelpText: string;
  fields: Array<{
    key: string;
    label: string;
    type: string;
    placeholder: string;
    required: boolean;
  }>;
}

type Step = "credentials" | "authorize" | "success";

export function GenericOAuthModal({
  isOpen,
  onClose,
  onSuccess,
  userId,
  provider,
}: GenericOAuthModalProps) {
  const [step, setStep] = useState<Step>("credentials");
  const [loading, setLoading] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(
    null
  );

  // Dynamic form fields
  const [fields, setFields] = useState<Record<string, string>>({});

  // Step 2: Authorization
  const [authUrl, setAuthUrl] = useState("");
  const [tempId, setTempId] = useState("");
  const [callback, setCallback] = useState("");

  // Step 3: Success
  const [credentialId, setCredentialId] = useState("");

  // Fetch provider configuration
  useEffect(() => {
    if (isOpen && provider) {
      fetch(`${import.meta.env.VITE_API_URL}/oauth/providers`)
        .then((res) => res.json())
        .then((data) => {
          const config = data.providers.find(
            (p: ProviderConfig) => p.id === provider
          );
          if (config) {
            setProviderConfig(config);
            // Initialize fields with default values
            const initialFields: Record<string, string> = {};
            config.fields.forEach((field) => {
              if (field.key === "credential_name") {
                initialFields[field.key] = field.placeholder;
              } else {
                initialFields[field.key] = "";
              }
            });
            setFields(initialFields);
          }
        })
        .catch((error) => {
          console.error("Failed to fetch provider config:", error);
          toast({
            title: "Error",
            description: "Failed to load OAuth provider configuration",
            variant: "destructive",
          });
        });
    }
  }, [isOpen, provider]);

  const handleReset = () => {
    setStep("credentials");
    setFields({});
    setAuthUrl("");
    setTempId("");
    setCallback("");
    setCredentialId("");
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const handleGenerateAuthUrl = async () => {
    if (!providerConfig) return;

    // Validate required fields
    const missingFields = providerConfig.fields
      .filter((f) => f.required && !fields[f.key]?.trim())
      .map((f) => f.label);

    if (missingFields.length > 0) {
      toast({
        title: "Missing Information",
        description: `Please enter: ${missingFields.join(", ")}`,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/oauth/${provider}/generate-auth-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
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
        description: `Click the link below to authorize your ${providerConfig.name} account`,
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
    if (!providerConfig) return;

    if (!callback.trim()) {
      toast({
        title: `Missing ${providerConfig.authFlowType === "authorization_code" ? "Code" : "URL"}`,
        description: `Please paste the ${providerConfig.authFlowType === "authorization_code" ? "authorization code" : "redirect URL"}`,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const payload: any = {
        temp_id: tempId,
        credential_name: fields.credential_name,
        user_id: userId,
      };

      if (providerConfig.authFlowType === "authorization_code") {
        payload.code = callback.trim();
      } else {
        payload.redirect_url = callback.trim();
      }

      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/oauth/${provider}/exchange-token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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
        description: `Your ${providerConfig.name} account has been connected successfully`,
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

  if (!providerConfig) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Connect {providerConfig.name} Account</DialogTitle>
          <DialogDescription>
            {step === "credentials" &&
              `Enter your ${providerConfig.name} OAuth credentials to get started`}
            {step === "authorize" &&
              `Authorize Coreza to access your ${providerConfig.name} account`}
            {step === "success" &&
              `Your ${providerConfig.name} account is now connected!`}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Enter Credentials */}
        {step === "credentials" && (
          <div className="space-y-4 py-4">
            {providerConfig.fields.map((field) => (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={field.key}>{field.label}</Label>
                <Input
                  id={field.key}
                  type={field.type}
                  value={fields[field.key] || ""}
                  onChange={(e) =>
                    setFields({ ...fields, [field.key]: e.target.value })
                  }
                  placeholder={field.placeholder}
                />
              </div>
            ))}

            <div className="rounded-md bg-muted p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Where to find your credentials:</p>
                  <p className="text-muted-foreground mt-1">
                    Get your credentials from{" "}
                    <a
                      href={providerConfig.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {providerConfig.name} Developer Portal
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
                  Open {providerConfig.authUrlDisplayName}
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
              <Label htmlFor="callback">
                Step 2: Paste the{" "}
                {providerConfig.authFlowType === "authorization_code"
                  ? "authorization code"
                  : "redirect URL"}{" "}
                here
              </Label>
              <Textarea
                id="callback"
                value={callback}
                onChange={(e) => setCallback(e.target.value)}
                placeholder={providerConfig.callbackPlaceholder}
                rows={4}
                className="font-mono text-sm"
              />
              <p className="text-sm text-muted-foreground">
                {providerConfig.callbackHelpText}
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
                  Your {providerConfig.name} account "
                  <span className="font-medium">
                    {fields.credential_name}
                  </span>
                  " is now connected.
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

/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { getErrorMessage } from "@/utils/getErrorMessage";

interface GmailAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (credentialId: string) => void;
  userId: string;
}

type Step = "credentials" | "authorize" | "success";

export function GmailAuthModal({
  isOpen,
  onClose,
  onSuccess,
  userId,
}: GmailAuthModalProps) {
  const [step, setStep] = useState<Step>("credentials");
  const [loading, setLoading] = useState(false);
  const { session } = useAuth();

  // Step 1: Credentials
  const [credentialName, setCredentialName] = useState("Personal Gmail");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");

  // Step 2: Authorization
  const [authUrl, setAuthUrl] = useState("");
  const [tempId, setTempId] = useState("");
  const [authCode, setAuthCode] = useState("");

  // Step 3: Success
  const [credentialId, setCredentialId] = useState("");

  const handleReset = () => {
    setStep("credentials");
    setCredentialName("Personal Gmail");
    setClientId("");
    setClientSecret("");
    setRedirectUri("");
    setAuthUrl("");
    setTempId("");
    setAuthCode("");
    setCredentialId("");
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const handleGenerateAuthUrl = async () => {
    if (!clientId.trim() || !clientSecret.trim() || !redirectUri.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter Client ID, Client Secret, and Redirect URI",
        variant: "destructive",
      });
      return;
    }

    if (!session?.access_token) {
      toast({
        title: "Authentication Required",
        description: "Please sign in again to generate the authorization link",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post(
        '/oauth/gmail/generate-auth-url',
        {
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        },
        session.access_token
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
        description: "Click the link below to authorize your Gmail account",
      });
    } catch (error: any) {
      const errorMessage = getErrorMessage(error);
      toast({
        title: "Error",
        description: errorMessage || "Failed to generate authorization URL",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteConnection = async () => {
    if (!authCode.trim()) {
      toast({
        title: "Missing Authorization Code",
        description: "Please paste the authorization code from Google",
        variant: "destructive",
      });
      return;
    }

    if (!userId) {
      toast({
        title: "Authentication Required",
        description: "Please sign in again to complete the connection",
        variant: "destructive",
      });
      return;
    }

    if (!session?.access_token) {
      toast({
        title: "Authentication Required",
        description: "Please sign in again to complete the connection",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post(
        '/oauth/gmail/exchange-token',
        {
          temp_id: tempId,
          code: authCode.trim(),
          credential_name: credentialName,
        },
        session.access_token
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to complete connection");
      }

      setCredentialId(data.credential_id);
      setStep("success");

      toast({
        title: "Success!",
        description: "Your Gmail account has been connected successfully",
      });

      onSuccess(data.credential_id);
    } catch (error: any) {
      const errorMessage = getErrorMessage(error);
      toast({
        title: "Connection Failed",
        description: errorMessage || "Failed to complete connection",
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
          <DialogTitle>Connect Gmail Account</DialogTitle>
          <DialogDescription>
            {step === "credentials" &&
              "Enter your Google OAuth credentials to get started"}
            {step === "authorize" &&
              "Authorize Coreza to access your Gmail account"}
            {step === "success" && "Your Gmail account is now connected!"}
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
                placeholder="Personal Gmail"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="clientId">Client ID</Label>
              <Input
                id="clientId"
                type="password"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Enter your Google Client ID"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="clientSecret">Client Secret</Label>
              <Input
                id="clientSecret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Enter your Google Client Secret"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="redirectUri">Redirect URI</Label>
              <Input
                id="redirectUri"
                value={redirectUri}
                onChange={(e) => setRedirectUri(e.target.value)}
                placeholder="http://localhost:8000/gmail/oauth2callback"
              />
              <p className="text-sm text-muted-foreground">
                This must match one of the redirect URIs configured in your
                Google Cloud Console
              </p>
            </div>

            <div className="rounded-md bg-muted p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Where to find your credentials:</p>
                  <p className="text-muted-foreground mt-1">
                    Get your Client ID and Client Secret from Google Cloud
                    Console at{" "}
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      console.cloud.google.com
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
                  Open Google Authorization
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
              <Label htmlFor="authCode">
                Step 2: Paste the authorization code here
              </Label>
              <Textarea
                id="authCode"
                value={authCode}
                onChange={(e) => setAuthCode(e.target.value)}
                placeholder="4/0AfJohXk..."
                rows={4}
                className="font-mono text-sm"
              />
              <p className="text-sm text-muted-foreground">
                After authorizing in Google, you'll receive an authorization code. 
                <strong className="text-foreground"> Copy the ENTIRE code</strong> (usually starts with "4/0A") 
                and paste it above. The code is valid for 10 minutes and can only be used once.
                If it fails, restart the process to get a new code.
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
                  Your Gmail account "
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

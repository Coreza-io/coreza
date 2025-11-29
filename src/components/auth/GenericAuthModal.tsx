import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { NodeConfig } from "@/nodes/manifest";

const BACKEND_URL = import.meta.env.VITE_API_URL as string;

interface GenericAuthModalProps {
  definition: NodeConfig;
  onClose: () => void;
}

const GenericAuthModal: React.FC<GenericAuthModalProps> = ({ definition, onClose }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (definition.authFields || []).map(f =>
        [f.key, f.type === "static" ? (f.value ?? "") : (f.default ?? "")]
      )
    )
  );
  const [status, setStatus] = useState<null | { type: 'success' | 'error'; message: string }>(null);
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setStatus(null);

    if (!user?.id) {
      const errorMessage = "User not authenticated";
      setStatus({ type: "error", message: errorMessage });
      toast({
        title: "Authentication Error",
        description: errorMessage,
        variant: "destructive",
      });
      return;
    }

    // Validate required fields except static
    for (const f of definition.authFields || []) {
      if (f.required && f.type !== "static" && !fields[f.key]) {
        const errorMessage = `Please enter ${f.label}.`;
        setStatus({ type: "error", message: errorMessage });
        toast({
          title: "Validation Error",
          description: errorMessage,
          variant: "destructive",
        });
        return;
      }
    }

    setLoading(true);
    try {
      // Prepare credentials object (non-static fields only)
      const credentials: Record<string, string> = {};
      
      for (const f of definition.authFields || []) {
        if (f.type !== "static" && f.key !== "credential_name") {
          credentials[f.key] = fields[f.key];
        }
      }

      // Get the backend URL from authAction
      const backendPath = definition.authAction?.url;
      if (!backendPath) {
        throw new Error("Backend authentication endpoint not configured for this service");
      }

      // Build full backend URL
      const backendUrl = `${BACKEND_URL}${backendPath}`;

      // Send plaintext credentials to backend over HTTPS (backend will encrypt)
      const response = await fetch(backendUrl, {
        method: definition.authAction?.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: user.id,
          credential_name: fields.credential_name || `${definition.name} Account`,
          ...credentials // spread individual credential fields
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to store credentials`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to store credentials');
      }

      const successMessage = "Credentials stored securely!";
      setStatus({ type: "success", message: successMessage });
      toast({
        title: "Success",
        description: successMessage,
      });

      // Clear sensitive data from memory
      Object.keys(fields).forEach(key => {
        const field = definition.authFields?.find(f => f.key === key);
        if (field?.type === "password") {
          setFields(current => ({ ...current, [key]: "" }));
        }
      });

      // Close modal after short delay
      setTimeout(() => {
        onClose();
      }, 1500);

    } catch (e: any) {
      console.error('Connection error:', e);
      const errorMessage = e.message || "Failed to store credentials";
      setStatus({ type: "error", message: errorMessage });
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
    setLoading(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">Connect {definition.name} Account</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {(definition.authFields || []).map(f => (
            <div key={f.key} className="space-y-2">
              <Label htmlFor={f.key} className="text-sm font-medium text-foreground">
                {f.label}
              </Label>
              {f.type === "static" ? (
                <div className="text-sm text-muted-foreground bg-muted p-2 rounded-md">
                  {f.value}
                </div>
              ) : (
                <Input
                  id={f.key}
                  type={f.type === "password" ? "password" : "text"}
                  value={fields[f.key]}
                  onChange={e =>
                    setFields(fs => ({ ...fs, [f.key]: e.target.value }))
                  }
                  placeholder={f.placeholder}
                  autoComplete="off"
                  className="w-full"
                />
              )}
            </div>
          ))}
          
          {status && (
            <div 
              className={`text-sm p-3 rounded-md border ${
                status.type === 'success' 
                  ? "text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950 dark:border-green-800" 
                  : "text-destructive bg-destructive/10 border-destructive/20"
              }`}
            >
              {status.message}
            </div>
          )}
          
          <div className="flex gap-2 pt-4">
            <Button 
              variant="outline" 
              onClick={onClose}
              className="flex-1"
              disabled={loading}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleConnect} 
              disabled={loading || status?.type === "success"}
              className="flex-1"
            >
              {loading ? "Connecting..." : "Connect"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GenericAuthModal;
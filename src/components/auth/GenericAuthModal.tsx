import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { NodeConfig } from "@/nodes/manifest";

const BACKEND_URL = "http://localhost:8000";

interface GenericAuthModalProps {
  definition: NodeConfig;
  onClose: () => void;
}

function getUserId() {
  try {
    // First try the new format
    const user = JSON.parse(localStorage.getItem("loggedInUser") || "{}");
    if (user.id || user.user_id) {
      return user.id || user.user_id;
    }
    
    // Fallback to old format
    const userId = localStorage.getItem("userId");
    return userId || "";
  } catch {
    // Fallback to old format on JSON parse error
    return localStorage.getItem("userId") || "";
  }
}

const GenericAuthModal: React.FC<GenericAuthModalProps> = ({ definition, onClose }) => {
  const { toast } = useToast();
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (definition.authFields || []).map(f =>
        [f.key, f.type === "static" ? (f.value ?? "") : (f.default ?? "")]
      )
    )
  );
  const [status, setStatus] = useState<null | { type: 'success' | 'error'; message: string }>(null);
  const [loading, setLoading] = useState(false);

  const userId = getUserId();

  const handleConnect = async () => {
    setStatus(null);

    // Validate required fields except static
    for (const f of definition.authFields || []) {
      if (f.type !== "static" && !fields[f.key]) {
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

    // Check for authAction (URL/method)
    const { url, method } = definition.authAction || {};
    if (!url) {
      const errorMessage = "Missing authAction.url in node definition!";
      setStatus({ type: "error", message: errorMessage });
      toast({
        title: "Configuration Error",
        description: errorMessage,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // Prepare payload
      const payload: Record<string, string> = { user_id: userId };
      for (const f of definition.authFields || []) {
        payload[f.key] = fields[f.key];
      }

      const res = await fetch(`${BACKEND_URL}${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      const json = await res.json();
      
      if (json.url) {
        window.open(json.url, "_blank");
        const successMessage = "Success! Please complete the sign-in in the new tab.";
        setStatus({ type: "success", message: successMessage });
        toast({
          title: "Authentication Started",
          description: successMessage,
        });
      } else if (res.ok) {
        const successMessage = "Credential added successfully!";
        setStatus({ type: "success", message: successMessage });
        toast({
          title: "Success",
          description: successMessage,
        });
      } else {
        const errorMessage = json.error || "Unknown error occurred.";
        setStatus({ type: "error", message: errorMessage });
        toast({
          title: "Connection Failed",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } catch (e: any) {
      const errorMessage = e.message || "Network error.";
      setStatus({ type: "error", message: errorMessage });
      toast({
        title: "Network Error",
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
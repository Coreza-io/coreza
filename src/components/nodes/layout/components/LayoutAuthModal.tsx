import React, { Suspense } from "react";
import GenericAuthModal from "@/components/auth/GenericAuthModal";
import { SchwabAuthModal } from "@/components/auth/SchwabAuthModal";
import { GmailAuthModal } from "@/components/auth/GmailAuthModal";

interface LayoutAuthModalProps {
  definition: any;
  showAuth: boolean;
  readOnly?: boolean;
  setShowAuth: (show: boolean) => void;
  fetchCredentials: (fieldKey: string) => void;
  userId?: string;
}

const LayoutAuthModal: React.FC<LayoutAuthModalProps> = ({
  definition,
  showAuth,
  readOnly,
  setShowAuth,
  fetchCredentials,
  userId,
}) => {
  if (readOnly || !showAuth) return null;

  const refreshCredentialSelects = () => {
    (definition.fields || []).forEach((f: any) => {
      if (f.type === "select" && f.optionsSource === "credentialsApi") {
        fetchCredentials(f.key);
      }
    });
  };

  const handleClose = () => {
    setShowAuth(false);
    refreshCredentialSelects();
  };

  const handleSuccess = () => {
    setShowAuth(false);
    refreshCredentialSelects();
  };

  return (
    <Suspense fallback={<div>Loading...</div>}>
      {definition.auth === "SchwabAuthModal" ? (
        <SchwabAuthModal
          isOpen={showAuth}
          onClose={handleClose}
          onSuccess={handleSuccess}
          userId={userId || ""}
        />
      ) : definition.auth === "GmailAuthModal" ? (
        <GmailAuthModal
          isOpen={showAuth}
          onClose={handleClose}
          onSuccess={handleSuccess}
          userId={userId || ""}
        />
      ) : (
        <GenericAuthModal definition={definition} onClose={handleClose} />
      )}
    </Suspense>
  );
};

export default LayoutAuthModal;

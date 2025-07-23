import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const Index = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to login page on app load
    navigate('/login');
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Redirecting to Coreza...</h1>
        <p className="text-xl text-muted-foreground">Professional Trading Workflow Platform</p>
      </div>
    </div>
  );
};

export default Index;

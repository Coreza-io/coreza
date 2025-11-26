import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  Calendar,
  Edit,
  Save,
  X,
  Upload
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const Profile = () => {
  const { user } = useAuth();
  const [userProfile, setUserProfile] = useState<{ 
    id: string; 
    first_name: string;
    last_name: string;
    phone?: string;
    location?: string;
    created_at?: string;
  } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    location: ""
  });
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      // Fetch user profile from users table
      const fetchProfile = async () => {
        const { data } = await supabase
          .from('users')
          .select('*')
          .eq('user_id', user.id)
          .single();
        
        if (data) {
          setUserProfile(data);
          setFormData({
            firstName: data.first_name || "",
            lastName: data.last_name || "",
            phone: (data as any).phone || "+1 (555) 123-4567",
            location: (data as any).location || "New York, NY"
          });
        }
      };
      
      fetchProfile();
    }
  }, [user]);

  const handleSave = async () => {
    if (!user || !userProfile) return;
    
    try {
      const { error } = await supabase
        .from('users')
        .update({
          first_name: formData.firstName,
          last_name: formData.lastName,
          phone: formData.phone,
          location: formData.location
        })
        .eq('user_id', user.id);

      if (error) throw error;

      setUserProfile(prev => prev ? {
        ...prev,
        first_name: formData.firstName,
        last_name: formData.lastName,
        phone: formData.phone,
        location: formData.location
      } : null);
      
      setIsEditing(false);
      toast({
        title: "Profile Updated",
        description: "Your profile has been successfully updated.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleCancel = () => {
    if (userProfile) {
      setFormData({
        firstName: userProfile.first_name || "",
        lastName: userProfile.last_name || "",
        phone: (userProfile as any).phone || "",
        location: (userProfile as any).location || ""
      });
    }
    setIsEditing(false);
  };

  if (!user || !userProfile) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Profile</h1>
          <p className="text-muted-foreground">
            Manage your account settings and preferences
          </p>
        </div>
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <Button variant="outline" onClick={handleCancel}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={handleSave}>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </Button>
            </>
          ) : (
            <Button onClick={() => setIsEditing(true)}>
              <Edit className="h-4 w-4 mr-2" />
              Edit Profile
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Profile Picture Section */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Profile Picture</CardTitle>
            <CardDescription>
              Update your profile photo
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center space-y-4">
            <Avatar className="w-32 h-32">
              <AvatarImage src="/placeholder-avatar.jpg" />
              <AvatarFallback className="text-2xl bg-gradient-primary text-primary-foreground">
                {userProfile.first_name?.[0]}{userProfile.last_name?.[0]}
              </AvatarFallback>
            </Avatar>
            <Button variant="outline" size="sm">
              <Upload className="h-4 w-4 mr-2" />
              Upload Photo
            </Button>
          </CardContent>
        </Card>

        {/* Personal Information */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>
              Your personal details and contact information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                {isEditing ? (
                  <Input
                    id="firstName"
                    value={formData.firstName}
                    onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                  />
                ) : (
                  <div className="flex items-center space-x-2 p-2 rounded-md bg-muted/50">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span>{userProfile.first_name}</span>
                  </div>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                {isEditing ? (
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                  />
                ) : (
                  <div className="flex items-center space-x-2 p-2 rounded-md bg-muted/50">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span>{userProfile.last_name}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <div className="flex items-center space-x-2 p-2 rounded-md bg-muted/50">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{user?.email}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              {isEditing ? (
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                />
              ) : (
                <div className="flex items-center space-x-2 p-2 rounded-md bg-muted/50">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{(userProfile as any).phone || "+1 (555) 123-4567"}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              {isEditing ? (
                <Input
                  id="location"
                  value={formData.location}
                  onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                />
              ) : (
                <div className="flex items-center space-x-2 p-2 rounded-md bg-muted/50">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{(userProfile as any).location || "New York, NY"}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Account Information */}
      <Card>
        <CardHeader>
          <CardTitle>Account Information</CardTitle>
          <CardDescription>
            Account status and membership details
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Member since</span>
              </div>
              <span className="font-medium">{userProfile.created_at ? new Date(userProfile.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : 'N/A'}</span>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm">Account Status</span>
              <Badge variant="outline" className="bg-success/10 text-success border-success">
                Active
              </Badge>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm">Plan</span>
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary">
                Pro
              </Badge>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm">Two-Factor Authentication</span>
              <Badge variant="outline" className="bg-warning/10 text-warning border-warning">
                Disabled
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Profile;
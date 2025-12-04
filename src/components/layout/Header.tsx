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

import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { 
  Bell, 
  Search, 
  User, 
  TrendingUp,
  Settings,
  LogOut
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export function Header() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<{ first_name?: string; last_name?: string } | null>(null);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  useEffect(() => {
    if (user) {
      // Fetch user profile from users table
      const fetchProfile = async () => {
        const { data } = await supabase
          .from('users')
          .select('first_name, last_name')
          .eq('user_id', user.id)
          .single();
        
        if (data) {
          setProfile(data);
        }
      };
      
      fetchProfile();
    }
  }, [user]);

  const handleLogoutClick = () => {
    setShowLogoutDialog(true);
  };

  const confirmLogout = async () => {
    await signOut();
    setShowLogoutDialog(false);
    navigate('/login');
  };

  const getDisplayName = () => {
    if (profile?.first_name && profile?.last_name) {
      return `${profile.first_name} ${profile.last_name}`;
    }
    return user?.email?.split('@')[0] || 'User';
  };

  const getInitials = (name: string) => {
    if (profile?.first_name && profile?.last_name) {
      return `${profile.first_name[0]}${profile.last_name[0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <header className="h-16 border-b border-border bg-card/50 backdrop-blur-sm px-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <SidebarTrigger />
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search workflows, projects..."
            className="pl-10 w-80"
          />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" className="flex items-center gap-2" onClick={handleLogoutClick} title="Logout">
          <LogOut className="h-4 w-4 text-red-500" />
        </Button>
      </div>

      {/* Logout Confirmation Dialog */}
      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Logout</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to log out? Any unsaved changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLogout} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Logout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center gap-4 hidden">
        {/* Market Status */}
        <div className="hidden md:flex items-center gap-2">
          <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
          <span className="text-sm text-muted-foreground">Markets Open</span>
        </div>

        {/* Performance Badge */}
        <Badge variant="outline" className="hidden md:flex items-center gap-1">
          <TrendingUp className="h-3 w-3 text-success" />
          +2.4% today
        </Badge>

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* Notifications */}
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="h-5 w-5" />
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-destructive rounded-full text-xs text-destructive-foreground flex items-center justify-center">
            3
          </span>
        </Button>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-primary rounded-full flex items-center justify-center">
                <span className="text-xs font-medium text-primary-foreground">
                  {getInitials(getDisplayName())}
                </span>
              </div>
              <span className="hidden md:block">{getDisplayName()}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-popover border-border">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{getDisplayName()}</p>
              <p className="text-xs text-muted-foreground">{user?.email || 'user@example.com'}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/dashboard/profile')} className="cursor-pointer">
              <User className="h-4 w-4 mr-2" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/dashboard/settings')} className="cursor-pointer">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/dashboard')} className="cursor-pointer">
              <TrendingUp className="h-4 w-4 mr-2" />
              Analytics
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogoutClick} className="cursor-pointer text-destructive focus:text-destructive">
              <LogOut className="h-4 w-4 mr-2" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
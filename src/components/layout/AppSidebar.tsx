import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  BarChart3,
  FolderOpen,
  Activity,
  TrendingUp,
  User,
  LogOut,
  Bell,
  Moon,
  Sun,
  Monitor,
  ChevronUp,
  Settings,
  BarChart2,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/components/theme/ThemeProvider";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { Badge } from "../ui/badge";

const DASHBOARD_BASE_PATH = "/dashboard";

type MenuItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  matchPaths?: string[];
};

const menuItems: MenuItem[] = [
  { title: "Dashboard", url: DASHBOARD_BASE_PATH, icon: BarChart3 },
  { title: "Projects", url: `${DASHBOARD_BASE_PATH}/projects`, icon: FolderOpen },
  {
    title: "Workflows",
    url: `${DASHBOARD_BASE_PATH}/workflows`,
    icon: Activity,
    matchPaths: [`${DASHBOARD_BASE_PATH}/workflow`],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [profile, setProfile] = useState<{ first_name?: string; last_name?: string } | null>(null);

  useEffect(() => {
    if (user) {
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

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const isActive = (path: string, matchPaths: string[] = []) => {
    if (path === DASHBOARD_BASE_PATH) {
      return location.pathname === path;
    }

    if (location.pathname === path || location.pathname.startsWith(`${path}/`)) {
      return true;
    }

    return matchPaths.some((matchPath) =>
      location.pathname.startsWith(matchPath)
    );
  };

  return (
    <Sidebar
      className={`${collapsed ? "w-16" : "w-64"} transition-all duration-300`}
    >
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-3 px-4 py-4">
          <div className="p-2 bg-gradient-primary rounded-lg shadow-glow">
            <TrendingUp className="h-6 w-6 text-primary-foreground" />
          </div>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="text-xl font-bold">Coreza</h2>
              <p className="text-xs text-sidebar-foreground/70">
                Trading Platform
              </p>
            </motion.div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <Link
                      to={item.url}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:bg-sidebar-accent ${isActive(item.url, item.matchPaths)
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-sidebar-foreground hover:text-sidebar-accent-foreground"
                        }`}
                    >
                      <item.icon className="h-5 w-5" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2">
            <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
            <span className="text-sm text-muted-foreground">Markets Open</span>
          </div>
          <Badge variant="outline" className="hidden md:flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-success" />
            +2.4% today
          </Badge>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={`flex items-center gap-3 w-full px-3 py-3 rounded-lg hover:bg-sidebar-accent transition-all ${collapsed ? "justify-center" : ""
                }`}
            >
              <div className="w-10 h-10 bg-gradient-primary rounded-full flex items-center justify-center shrink-0">
                <span className="text-sm font-medium text-primary-foreground">
                  {getInitials(getDisplayName())}
                </span>
              </div>
              {!collapsed && (
                <div className="flex items-center justify-between flex-1 min-w-0">
                  <div className="flex flex-col items-start min-w-0">
                    <span className="text-sm font-medium truncate w-full">
                      {getDisplayName()}
                    </span>
                    <span className="text-xs text-sidebar-foreground/70 truncate w-full">
                      {user?.email || 'user@example.com'}
                    </span>
                  </div>
                  <ChevronUp className="h-4 w-4 text-sidebar-foreground/70 shrink-0" />
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="end"
            className="w-56 bg-popover border-border mb-2"
          >
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{getDisplayName()}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {user?.email || 'user@example.com'}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Theme Submenu */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer">
                {theme === "light" && <Sun className="h-4 w-4 mr-2" />}
                {theme === "dark" && <Moon className="h-4 w-4 mr-2" />}
                {theme === "system" && <Monitor className="h-4 w-4 mr-2" />}
                Theme
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onClick={() => setTheme("light")}
                  className="cursor-pointer"
                >
                  <Sun className="h-4 w-4 mr-2" />
                  Light
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setTheme("dark")}
                  className="cursor-pointer"
                >
                  <Moon className="h-4 w-4 mr-2" />
                  Dark
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setTheme("system")}
                  className="cursor-pointer"
                >
                  <Monitor className="h-4 w-4 mr-2" />
                  System
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Notifications */}
            <DropdownMenuItem
              onClick={() => navigate('/dashboard/notifications')}
              className="cursor-pointer"
            >
              <Bell className="h-4 w-4 mr-2" />
              Notifications
              <span className="ml-auto text-xs bg-destructive text-destructive-foreground rounded-full px-2 py-0.5">
                3
              </span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Profile */}
            <DropdownMenuItem
              onClick={() => navigate('/dashboard/profile')}
              className="cursor-pointer"
            >
              <User className="h-4 w-4 mr-2" />
              Profile
            </DropdownMenuItem>

            {/* Settings */}
            <DropdownMenuItem
              onClick={() => navigate('/dashboard/settings')}
              className="cursor-pointer"
            >
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </DropdownMenuItem>

            {/* Analytics */}
            <DropdownMenuItem
              onClick={() => navigate('/dashboard')}
              className="cursor-pointer"
            >
              <BarChart2 className="h-4 w-4 mr-2" />
              Analytics
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Logout */}
            <DropdownMenuItem
              onClick={handleLogout}
              className="cursor-pointer text-destructive focus:text-destructive"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

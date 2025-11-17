import { Link, useLocation } from "react-router-dom";
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
  useSidebar,
} from "@/components/ui/sidebar";
import {
  BarChart3,
  FolderOpen,
  Activity,
  TrendingUp,
  Settings,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";

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
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:bg-sidebar-accent ${
                        isActive(item.url, item.matchPaths)
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

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link
                    to="/login"
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all"
                  >
                    <LogOut className="h-5 w-5" />
                    {!collapsed && <span>Logout</span>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

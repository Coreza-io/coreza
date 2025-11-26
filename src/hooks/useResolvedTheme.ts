import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";

type ResolvedTheme = "dark" | "light";

const getSystemTheme = (): ResolvedTheme => {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

export const useResolvedTheme = (): ResolvedTheme => {
  const { theme } = useTheme();
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    theme === "system" ? getSystemTheme() : (theme as ResolvedTheme)
  );

  useEffect(() => {
    if (theme === "system") {
      if (typeof window === "undefined") {
        setResolvedTheme("dark");
        return;
      }

      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const updateTheme = (event: MediaQueryListEvent) => {
        setResolvedTheme(event.matches ? "dark" : "light");
      };

      setResolvedTheme(mediaQuery.matches ? "dark" : "light");
      mediaQuery.addEventListener("change", updateTheme);

      return () => mediaQuery.removeEventListener("change", updateTheme);
    }

    setResolvedTheme(theme as ResolvedTheme);
  }, [theme]);

  return resolvedTheme;
};

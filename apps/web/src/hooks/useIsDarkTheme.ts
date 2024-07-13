import { useTheme } from "@/components/theme-provider";
import React from "react";

export function useIsDarkTheme() {
  const theme = useTheme();
  const [isDarkTheme, setIsDarkTheme] = React.useState(theme.theme === "dark");

  React.useEffect(() => {
    if (theme.theme === "system") {
      setIsDarkTheme(window.matchMedia("(prefers-color-scheme: dark)").matches);
    } else {
      setIsDarkTheme(theme.theme === "dark");
    }
  }, [theme]);

  return isDarkTheme;
}

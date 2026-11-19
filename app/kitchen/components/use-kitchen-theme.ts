"use client";

import { useEffect, useState } from "react";

export type KitchenTheme = "light" | "dark";

const themeStorageKey = "virtual-rudra-kitchen-theme";

export function useKitchenTheme() {
  const [theme, setTheme] = useState<KitchenTheme>("dark");
  const [themeError, setThemeError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        const savedTheme = window.localStorage.getItem(themeStorageKey);
        if (savedTheme === "light" || savedTheme === "dark") {
          setTheme(savedTheme);
        }
      } catch {
        setThemeError("The saved theme preference could not be read.");
      }
    });

    return () => {
      active = false;
    };
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    setThemeError("");

    try {
      window.localStorage.setItem(themeStorageKey, nextTheme);
    } catch {
      setThemeError(
        "Theme changed for this session, but the preference could not be saved.",
      );
    }
  }

  return {
    theme,
    themeError,
    toggleTheme,
    clearThemeError: () => setThemeError(""),
  };
}

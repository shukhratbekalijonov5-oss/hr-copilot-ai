import "@/global.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/lib/auth/context";
import { I18nProvider } from "@/lib/i18n/provider";
import { createQueryClient } from "@/lib/query/client";
import { useThemeStore } from "@/stores/theme";

/**
 * The one provider stack.
 *
 * Order matters: the query client must wrap `AuthProvider`, because auth
 * resolves identity through a query. The theme class sits on the outermost
 * view so every screen — including modals rendered above the stack — reads
 * the same tokens.
 */
export default function RootLayout() {
  const queryClient = useMemo(() => createQueryClient(), []);
  const resolved = useThemeStore((state) => state.resolved);
  const hydrate = useThemeStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <SafeAreaProvider>
          {/*
            NativeWind reads `dark` from a class on an ancestor, so the stored
            choice is applied here rather than through the OS appearance —
            that is what lets an explicit choice override the system setting.
          */}
          <View className={resolved === "dark" ? "dark flex-1" : "flex-1"}>
            <View className="flex-1 bg-canvas">
              <AuthProvider>
                <Stack screenOptions={{ headerShown: false }} />
              </AuthProvider>
              <StatusBar style={resolved === "dark" ? "light" : "dark"} />
            </View>
          </View>
        </SafeAreaProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

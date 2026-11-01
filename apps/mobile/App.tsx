import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useFonts } from "expo-font";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { ClipboardList, Headphones, Settings, type LucideIcon } from "lucide-react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { theme } from "@hotel/design";
import { ApiError, apiClient, authErrorMessage } from "@/api/client";
import type { HotelProfile, SessionUser } from "@/api/types";
import { getSocialIdentityToken } from "@/auth/social-auth";
import { AuthFlow } from "@/screens/AuthFlow";
import { RequestsScreen } from "@/screens/RequestsScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { InventoryScreen } from "@/screens/InventoryScreen";
import { HotelProfileScreen } from "@/screens/HotelProfileScreen";
import { MessageSettingsScreen } from "@/screens/MessageSettingsScreen";
import { ConnectionsScreen } from "@/screens/ConnectionsScreen";
import { SiteIntegrationScreen } from "@/screens/SiteIntegrationScreen";
import { SupportScreen } from "@/screens/SupportScreen";

type Tab = "requests" | "settings" | "support";
type AppState =
  | { status: "booting" }
  | { status: "signedOut"; error: string | null }
  | { status: "authenticated"; user: SessionUser; profile: HotelProfile | null }
  | { status: "demo"; profile: HotelProfile };

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [appState, setAppState] = useState<AppState>({ status: "booting" });
  const [tab, setTab] = useState<Tab>("requests");
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [siteIntegrationOpen, setSiteIntegrationOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const user = await apiClient.getSession();
        if (!active) return;
        if (!user) {
          setAppState({ status: "signedOut", error: null });
          return;
        }
        try {
          const profile = await apiClient.getHotel();
          if (active) setAppState({ status: "authenticated", user, profile });
        } catch (error) {
          if (error instanceof ApiError && error.code === "HOTEL_NOT_FOUND") {
            if (active) setAppState({ status: "authenticated", user, profile: null });
            return;
          }
          throw error;
        }
      } catch (error) {
        if (active) {
          setAppState({ status: "signedOut", error: authErrorMessage(error) });
        }
      }
    };
    void restore();
    return () => { active = false; };
  }, []);

  const handleLogout = async () => {
    if (appState.status === "demo") {
      setAppState({ status: "signedOut", error: null });
      setTab("requests");
      return;
    }
    setLogoutLoading(true);
    setLogoutError(null);
    try {
      await apiClient.logout();
      setTab("requests");
      setAppState({ status: "signedOut", error: null });
    } catch (error) {
      setLogoutError(`${authErrorMessage(error)} The local session was cleared.`);
      setTab("requests");
      setAppState({ status: "signedOut", error: `${authErrorMessage(error)} The local session was cleared.` });
    } finally {
      setLogoutLoading(false);
    }
  };

  const handleSocialAuth = async (provider: "google" | "apple") => {
    const idToken = await getSocialIdentityToken(provider);
    const session = await apiClient.socialLogin({ provider, idToken });
    try {
      const profile = await apiClient.getHotel();
      return { user: session.user, profile };
    } catch (error) {
      if (error instanceof ApiError && error.code === "HOTEL_NOT_FOUND") {
        return { user: session.user, profile: null };
      }
      throw error;
    }
  };

  if (!fontsLoaded) return <View style={styles.loadingCanvas} />;

  const profile = appState.status === "authenticated" ? appState.profile : appState.status === "demo" ? appState.profile : null;
  const openTab = (nextTab: Tab) => {
    setProfileOpen(false);
    setInventoryOpen(false);
    setMessagesOpen(false);
    setConnectionsOpen(false);
    setSiteIntegrationOpen(false);
    setTab(nextTab);
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        {appState.status === "booting" ? (
          <View style={styles.bootState} accessibilityLabel="Restoring session">
            <View style={styles.bootMark}><Text style={styles.bootMarkText}>H</Text></View>
            <ActivityIndicator color={theme.colors.action} />
            <Text style={styles.bootText}>Checking your secure session…</Text>
          </View>
        ) : appState.status === "signedOut" || (appState.status === "authenticated" && !appState.profile) ? (
          <View style={{ flex: 1 }}>
            {appState.status === "signedOut" && appState.error ? (
              <View style={styles.restoreError} accessibilityRole="alert">
                <Text style={styles.restoreErrorText}>{appState.error}</Text>
              </View>
            ) : null}
            <AuthFlow
              initialUser={appState.status === "authenticated" ? appState.user : undefined}
              onSocialAuth={handleSocialAuth}
              onAuthenticated={(user, nextProfile) => {
                setAppState({ status: "authenticated", user, profile: nextProfile });
              }}
              onDemo={(demoProfile) => {
                setTab("requests");
                setAppState({ status: "demo", profile: demoProfile });
              }}
            />
          </View>
        ) : profile ? (
          <View style={styles.shell}>
            <View style={styles.route}>
              {profileOpen ? (
                <HotelProfileScreen
                  onBack={() => setProfileOpen(false)}
                  initialProfile={profile}
                  demo={appState.status === "demo"}
                  onSaved={(nextProfile) => {
                    setAppState((current) => current.status === "authenticated" ? { ...current, profile: nextProfile } : current.status === "demo" ? { ...current, profile: nextProfile } : current);
                    setProfileOpen(false);
                  }}
                />
              ) : inventoryOpen ? (
                <InventoryScreen onBack={() => setInventoryOpen(false)} />
              ) : messagesOpen ? (
                <MessageSettingsScreen onBack={() => setMessagesOpen(false)} demo={appState.status === "demo"} />
              ) : connectionsOpen ? (
                <ConnectionsScreen onBack={() => setConnectionsOpen(false)} demo={appState.status === "demo"} />
              ) : siteIntegrationOpen ? (
                <SiteIntegrationScreen
                  initialProfile={profile}
                  demo={appState.status === "demo"}
                  onBack={() => setSiteIntegrationOpen(false)}
                  onSaved={(settings) => {
                    setAppState((current) => current.status === "authenticated"
                      ? { ...current, profile: current.profile ? { ...current.profile, ...settings } : null }
                      : current.status === "demo"
                        ? { ...current, profile: { ...current.profile, ...settings } }
                        : current);
                  }}
                />
              ) : tab === "requests" ? (
                <RequestsScreen
                  profile={profile}
                  demo={appState.status === "demo"}
                  onOpenProfile={() => setProfileOpen(true)}
                  onOpenInventory={() => setInventoryOpen(true)}
                  onOpenConnections={() => setConnectionsOpen(true)}
                  onOpenSiteIntegration={() => setSiteIntegrationOpen(true)}
                />
              ) : tab === "support" ? (
                <SupportScreen />
              ) : (
                <SettingsScreen
                  profile={profile}
                  demo={appState.status === "demo"}
                  onLogout={handleLogout}
                  logoutLoading={logoutLoading}
                  logoutError={logoutError}
                  onOpenInventory={() => setInventoryOpen(true)}
                  onOpenProfile={() => setProfileOpen(true)}
                  onOpenMessages={() => setMessagesOpen(true)}
                  onOpenConnections={() => setConnectionsOpen(true)}
                  onOpenSiteIntegration={() => setSiteIntegrationOpen(true)}
                />
              )}
            </View>
            <SafeAreaView edges={["bottom"]} style={styles.navSafeArea}>
              <View style={styles.nav} accessibilityRole="tablist">
                <NavItem label="Requests" icon={ClipboardList} selected={tab === "requests"} onPress={() => openTab("requests")} />
                <NavItem label="Settings" icon={Settings} selected={tab === "settings"} onPress={() => openTab("settings")} />
                <NavItem label="Support" icon={Headphones} selected={tab === "support"} onPress={() => openTab("support")} />
              </View>
            </SafeAreaView>
          </View>
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function NavItem({ label, icon: Icon, selected, onPress }: { label: string; icon: LucideIcon; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.navItem, selected && styles.navItemSelected, pressed && styles.navItemPressed]}
    >
      <Icon size={22} color={selected ? theme.colors.action : theme.colors.textMuted} strokeWidth={selected ? 2.5 : 2} />
      <Text style={[styles.navLabel, selected && styles.navLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loadingCanvas: { flex: 1, backgroundColor: theme.colors.background },
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  shell: { flex: 1 },
  route: { flex: 1 },
  bootState: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing[4], padding: theme.spacing[5] },
  bootMark: { width: 62, height: 62, borderRadius: theme.radii.lg, backgroundColor: theme.colors.action, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing[2] },
  bootMarkText: { ...theme.typography.h1, color: theme.colors.onAction },
  bootText: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
  restoreError: { backgroundColor: theme.colors.dangerTint, paddingHorizontal: theme.spacing[4], paddingVertical: theme.spacing[3] },
  restoreErrorText: { ...theme.typography.bodySmallMedium, color: theme.colors.danger, textAlign: "center" },
  navSafeArea: { backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border },
  nav: { minHeight: 68, flexDirection: "row", paddingHorizontal: theme.spacing[4], paddingTop: theme.spacing[2], gap: theme.spacing[2] },
  navItem: { flex: 1, minHeight: 54, borderRadius: theme.radii.md, alignItems: "center", justifyContent: "center", gap: theme.spacing[1] },
  navItemSelected: { backgroundColor: theme.colors.actionTint },
  navItemPressed: { opacity: 0.68 },
  navLabel: { ...theme.typography.captionMedium, color: theme.colors.textMuted },
  navLabelSelected: { color: theme.colors.action },
});

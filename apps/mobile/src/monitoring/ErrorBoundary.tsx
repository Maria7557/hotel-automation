import { Component, type ReactNode } from "react";
import { Text, View } from "react-native";
import { reportError } from "./index";

export class MonitoringErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { reportError("crash.javascript.render", error, "app.errorBoundary", true); }
  render() {
    return this.state.failed ? <View accessibilityRole="alert" style={{ padding: 24 }}><Text>Something went wrong. Please restart the app.</Text></View> : this.props.children;
  }
}

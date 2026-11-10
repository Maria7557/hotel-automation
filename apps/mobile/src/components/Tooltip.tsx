import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type PressableProps } from "react-native";
import { theme } from "@hotel/design";

type ViewRef = ComponentRef<typeof View>;
type ActiveTooltip = {
  id: string;
  content: string;
  anchor: ViewRef;
  onDismiss: () => void;
  onEnter: () => void;
  onLeave: () => void;
};
type TooltipContext = {
  activeId: string | undefined;
  show: (tooltip: ActiveTooltip) => void;
  dismiss: (id?: string) => void;
};
const Context = createContext<TooltipContext | null>(null);
const gutter = theme.spacing[4];
const gap = theme.spacing[2];

// Render above the app's scroll views so hints never resize or get clipped by a card.
export function TooltipProvider({ children }: { children: ReactNode }) {
  const host = useRef<ViewRef>(null);
  const current = useRef<ActiveTooltip | null>(null);
  const [active, setActive] = useState<PositionedTooltip | null>(null);
  const [bounds, setBounds] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const dismiss = useCallback((id?: string) => {
    if (id && current.current?.id !== id) return;
    current.current?.onDismiss();
    current.current = null;
    setActive(null);
  }, []);
  const show = useCallback((tooltip: ActiveTooltip) => {
    if (current.current?.id === tooltip.id) return;
    current.current?.onDismiss();
    current.current = tooltip;
    tooltip.anchor.measureInWindow((x, y, width, anchorHeight) => {
      host.current?.measureInWindow((hostX, hostY, hostWidth, hostHeight) => {
        if (current.current !== tooltip || !width || !anchorHeight) return;
        setBounds({ x: x - hostX + width / 2, y: y - hostY, width: hostWidth, height: hostHeight });
        setSize({ width: 0, height: 0 });
        setActive({ ...tooltip, anchorBottom: y - hostY + anchorHeight });
      });
    });
  }, []);

  useEffect(() => {
    if (!active || Platform.OS !== "web") return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!document.getElementById(`${active.id}-anchor`)?.contains(target) && !document.getElementById(active.id)?.contains(target)) dismiss();
    };
    const onViewportChange = () => dismiss();
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [active, dismiss]);

  const value = useMemo(() => ({ activeId: active?.id, show, dismiss }), [active?.id, show, dismiss]);
  const maxWidth = Math.min(280, Math.max(0, bounds.width - gutter * 2));
  const width = size.width || maxWidth;
  const { height } = size;
  const above = bounds.y - height >= gutter;
  const top = above ? bounds.y - height : Math.min(active?.anchorBottom ?? 0, bounds.height - height - gutter);

  return <Context.Provider value={value}>
    <View ref={host} style={styles.host} onLayout={() => dismiss()}>
      {children}
      {active ? <View pointerEvents="box-none" style={styles.layer}>
        {Platform.OS !== "web" ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss tooltip" onPress={() => dismiss()} style={StyleSheet.absoluteFill} /> : null}
        <View
          key={active.id}
          pointerEvents={height ? "auto" : "none"}
          nativeID={active.id}
          role="tooltip"
          onAccessibilityEscape={() => dismiss()}
          onPointerEnter={active.onEnter}
          onPointerLeave={active.onLeave}
          onTouchEnd={(event) => event.stopPropagation()}
          onLayout={(event) => { const { width, height } = event.nativeEvent.layout; setSize({ width, height }); }}
          style={[styles.anchor, { maxWidth, left: Math.max(gutter, Math.min(bounds.x - width / 2, bounds.width - width - gutter)), top: Math.max(gutter, top), paddingBottom: above ? gap : 0, paddingTop: above ? 0 : gap, opacity: height ? 1 : 0 }]}
        >
          <View style={styles.bubble}><Text style={styles.text}>{active.content}</Text></View>
        </View>
      </View> : null}
    </View>
  </Context.Provider>;
}

type PositionedTooltip = ActiveTooltip & { anchorBottom: number };
type TriggerProps = Pick<PressableProps, "accessibilityHint" | "onHoverIn" | "onHoverOut" | "onFocus" | "onBlur" | "onAccessibilityEscape"> & { "aria-describedby": string | undefined };

export function Tooltip({ content, children }: { content: string; children: (props: { triggerProps: TriggerProps; visible: boolean; toggle: () => void }) => ReactNode }) {
  const context = useContext(Context);
  if (!context) throw new Error("TooltipProvider is required.");
  const { activeId, show, dismiss } = context;
  const id = useId();
  const anchor = useRef<ViewRef>(null);
  const interaction = useRef({ hovered: false, focused: false, opened: false });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearTimer = () => { clearTimeout(timer.current); };
  const reset = () => { clearTimer(); interaction.current = { hovered: false, focused: false, opened: false }; };
  const enter = () => { clearTimer(); interaction.current.hovered = true; open(); };
  const scheduleDismiss = () => {
    clearTimer();
    timer.current = setTimeout(() => {
      const { hovered, focused, opened } = interaction.current;
      if (!hovered && !focused && !opened) dismiss(id);
    }, theme.motion.fast);
  };
  const leave = () => { interaction.current.hovered = false; scheduleDismiss(); };
  const open = () => {
    clearTimer();
    if (anchor.current) show({ id, content, anchor: anchor.current, onDismiss: reset, onEnter: enter, onLeave: leave });
  };
  useEffect(() => () => { clearTimeout(timer.current); dismiss(id); }, [dismiss, id]);
  const visible = activeId === id;

  return <View ref={anchor} nativeID={`${id}-anchor`} collapsable={false} style={styles.trigger}>
    {children({
      visible,
      toggle: () => { if (interaction.current.opened) dismiss(id); else { interaction.current.opened = true; open(); } },
      triggerProps: {
        "aria-describedby": visible ? id : undefined,
        accessibilityHint: content,
        onHoverIn: enter,
        onHoverOut: leave,
        onFocus: () => { interaction.current.focused = true; open(); },
        onBlur: () => { interaction.current.focused = false; interaction.current.opened = false; scheduleDismiss(); },
        onAccessibilityEscape: () => dismiss(id),
      },
    })}
  </View>;
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  trigger: { alignSelf: "center" },
  layer: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, zIndex: 1000 },
  anchor: { position: "absolute" },
  bubble: { borderRadius: theme.radii.md, padding: theme.spacing[2], backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  text: { ...theme.typography.caption, color: theme.colors.textSecondary },
});

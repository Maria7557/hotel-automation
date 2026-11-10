import { useCallback, useEffect, useState } from "react";
import { BackHandler, Platform } from "react-native";
import { detailHref } from "./detail-href";

export type DetailPage = { kind: "reservation" | "client"; id: string };
function pageFromHash(): DetailPage[] {
  if (Platform.OS !== "web") return [];
  const match = window.location.hash.match(/^#\/(reservations|clients)\/([^/]+)$/);
  if (!match) return [];
  try { return [{ kind: match[1] === "reservations" ? "reservation" : "client", id: decodeURIComponent(match[2]!) }]; }
  catch { return []; }
}

export function useDetailPages() {
  const [pages, setPages] = useState<DetailPage[]>(pageFromHash);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const update = () => setPages(pageFromHash());
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => { window.removeEventListener("popstate", update); window.removeEventListener("hashchange", update); };
  }, []);
  const open = useCallback((page: DetailPage) => {
    if (Platform.OS === "web") window.history.pushState({ ...window.history.state, hotelDetail: true }, "", detailHref(page.kind, page.id));
    setPages((current) => [...current, page]);
  }, []);
  const back = useCallback(() => {
    if (Platform.OS === "web") {
      if (window.history.state?.hotelDetail) { window.history.back(); return; }
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    setPages((current) => current.slice(0, -1));
  }, []);
  const clear = useCallback(() => {
    if (Platform.OS === "web" && window.location.hash) window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
    setPages([]);
  }, []);
  useEffect(() => {
    if (!pages.length || Platform.OS === "web") return;
    const handler = BackHandler.addEventListener("hardwareBackPress", () => { back(); return true; });
    return () => handler.remove();
  }, [pages.length, back]);
  return { page: pages.at(-1), open, back, clear };
}

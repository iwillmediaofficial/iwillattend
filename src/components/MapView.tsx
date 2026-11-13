import { useEffect, useRef } from "react";
import L from "leaflet";

export interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  color?: string;
  /** Draws a geofence circle of this radius (metres) around the point. */
  radius?: number;
}

export function MapView({
  points,
  onPick,
  className = "h-72",
}: {
  points: MapPoint[];
  onPick?: (lat: number, lng: number) => void;
  className?: string;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!elRef.current) return;
    const map = L.map(elRef.current).setView([22.5, 79], 4); // India
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    map.on("click", (e) => pickRef.current?.(e.latlng.lat, e.latlng.lng));
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    for (const p of points) {
      const color = p.color ?? "#04837f";
      if (p.radius) L.circle([p.lat, p.lng], { radius: p.radius, color, weight: 1, fillOpacity: 0.12 }).addTo(layer);
      const marker = L.circleMarker([p.lat, p.lng], { radius: 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }).addTo(layer);
      const el = document.createElement("span");
      el.textContent = p.label; // textContent: labels are user-entered, never HTML
      marker.bindPopup(el);
      bounds.push([p.lat, p.lng]);
    }
    if (bounds.length === 1) map.setView(bounds[0], 16);
    else if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 16 });
  }, [points]);

  return <div ref={elRef} className={`w-full overflow-hidden rounded-xl border border-slate-200 ${className}`} />;
}

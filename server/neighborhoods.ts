// Rough Austin neighbourhood lookup so Venue.area is populated without extra API calls.

const CENTROIDS: { name: string; lat: number; lng: number }[] = [
  { name: "Downtown", lat: 30.2672, lng: -97.7431 },
  { name: "Rainey Street", lat: 30.2587, lng: -97.739 },
  { name: "East Austin", lat: 30.264, lng: -97.722 },
  { name: "East Cesar Chavez", lat: 30.256, lng: -97.7295 },
  { name: "South Congress", lat: 30.25, lng: -97.75 },
  { name: "Bouldin Creek", lat: 30.245, lng: -97.756 },
  { name: "South Lamar", lat: 30.254, lng: -97.764 },
  { name: "Zilker", lat: 30.2669, lng: -97.7729 },
  { name: "Barton Hills", lat: 30.244, lng: -97.774 },
  { name: "Travis Heights", lat: 30.246, lng: -97.738 },
  { name: "East Riverside", lat: 30.236, lng: -97.727 },
  { name: "Clarksville", lat: 30.278, lng: -97.758 },
  { name: "West Campus", lat: 30.288, lng: -97.744 },
  { name: "UT Campus", lat: 30.2849, lng: -97.7341 },
  { name: "Hyde Park", lat: 30.306, lng: -97.727 },
  { name: "North Loop", lat: 30.319, lng: -97.718 },
  { name: "Cherrywood", lat: 30.29, lng: -97.716 },
  { name: "Mueller", lat: 30.299, lng: -97.705 },
  { name: "Windsor Park", lat: 30.32, lng: -97.696 },
  { name: "The Domain", lat: 30.4, lng: -97.725 },
  { name: "South Austin", lat: 30.234, lng: -97.763 },
];

const ZIPS: Record<string, string> = {
  "78701": "Downtown",
  "78702": "East Austin",
  "78703": "Clarksville",
  "78704": "South Austin",
  "78705": "West Campus",
  "78721": "East Austin",
  "78722": "Cherrywood",
  "78723": "Mueller",
  "78741": "East Riverside",
  "78745": "South Austin",
  "78751": "Hyde Park",
  "78756": "North Austin",
  "78757": "North Austin",
  "78758": "North Austin",
  "78759": "North Austin",
};

function distKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function areaFromZip(address: string): string | null {
  const zip = /\b(787\d{2})\b/.exec(address)?.[1];
  return (zip && ZIPS[zip]) || null;
}

export function areaFromLocation(lat: number, lng: number, address = ""): string {
  let best: { name: string; d: number } | null = null;
  for (const c of CENTROIDS) {
    const d = distKm(lat, lng, c.lat, c.lng);
    if (!best || d < best.d) best = { name: c.name, d };
  }
  if (best && best.d <= 1.8) return best.name;
  return areaFromZip(address) ?? "Austin";
}

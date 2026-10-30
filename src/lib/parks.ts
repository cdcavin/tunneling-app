/**
 * Where each park is, for game-time weather. Keyed by Trackman's Stadium value as it appears in the GameID
 * ("20250327-BrighamYoung-1" → BrighamYoung), lowercased with punctuation and spaces removed.
 * Coordinates: Wikipedia's coordinates for the stadium, or OpenStreetMap where Wikipedia has none (checked Oct 2026).
 * Elevation and air pressure come from Open-Meteo at these coordinates (its 90 m terrain matched USGS within 2 m here).
 * Covers every park WVU has pitched or hit at in the 2025–26 Trackman data.
 */
export interface Park { name: string; city: string; lat: number; lon: number; roof?: "retractable"; approx?: string }

export const HOME_KEY = "westvirginia";

export const PARKS: Record<string, Park> = {
  westvirginia: { name: "Kendrick Family Ballpark", city: "Morgantown, WV", lat: 39.6442, lon: -79.9964 },
  monogaliacounty: { name: "Kendrick Family Ballpark", city: "Morgantown, WV", lat: 39.6442, lon: -79.9964 },
  phoenixmunicipal: { name: "Phoenix Municipal Stadium", city: "Phoenix, AZ", lat: 33.4489, lon: -111.9556 },
  davidfcouch: { name: "David F. Couch Ballpark", city: "Winston-Salem, NC", lat: 36.1297, lon: -80.2522 },
  intimidatorstadium: { name: "Intimidators Stadium", city: "Kannapolis, NC", lat: 35.5078, lon: -80.5664 },
  brighamyoung: { name: "Larry H. Miller Field", city: "Provo, UT", lat: 40.255, lon: -111.6525 },
  uofhouston: { name: "Schroeder Park", city: "Houston, TX", lat: 29.7267, lon: -95.3452 },
  jackcookfield: { name: "Jack Cook Field", city: "Huntington, WV", lat: 38.4281, lon: -82.4202 },
  lubranopark: { name: "Medlar Field at Lubrano Park", city: "University Park, PA", lat: 40.8119, lon: -77.8508 },
  johneulianopark: { name: "John Euliano Park", city: "Orlando, FL", lat: 28.6094, lon: -81.1961 },
  charlescost: { name: "Charles L. Cost Field", city: "Pittsburgh, PA", lat: 40.4452, lon: -79.9662 },
  kingsmorestadium: { name: "Doug Kingsmore Stadium", city: "Clemson, SC", lat: 34.679, lon: -82.849 },
  arlington: { name: "Globe Life Field", city: "Arlington, TX", lat: 32.7475, lon: -97.0842, roof: "retractable" },
  lsu: { name: "Alex Box Stadium", city: "Baton Rouge, LA", lat: 30.4121, lon: -91.1877 },
  georgiasouthern: { name: "J. I. Clements Stadium", city: "Statesboro, GA", lat: 32.4292, lon: -81.7814 },
  danlawfield: { name: "Dan Law Field", city: "Lubbock, TX", lat: 33.5886, lon: -101.8767 },
  gomart: { name: "GoMart Ballpark", city: "Charleston, WV", lat: 38.349, lon: -81.6251 },
  charlesschwabfield: { name: "Charles Schwab Field", city: "Omaha, NE", lat: 41.267, lon: -95.932 },
  lipscomb: { name: "Ken Dugan Field", city: "Nashville, TN", lat: 36.1029, lon: -86.7991 },
  okstate: { name: "O'Brate Stadium", city: "Stillwater, OK", lat: 36.131, lon: -97.0688 },
  prascopark: { name: "Prasco Park", city: "Mason, OH", lat: 39.3667, lon: -84.2953, approx: "city of Mason (park has no published coordinates)" },
  liberty: { name: "Liberty Baseball Stadium", city: "Lynchburg, VA", lat: 37.3565, lon: -79.1775 },
  kennesawstate: { name: "Fred Stillwell Stadium", city: "Kennesaw, GA", lat: 34.0335, lon: -84.5819 },
  baylor: { name: "Baylor Ballpark", city: "Waco, TX", lat: 31.5508, lon: -97.1078 },
  stickwilliamsfield: { name: "Stick Williams Field (Queens)", city: "Charlotte, NC", lat: 35.1888, lon: -80.8323, approx: "Queens University campus" },
  uarizona: { name: "Hi Corbett Field", city: "Tucson, AZ", lat: 32.2133, lon: -110.9192 },
  ucincinnati: { name: "UC Baseball Stadium", city: "Cincinnati, OH", lat: 39.1301, lon: -84.5137 },
  kansasuniversity: { name: "Hoglund Ballpark", city: "Lawrence, KS", lat: 38.953, lon: -95.2529 },
  nickswisherfield: { name: "Nick Swisher Field", city: "Columbus, OH", lat: 40.0094, lon: -83.0269 },
  hagerstownballpark: { name: "Meritus Park", city: "Hagerstown, MD", lat: 39.6406, lon: -77.7239 },
  surprise: { name: "Surprise Stadium", city: "Surprise, AZ", lat: 33.6278, lon: -112.3778 },
};

/** Park key from a Trackman GameID, e.g. "20260505-GoMart-Private-1" → "gomart". */
export function parkKey(game: string | undefined | null): string | null {
  if (!game) return null;
  const s = String(game).replace(/^\d{8}-/, "").replace(/-\d+$/, "").replace(/-Private$/i, "");
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
export const parkOf = (game: string | undefined | null): Park | null => { const k = parkKey(game); return k ? PARKS[k] ?? null : null; };

/**
 * Morgantown baseline for "vs home": 70°F, 40% humidity, no wind, at Morgantown's average game-time air pressure
 * (974.1 hPa: Open-Meteo, Feb–Jun 2021–25, noon–8 pm, at the ballpark). Same as the lab baseline on an average day.
 */
export const MORGANTOWN_HPA = 974.1;
export function airDensityLb(tempF: number, rh: number, pressureHpa: number) {
  const tc = ((tempF - 32) * 5) / 9, tk = tc + 273.15;
  const pv = (rh / 100) * 6.1078 * Math.pow(10, (7.5 * tc) / (tc + 237.3));        // hPa (Tetens)
  return (((pressureHpa - pv) * 100) / (287.058 * tk) + (pv * 100) / (461.495 * tk)) * 0.062428;
}
export const MORGANTOWN_AIR = airDensityLb(70, 40, MORGANTOWN_HPA);

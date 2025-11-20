// GEOG 464 – Final Project (A4)
// Abandoned Mines & Tailings in Québec
// Features:
// - Impact classes (population / Indigenous / water / remote)
// - Dynamic buffers around mines
// - Cluster of nearby mines
// - Nearest town / Indigenous community / major water body (manual list)
// - Heatmap of mine density (Leaflet.heat)
// - Hydro lakes overlay from GRHQ (hydro_lakes.geojson)
// - Impact filter + info panel + stats

const map = L.map("map").setView([53, -72], 4.3);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// ===== Reference arrays ===== //
const POP_CENTERS = [
  { name: "Montréal",       lat: 45.5017, lng: -73.5673 },
  { name: "Québec",         lat: 46.8139, lng: -71.2080 },
  { name: "Gatineau",       lat: 45.4765, lng: -75.7013 },
  { name: "Sherbrooke",     lat: 45.4042, lng: -71.8929 },
  { name: "Trois-Rivières", lat: 46.3430, lng: -72.5421 },
  { name: "Saguenay",       lat: 48.4167, lng: -71.0667 },
  { name: "Rouyn-Noranda",  lat: 48.2366, lng: -79.0230 },
  { name: "Val-d'Or",       lat: 48.0975, lng: -77.7974 },
  { name: "Sept-Îles",      lat: 50.2169, lng: -66.3810 }
];

const INDIGENOUS_HUBS = [
  { name: "Mistissini",   lat: 50.43,  lng: -73.87 },
  { name: "Chibougamau",  lat: 49.913, lng: -74.379 },
  { name: "Wendake",      lat: 46.87,  lng: -71.33 },
  { name: "Manawan",      lat: 46.92,  lng: -73.78 },
  { name: "Uashat",       lat: 50.25,  lng: -66.40 },
  { name: "Kahnawake",    lat: 45.40,  lng: -73.69 },
  { name: "Kanesatake",   lat: 45.50,  lng: -74.08 },
  { name: "Waskaganish",  lat: 51.47,  lng: -78.75 }
];

// Small manual list of major water bodies (for "nearest major water body" info)
const WATER_BODIES = [
  { name: "St. Lawrence River – Montréal", lat: 45.5, lng: -73.55 },
  { name: "St. Lawrence River – Québec City", lat: 46.82, lng: -71.20 },
  { name: "Saguenay River", lat: 48.43, lng: -71.15 },
  { name: "Lac Saint-Jean", lat: 48.55, lng: -72.0 },
  { name: "Réservoir Manicouagan", lat: 50.65, lng: -68.7 },
  { name: "Baie James (James Bay)", lat: 52.0, lng: -79.0 },
  { name: "Lac Mistassini", lat: 50.7, lng: -73.9 }
];

// ===== Distance helpers ===== //
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function nearestItem(lat, lng, arr) {
  if (!arr || !arr.length) return null;
  let best = arr[0];
  let bestD = haversineKm(lat, lng, arr[0].lat, arr[0].lng);
  for (let i = 1; i < arr.length; i++) {
    const d = haversineKm(lat, lng, arr[i].lat, arr[i].lng);
    if (d < bestD) {
      bestD = d;
      best = arr[i];
    }
  }
  return { item: best, distanceKm: bestD };
}

// ===== Impact classification ===== //
function classifyImpact(lat, lng, props) {
  // 1) Indigenous / northern proximity (within 55 km OR very north)
  for (const hub of INDIGENOUS_HUBS) {
    if (haversineKm(lat, lng, hub.lat, hub.lng) <= 55) {
      return "near_indigenous";
    }
  }
  if (lat >= 51.5) return "near_indigenous";

  // 2) Population centres (within 30 km)
  for (const c of POP_CENTERS) {
    if (haversineKm(lat, lng, c.lat, c.lng) <= 30) {
      return "near_population";
    }
  }

  // 3) Water / tailings, based on attributes only
  const cat = (props.category || "").toLowerCase();
  const nm  = (props.name || "").toLowerCase();
  const desc = (props.description || "").toLowerCase();

  if (
    cat.includes("tailings") || cat.includes("résidu") || cat.includes("residu") ||
    desc.includes("résidu") || desc.includes("residu") ||
    nm.includes("lac") || nm.includes("lake") ||
    nm.includes("river") || nm.includes("rivière") || nm.includes("riviere")
  ) {
    return "water_tailings";
  }

  // 4) Otherwise: remote / other
  return "remote";
}

// ===== Map style per impact class ===== //
function styleForImpact(impact) {
  const base = { radius: 5, weight: 1, opacity: 1, fillOpacity: 0.65 };
  switch (impact) {
    case "near_indigenous":
      return { ...base, color: "#ff6b6b", fillColor: "#ff6b6b" };
    case "near_population":
      return { ...base, color: "#4dabf7", fillColor: "#4dabf7" };
    case "water_tailings":
      return { ...base, color: "#ffd166", fillColor: "#ffd166" };
    default:
      return { ...base, color: "#ced4da", fillColor: "#ced4da" };
  }
}

// ===== Buffer radius per impact class (meters) ===== //
function bufferRadiusForImpact(impact) {
  switch (impact) {
    case "near_indigenous":
      return 60000; // 60 km
    case "near_population":
      return 30000; // 30 km
    case "water_tailings":
      return 15000; // 15 km
    default:
      return 10000; // 10 km
  }
}

// ===== Layers & global state ===== //
const markerLayer = L.layerGroup().addTo(map);
const ALL_MARKERS = [];
const HEAT_POINTS = [];

let activeRiskBuffer = null;
let activeClusterMarkers = [];
let heatLayer = null;
let lakesLayer = null;

// ===== Cluster helpers ===== //
function clearClusterHighlight() {
  activeClusterMarkers.forEach((m) => {
    if (m.baseStyle) m.setStyle(m.baseStyle);
  });
  activeClusterMarkers = [];
}

function highlightClusterAround(clickedMarker) {
  clearClusterHighlight();
  const thresholdKm = 40;
  const center = clickedMarker.getLatLng();

  let clusterCount = 0;

  ALL_MARKERS.forEach((m) => {
    if (m === clickedMarker) return;
    const ll = m.getLatLng();
    const d = haversineKm(center.lat, center.lng, ll.lat, ll.lng);
    if (d <= thresholdKm) {
      const base = m.baseStyle || {};
      const newStyle = {
        ...base,
        radius: (base.radius || 5) + 2,
        weight: 2
      };
      m.setStyle(newStyle);
      activeClusterMarkers.push(m);
      clusterCount++;
    }
  });

  return clusterCount;
}

// ===== Heatmap layer builder ===== //
function buildHeatLayer() {
  if (typeof L.heatLayer !== "function") {
    console.warn("Leaflet.heat plugin missing");
    return;
  }
  heatLayer = L.heatLayer(HEAT_POINTS, {
    radius: 25,
    blur: 15,
    maxZoom: 8
  });
}

// ===== Load mines data ===== //
fetch("./mines.geojson")
  .then((r) => r.json())
  .then((geo) => {
    L.geoJSON(geo, {
      pointToLayer: (feat, latlng) => {
        const props = feat.properties || {};
        const impactClass = classifyImpact(latlng.lat, latlng.lng, props);
        const style = styleForImpact(impactClass);

        const marker = L.circleMarker(latlng, style);
        marker.baseStyle = style;

        const popupHtml = `
          <strong>${props.name || "Mine / site"}</strong><br>
          <span><em>Impact class:</em> ${impactClass.replace("_", " ")}</span><br>
          <span>Category: ${props.category || "n/a"}</span><br>
          <span>Status: ${props.status || "n/a"}</span><br>
          <span>Commodity: ${props.commodity || "n/a"}</span><br>
          <span>Last operation: ${props.last_year || "n/a"}</span><br>
          <small>Red circle = simple hypothetical impact radius (not a real risk model).</small>
        `;
        marker.bindPopup(popupHtml.trim());

        marker.featureData = {
          name: props.name || "Mine / site",
          impact: impactClass,
          raw: props
        };

        marker.on("click", () => {
          const ll = marker.getLatLng();

          // Buffer
          if (activeRiskBuffer) {
            map.removeLayer(activeRiskBuffer);
            activeRiskBuffer = null;
          }
          const radius = bufferRadiusForImpact(impactClass);
          activeRiskBuffer = L.circle(ll, {
            radius,
            color: "#ff3333",
            weight: 2,
            fillColor: "#ff6666",
            fillOpacity: 0.18
          }).addTo(map);

          // Cluster
          const clusterCount = highlightClusterAround(marker);

          // Nearest places
          const nearestTown = nearestItem(ll.lat, ll.lng, POP_CENTERS);
          const nearestInd  = nearestItem(ll.lat, ll.lng, INDIGENOUS_HUBS);
          const nearestWater = nearestItem(ll.lat, ll.lng, WATER_BODIES);

          updateInfoPanel(marker.featureData, {
            clusterCount,
            nearestTown,
            nearestInd,
            nearestWater
          });
        });

        marker.addTo(markerLayer);
        ALL_MARKERS.push(marker);

        // Heatmap point
        HEAT_POINTS.push([latlng.lat, latlng.lng, 0.9]);

        return marker;
      }
    });

    // Build heat layer once all points are known
    buildHeatLayer();
    updateStatsBox("all");
  })
  .catch((err) => {
    console.error("Could not load ./mines.geojson", err);
    const panel = document.getElementById("infoPanel");
    if (panel) {
      panel.innerHTML =
        '<p style="color:#ff6b6b">Error loading <code>mines.geojson</code>. Make sure it is at the repo root.</p>';
    }
  });

// ===== Hydro lakes overlay (GRHQ, zones 00–03) ===== //
fetch("./hydro_lakes.geojson")
  .then((r) => r.json())
  .then((data) => {
    lakesLayer = L.geoJSON(data, {
      style: {
        color: "#4a90e2",
        weight: 0.5,
        fillColor: "#4a90e2",
        fillOpacity: 0.35
      }
    }).addTo(map);
  })
  .catch((err) => {
    console.error("Could not load ./hydro_lakes.geojson", err);
  });

// ===== Filter UI ===== //
const filterEl = document.getElementById("impactFilter");
if (filterEl) {
  filterEl.addEventListener("change", (e) => {
    const want = e.target.value;
    markerLayer.clearLayers();

    ALL_MARKERS.forEach((m) => {
      if (want === "all" || m.featureData.impact === want) {
        m.addTo(markerLayer);
      }
    });

    if (activeRiskBuffer) {
      map.removeLayer(activeRiskBuffer);
      activeRiskBuffer = null;
    }
    clearClusterHighlight();

    updateStatsBox(want);
  });
}

// ===== Heatmap toggle ===== //
const heatToggle = document.getElementById("toggleHeat");
if (heatToggle) {
  heatToggle.addEventListener("change", (e) => {
    if (!heatLayer) return;
    if (e.target.checked) {
      heatLayer.addTo(map);
    } else {
      map.removeLayer(heatLayer);
    }
  });
}

// ===== Info panel ===== //
function updateInfoPanel(data, extras = {}) {
  const panel = document.getElementById("infoPanel");
  if (!panel) return;
  const props = data.raw || {};
  const impactLabel = data.impact.replace("_", " ");

  const clusterText =
    extras.clusterCount && extras.clusterCount > 0
      ? `${extras.clusterCount} other site(s) within 40 km.`
      : "No other sites within 40 km.";

  function nearestLine(label, info) {
    if (!info || !info.item) return `<li>${label}: n/a</li>`;
    return `<li>${label}: ${info.item.name} (${info.distanceKm.toFixed(1)} km)</li>`;
  }

  panel.innerHTML = `
    <h3 style="margin-top:0">${data.name}</h3>
    <p><strong>Impact class:</strong> ${impactLabel}</p>
    <p><strong>Category:</strong> ${props.category || "n/a"}</p>
    <p><strong>Status:</strong> ${props.status || "n/a"}</p>
    <p><strong>Commodity:</strong> ${props.commodity || "n/a"}</p>
    <p><strong>Last operation:</strong> ${props.last_year || "n/a"}</p>

    <p><strong>Cluster:</strong> ${clusterText}</p>

    <p><strong>Nearest features:</strong></p>
    <ul>
      ${nearestLine("Town / city", extras.nearestTown)}
      ${nearestLine("Indigenous / northern community", extras.nearestInd)}
      ${nearestLine("Major water body (manual)", extras.nearestWater)}
    </ul>

    <p style="font-size:0.7rem;color:#a4acc2;">
      The red circle is a simple buffer to visualise a potential area of influence.
      It is not a validated risk or contamination model.
    </p>
  `;
}

// ===== Stats line ===== //
function updateStatsBox(filterValue) {
  const box = document.getElementById("map-stats");
  if (!box) return;

  const visible = ALL_MARKERS.filter((m) => markerLayer.hasLayer(m)).length;
  const label = filterValue === "all" ? "All sites" : filterValue;
  box.textContent = `${visible} site(s) shown for filter: ${label}`;
}

// ===== Sidebar toggle (for small screens) ===== //
const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("toggleSidebar");
if (toggleBtn && sidebar) {
  toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("open");
  });
}

// Initialize map centered on Ikeja
var map = L.map('map').setView([6.6018, 3.3515], 12);
L.control.scale({
  position: 'bottomleft',
  metric: true,
  imperial: false
}).addTo(map);
var equityChart;
var zonalLayer;
var zonalFeatures = [];

// Base map
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

// Style for the LGA boundary
function boundaryStyle() {
  return {
    color: '#2c3e50',
    weight: 2,
    opacity: 1,
    fillColor: '#dfeaf6',
    fillOpacity: 0.25
  };
}

function normalizeEquityClass(value) {
  return String(value || '').replace(/[^a-z]/gi, '').toLowerCase();
}

function formatEquityLabel(value) {
  var normalized = normalizeEquityClass(value);

  // Accept multiple synonyms from data or UI (e.g., 'Urgent Need')
  if (normalized.includes('critical') || normalized.includes('urgent') || normalized.includes('need')) return 'Urgent Need';
  if (normalized.includes('underserve') || normalized.includes('overload') || normalized.includes('overloaded')) return 'Underserved';
  if (normalized.includes('adequate') || normalized.includes('meets') || normalized.includes('who')) return 'Adequate';
  return 'Unknown';
}

function getZoneColor(value) {
  var normalized = normalizeEquityClass(value);

  if (normalized.includes('critical') || normalized.includes('urgent') || normalized.includes('need')) return 'red';
  if (normalized.includes('underserve')) return 'yellow';
  if (normalized.includes('adequate')) return 'green';
  return '#999';
}

function formatPopulation(value) {
  if (value === null || value === undefined || value === '') return 'N/A';
  return Number(value).toLocaleString();
}

function formatFacilityCount(value) {
  if (value === null || value === undefined || value === '') return '0';
  return Number(value).toLocaleString();
}

function formatPeoplePerPHC(value) {
  if (value === null || value === undefined || value === '' || Number(value) === 0) return 'No Facility';
  var numericValue = Number(value);
  return numericValue < 99999 ? numericValue.toLocaleString() : 'No Facility';
}

function updateInfoBox(feature) {
  var props = feature.properties || {};
  var equity = formatEquityLabel(props.equity_class);
  var population = formatPopulation(props.pop_sum);
  var facilityCount = formatFacilityCount(props.facility_count);
  var peoplePerPHC = formatPeoplePerPHC(props.people_per_phc);

  var infoBox = document.getElementById('infoBox');
  if (infoBox) {
    infoBox.innerHTML = '<h3>Selected Grid Cell</h3>' +
      '<p><b>Equity Class:</b> ' + equity + '</p>' +
      '<p><b>Population:</b> ' + population + '</p>' +
      '<p><b>PHCs:</b> ' + facilityCount + '</p>' +
      '<p><b>People per PHC:</b> ' + peoplePerPHC + '</p>';
  }
}

function zonalStyle(feature) {
  var props = feature.properties || {};
  return {
    fillColor: getZoneColor(props.equity_class),
    weight: 0.5,
    opacity: 0.55,
    color: 'rgba(255,255,255,0.5)',
    fillOpacity: 0.42
  };
}

function zonalPopup(feature, layer) {
  var props = feature.properties || {};
  var equity = formatEquityLabel(props.equity_class);
  var population = formatPopulation(props.pop_sum);
  var facilityCount = formatFacilityCount(props.facility_count);
  var peoplePerPHC = formatPeoplePerPHC(props.people_per_phc);

  layer.on('click', function () {
    updateInfoBox(feature);
  });

  layer.bindPopup(
    '<b>Equity Class:</b> ' + equity + '<br>' +
    '<b>Population:</b> ' + population + '<br>' +
    '<b>PHCs:</b> ' + facilityCount + '<br>' +
    '<b>People per PHC:</b> ' + peoplePerPHC,
    {
      className: 'cell-popup',
      autoPan: true,
      autoPanPadding: [20, 20],
      closeButton: true
    }
  );
}

function renderEquityChart(counts) {
  if (typeof Chart === 'undefined') return;
  // Display labels (user-facing) map to canonical internal keys used in counts
  var labels = ['Urgent Need', 'Underserved', 'Adequate'];
  var displayToCanonical = {
    'Urgent Need': 'Urgent Need',
    'Underserved': 'Underserved',
    'Adequate': 'Adequate'
  };

  var data = labels.map(function (label) {
    var canonical = displayToCanonical[label] || label;
    return counts[canonical] || 0;
  });
  var colors = ['rgba(255, 0, 0, 0.42)', 'rgba(255, 165, 0, 0.42)', 'rgba(0, 128, 0, 0.42)'];

  var ctx = document.getElementById('equityChart');
  if (!ctx) return;

  if (equityChart) {
    equityChart.destroy();
  }

  equityChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Grid Cells',
        data: data,
        backgroundColor: colors,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 }
        }
      }
    }
  });
}

function summarizeEquity(features) {
  // Use canonical internal labels for counting
  var summary = { 'Urgent Need': 0, 'Underserved': 0, 'Adequate': 0 };
  var seen = {};

  features.forEach(function (feature) {
    var label = formatEquityLabel(feature.properties && feature.properties.equity_class);
    seen[label] = (seen[label] || 0) + 1;
    if (summary[label] !== undefined) {
      summary[label] += 1;
    }
  });

  console.log('summarizeEquity -> summary:', summary, 'seenLabels:', seen);

  return summary;
}

function updateSummaryPanel(summary, selectedClass) {
  var idMap = {
    'Urgent Need': 'urgent-need',
    'Underserved': 'underserved',
    'Adequate': 'adequate'
  };

  Object.keys(idMap).forEach(function (key) {
    var element = document.getElementById('summary-' + idMap[key]);
    if (!element) return;

    var value = summary[key] || 0;
    if (selectedClass && selectedClass !== 'All' && key !== selectedClass) {
      value = 0;
    }
    element.textContent = value;
  });
}

function applyEquityFilter(selectedClass) {
  if (!zonalLayer) return;
  // Normalize the selectedClass to canonical labels so UI values like
  // 'Urgent Need' map to 'Critical Gap'.
  var normalizedSelected = selectedClass === 'All' ? 'All' : formatEquityLabel(selectedClass);

  var visibleSummary = summarizeEquity(zonalFeatures);
  if (normalizedSelected !== 'All') {
    visibleSummary = {
      'Urgent Need': 0,
      'Underserved': 0,
      'Adequate': 0
    };
    zonalFeatures.forEach(function (feature) {
      var label = formatEquityLabel(feature.properties && feature.properties.equity_class);
      if (label === normalizedSelected) {
        visibleSummary[label] += 1;
      }
    });
  }

  updateSummaryPanel(visibleSummary, normalizedSelected);

  zonalLayer.eachLayer(function (layer) {
    if (!layer.feature) return;

    var label = formatEquityLabel(layer.feature.properties.equity_class);
    var matches = normalizedSelected === 'All' || label === normalizedSelected;

    layer.setStyle({
      fillColor: getZoneColor(layer.feature.properties.equity_class),
      weight: matches ? 0.5 : 0.2,
      opacity: matches ? 0.55 : 0.2,
      color: matches ? 'rgba(255,255,255,0.5)' : 'transparent',
      fillOpacity: matches ? 0.42 : 0.05
    });

    if (!matches) {
      layer.closePopup();
    }
  });
}

// Load zonal statistics grid
fetch('Zonal Statistics.geojson')
  .then(function (response) {
    if (!response.ok) {
      throw new Error('Zonal Statistics GeoJSON not found: ' + response.status);
    }
    return response.json();
  })
  .then(function (data) {
    zonalFeatures = data.features || [];
    zonalLayer = L.geoJSON(data, {
      style: zonalStyle,
      onEachFeature: zonalPopup
    }).addTo(map);
    zonalLayer.setZIndex(1);
    zonalLayer.bringToBack();

    var summary = summarizeEquity(zonalFeatures);
    renderEquityChart(summary);
    updateSummaryPanel(summary, 'All');
    applyEquityFilter('All');

    if (zonalLayer.getBounds && zonalLayer.getBounds().isValid()) {
      map.fitBounds(zonalLayer.getBounds());
    }
  })
  .catch(function (error) {
    console.error('Error loading zonal grid data:', error);
  });

// Load Ikeja boundary
fetch('Ikeja boundary.geojson')
  .then(function (response) {
    if (!response.ok) {
      throw new Error('Boundary GeoJSON not found: ' + response.status);
    }
    return response.json();
  })
  .then(function (data) {
    var boundaryLayer = L.geoJSON(data, {
      style: boundaryStyle,
      interactive: false,
      onEachFeature: function (feature, layer) {
        var props = feature.properties || {};
        var name = props.lganame || 'Ikeja LGA';
        var state = props.statename || 'Lagos State';
        layer.options.interactive = false;
        layer.bindPopup('<b>' + name + '</b><br>' + state);
      }
    }).addTo(map);
    boundaryLayer.setZIndex(20);
    boundaryLayer.bringToFront();

    if (data && data.features && data.features.length) {
      var boundaryFeature = data.features[0];
      var outerRing = [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]];
      if (boundaryFeature.geometry && boundaryFeature.geometry.type === 'MultiPolygon' && boundaryFeature.geometry.coordinates.length) {
        var holeRing = boundaryFeature.geometry.coordinates[0][0];
        var maskGeoJSON = {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [outerRing, holeRing]
            }
          }]
        };

        var maskLayer = L.geoJSON(maskGeoJSON, {
          style: function () {
            return {
              color: '#ffffff',
              weight: 0,
              fillColor: '#ffffff',
              fillOpacity: 1,
              opacity: 1
            };
          }
        }).addTo(map);
        maskLayer.setZIndex(15);
      }
    }

    if (boundaryLayer.getBounds && boundaryLayer.getBounds().isValid()) {
      var boundaryBounds = boundaryLayer.getBounds();
      map.fitBounds(boundaryBounds);
      map.setMinZoom(12.58);
      map.setMaxZoom(18);
      map.setMaxBounds(boundaryBounds.pad(0.2));
      map.options.maxBoundsViscosity = 1.0;

      map.on('zoomend moveend', function () {
        if (!boundaryBounds.contains(map.getCenter())) {
          map.fitBounds(boundaryBounds);
        }
      });
    }
  })
  .catch(function (error) {
    console.error('Error loading boundary data:', error);
  });

// Load PHC points
fetch('Ikeja PHC.geojson')
  .then(function (response) {
    if (!response.ok) {
      throw new Error('PHC GeoJSON not found: ' + response.status);
    }
    return response.json();
  })
  .then(function (data) {
    var phcLayer = L.geoJSON(data, {
      pointToLayer: function (feature, latlng) {
        return L.marker(latlng, {
          icon: L.divIcon({
            className: 'hospital-marker',
            html: '<div style="width:22px; height:22px; position:relative;">' +
              '<div style="position:absolute; left:10px; top:1px; width:3px; height:20px; background:#1a7f3b; border-radius:2px; box-shadow:0 0 0 1px rgba(255,255,255,0.8);"></div>' +
              '<div style="position:absolute; left:1px; top:10px; width:20px; height:3px; background:#1a7f3b; border-radius:2px; box-shadow:0 0 0 1px rgba(255,255,255,0.8);"></div>' +
              '</div>',
            iconSize: [22, 22],
            iconAnchor: [11, 11]
          })
        });
      },
      onEachFeature: function (feature, layer) {
        var props = feature.properties || {};
        var name = props.name || 'PHC Facility';
        var type = props.type || 'Primary';
        var ward = props.ward_code || 'N/A';
        var category = props.category || 'Primary Health Center';

        layer.bindPopup(
          '<b>' + name + '</b><br>' +
          '<b>Type:</b> ' + type + '<br>' +
          '<b>Category:</b> ' + category + '<br>' +
          '<b>Ward:</b> ' + ward
        );
      }
    }).addTo(map);
    phcLayer.setZIndex(30);
    phcLayer.bringToFront();
  })
  .catch(function (error) {
    console.error('Error loading PHC data:', error);
  });

var equityFilter = document.getElementById('equityFilter');
if (equityFilter) {
  equityFilter.addEventListener('change', function () {
    applyEquityFilter(this.value);
  });
}
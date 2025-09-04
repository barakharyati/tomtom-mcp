/*
 * Copyright (C) 2025 TomTom NV
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import axios from "axios";
import { validateApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";
import { DynamicMapOptions, DynamicMapResponse } from "./dynamicMapTypes";
import mbgl from '@maplibre/maplibre-gl-native';
import { createCanvas } from 'canvas';
import * as turf from '@turf/turf';

/**
 * Dynamic Map Service
 * Provides advanced map rendering capabilities using MapLibre GL Native, Turf.js, and Canvas
 */

/**
 * Default options for dynamic map rendering
 */
const DEFAULT_DYNAMIC_MAP_OPTIONS = {
  width: 800,
  height: 600,
  showLabels: false,
  routeInfoDetail: "basic" as const,
  use_orbis: false,
};


/**
 * Validate and sanitize coordinate values
 */
function validateCoordinate(value: any, type: string): number {
  const num = parseFloat(value);
  if (isNaN(num)) {
    throw new Error(`Invalid ${type} coordinate: ${value}`);
  }
  
  if (type === 'latitude' && (num < -90 || num > 90)) {
    throw new Error(`Latitude out of range [-90, 90]: ${num}`);
  }
  
  if (type === 'longitude' && (num < -180 || num > 180)) {
    throw new Error(`Longitude out of range [-180, 180]: ${num}`);
  }
  
  return num;
}

/**
 * Extract and validate coordinates from various formats
 */
function extractCoordinates(item: any, index: number | string, type: string = 'marker'): { lat: number; lon: number } | null {
  let lat: number | undefined, lon: number | undefined;
  
  if (Array.isArray(item)) {
    // Handle array format [lat, lon]
    if (item.length >= 2) {
      lat = item[0];
      lon = item[1];
    }
  } else if (item.coordinates && Array.isArray(item.coordinates)) {
    // Handle {coordinates: [lat, lon]} format
    if (item.coordinates.length >= 2) {
      lat = item.coordinates[0];
      lon = item.coordinates[1];
    }
  } else if (item.lat !== undefined && item.lon !== undefined) {
    // Handle {lat: x, lon: y} format (standard)
    lat = item.lat;
    lon = item.lon;
  }
  
  if (lat === undefined || lon === undefined) {
    logger.warn(`❌ Could not extract coordinates from ${type} ${index}`);
    return null;
  }
  
  try {
    const validLat = validateCoordinate(lat, 'latitude');
    const validLon = validateCoordinate(lon, 'longitude');
    return { lat: validLat, lon: validLon };
  } catch (error: any) {
    logger.warn(`❌ Invalid coordinates for ${type} ${index}: ${error.message}`);
    return null;
  }
}

/**
 * Calculate optimal zoom level using web mercator projection math
 */
function calculateOptimalZoom(bounds: any, mapWidth: number, mapHeight: number, paddingPixels: number = 80): number {
  const { north, south, east, west } = bounds;
  
  // Calculate the effective map dimensions after padding
  const effectiveWidth = mapWidth - (paddingPixels * 2);
  const effectiveHeight = mapHeight - (paddingPixels * 2);
  
  // Calculate spans in degrees
  const latSpan = north - south;
  const lngSpan = east - west;
  
  // Web Mercator zoom calculation
  const latRad1 = (south * Math.PI) / 180;
  const latRad2 = (north * Math.PI) / 180;
  const latZoom = Math.log2(effectiveHeight * (180 / Math.PI) / (Math.log(Math.tan(latRad2/2 + Math.PI/4)) - Math.log(Math.tan(latRad1/2 + Math.PI/4))));
  
  // For longitude: simpler calculation
  const lngZoom = Math.log2(effectiveWidth * 360 / (lngSpan * 256));
  
  // Use the more restrictive zoom (smaller value)
  const zoom = Math.min(latZoom, lngZoom);
  
  // Clamp to reasonable bounds and add buffer for marker visibility
  const finalZoom = Math.max(1, Math.min(17, zoom - 0.1));
  
  return finalZoom;
}

/**
 * Enhanced bounds calculation using Turf.js with smarter buffering
 */
function calculateEnhancedBounds(markers: any[], routes: any[], mapWidth: number, mapHeight: number, isRoute: boolean = false): any {
  const features: any[] = [];
  let totalPoints = 0;
  
  // Add markers to feature collection
  if (markers && markers.length > 0) {
    markers.forEach((marker, index) => {
      const coords = extractCoordinates(marker, index, 'marker');
      if (coords) {
        features.push(turf.point([coords.lon, coords.lat]));
        totalPoints++;
      }
    });
  }
  
  // Add route points to feature collection
  if (routes && routes.length > 0) {
    routes.forEach((route, routeIndex) => {
      if (Array.isArray(route)) {
        // Legacy format: route is array of coordinates
        route.forEach((point, pointIndex) => {
          const coords = extractCoordinates(point, `${routeIndex}-${pointIndex}`, 'route point');
          if (coords) {
            features.push(turf.point([coords.lon, coords.lat]));
            totalPoints++;
          }
        });
      } else if (route.points && Array.isArray(route.points)) {
        // New format: route is object with points array
        route.points.forEach((point: any, pointIndex: number) => {
          const coords = extractCoordinates(point, `${routeIndex}-${pointIndex}`, 'route point');
          if (coords) {
            features.push(turf.point([coords.lon, coords.lat]));
            totalPoints++;
          }
        });
      }
    });
  }
  
  if (features.length === 0) {
    throw new Error('No valid coordinates found to calculate bounds');
  }
  
  // Create feature collection and get initial bounds
  const collection = turf.featureCollection(features);
  const rawBbox = turf.bbox(collection);
  const [west, south, east, north] = rawBbox;
  
  // Calculate geographic spans
  const latSpan = north - south;
  const lngSpan = east - west;
  const maxSpan = Math.max(latSpan, lngSpan);
  const markerCount = markers ? markers.length : 0;
  
  // Intelligent buffer calculation (adapted from original implementation)
  let bufferKm: number;
  
  if (markerCount === 1) {
    bufferKm = Math.max(5, maxSpan * 111 * 0.3);
  } else if (maxSpan < 0.001) {
    bufferKm = 1;
  } else if (maxSpan < 0.01) {
    bufferKm = Math.max(2, maxSpan * 111 * 0.5);
  } else if (maxSpan < 0.1) {
    bufferKm = Math.max(3, maxSpan * 111 * 0.4);
  } else if (maxSpan < 1.0) {
    bufferKm = Math.max(10, maxSpan * 111 * 0.3);
  } else if (maxSpan < 5.0) {
    bufferKm = Math.max(50, maxSpan * 111 * 0.35);
  } else if (maxSpan < 10.0) {
    bufferKm = Math.max(75, maxSpan * 111 * 0.3);
  } else {
    bufferKm = Math.max(100, maxSpan * 111 * 0.25);
  }
  
  // Extra buffer for routes and multiple markers
  if (isRoute && markerCount > 1) {
    bufferKm *= 1.5;
  }
  
  if (markerCount > 3) {
    bufferKm *= 1.2;
  }
  
  // Apply buffer using Turf.js
  const bufferedCollection = turf.buffer(collection, bufferKm, { units: 'kilometers' });
  if (!bufferedCollection) {
    throw new Error('Failed to calculate buffered bounds');
  }
  const bufferedBbox = turf.bbox(bufferedCollection);
  const [buffWest, buffSouth, buffEast, buffNorth] = bufferedBbox;
  
  const bounds = {
    west: buffWest,
    south: buffSouth,
    east: buffEast,
    north: buffNorth
  };
  
  // Calculate center point
  const centerLng = (bounds.west + bounds.east) / 2;
  const centerLat = (bounds.south + bounds.north) / 2;
  const center = [centerLng, centerLat];
  
  // Calculate optimal padding in pixels
  let paddingPixels: number;
  if (markerCount === 1) {
    paddingPixels = Math.min(mapWidth, mapHeight) * 0.15;
  } else if (markerCount <= 3) {
    paddingPixels = Math.min(mapWidth, mapHeight) * 0.12;
  } else {
    paddingPixels = Math.min(mapWidth, mapHeight) * 0.10;
  }
  paddingPixels = Math.max(50, Math.min(150, paddingPixels));
  
  // Calculate zoom using enhanced algorithm
  const zoom = calculateOptimalZoom(bounds, mapWidth, mapHeight, paddingPixels);
  
  return { bounds, center, zoom };
}

/**
 * Render a dynamic map using MapLibre GL Native (adapted from original renderMap function)
 */
async function renderMapWithMapLibre(options: any): Promise<Buffer> {
  const { bbox, width, height, markers, routes, isRoute, showLabels, routeLabel, use_orbis } = options;
  
  let bounds: any, center: any, zoom: number;
  
  // Calculate enhanced bounds (adapted from original implementation)
  if (bbox && Array.isArray(bbox) && bbox.length === 4) {
    try {
      const providedBounds = {
        west: validateCoordinate(bbox[0], 'longitude'),
        south: validateCoordinate(bbox[1], 'latitude'),
        east: validateCoordinate(bbox[2], 'longitude'),
        north: validateCoordinate(bbox[3], 'latitude')
      };
      
      if (providedBounds.west >= providedBounds.east || providedBounds.south >= providedBounds.north) {
        throw new Error(`Invalid bounds: west must be < east and south must be < north`);
      }
      
      const result = calculateEnhancedBounds(
        [
          { lat: providedBounds.south, lng: providedBounds.west },
          { lat: providedBounds.north, lng: providedBounds.east }
        ], 
        [], 
        width, 
        height, 
        isRoute
      );
      
      bounds = result.bounds;
      center = result.center;
      zoom = result.zoom;
    } catch (error: any) {
      logger.warn(`⚠️ Invalid bbox: ${error.message}. Calculating from markers/routes.`);
      const result = calculateEnhancedBounds(markers, routes, width, height, isRoute);
      bounds = result.bounds;
      center = result.center;
      zoom = result.zoom;
    }
  } else {
    const result = calculateEnhancedBounds(markers, routes, width, height, isRoute);
    bounds = result.bounds;
    center = result.center;
    zoom = result.zoom;
  }
  
  // Fetch TomTom style (adapted from original)
  const STYLE_VERSION = '22.3.0-1';
  const MAP_STYLE = 'basic_main';
  
  let styleUrl: string;
  if (use_orbis) {
    styleUrl = `https://api.tomtom.com/maps/orbis/assets/styles/0.*/style.json?key=${process.env.TOMTOM_API_KEY}&apiVersion=1&map=basic_street-light`;
    logger.info('🌍 Using TomTom Orbis style endpoint');
  } else {
    styleUrl = `https://api.tomtom.com/style/1/style/${STYLE_VERSION}?key=${process.env.TOMTOM_API_KEY}&map=${MAP_STYLE}`;
    logger.info('🗺️ Using default TomTom style endpoint');
  }
  
  const response = await axios.get(styleUrl);
  const style = response.data;
  
  // Validate style data
  if (!style || typeof style !== 'object') {
    throw new Error('Invalid style data received from TomTom API');
  }
  
  // Initialize MapLibre Native map
  const map = new mbgl.Map({
    request: (req: any, callback: any) => {
      axios
        .get(req.url, { responseType: 'arraybuffer' })
        .then(r => callback(null, { data: r.data }))
        .catch(e => callback(e));
    },
    ratio: 1
  });
  
  try {
    map.load(style);
    
    // Add markers if present (adapted from original implementation)
    if (markers && markers.length > 0) {
      const markerFeatures = markers.map((marker: any, index: number) => {
        const coords = extractCoordinates(marker, index, 'marker');
        if (coords) {
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [coords.lon, coords.lat] },
            properties: { 
              id: index, 
              label: marker.label || `Marker ${index + 1}`, 
              color: marker.color || '#ff4444' 
            }
          };
        }
        return null;
      }).filter(Boolean);
      
      if (markerFeatures.length > 0) {
        map.addSource('markers', { 
          type: 'geojson', 
          data: { type: 'FeatureCollection', features: markerFeatures } 
        });
        
        // Add enhanced marker styling (from original implementation)
        map.addLayer({
          id: 'marker-shadow',
          type: 'circle',
          source: 'markers',
          paint: {
            'circle-radius': 20,
            'circle-color': 'rgba(0, 0, 0, 0.25)',
            'circle-blur': 1,
            'circle-translate': [3, 3]
          }
        });
        
        map.addLayer({
          id: 'marker-outer',
          type: 'circle',
          source: 'markers',
          paint: {
            'circle-radius': 18,
            'circle-color': 'rgba(255, 255, 255, 0.9)',
            'circle-stroke-width': 2,
            'circle-stroke-color': 'rgba(0, 0, 0, 0.3)'
          }
        });
        
        map.addLayer({ 
          id: 'marker-layer', 
          type: 'circle', 
          source: 'markers', 
          paint: { 
            'circle-radius': 14, 
            'circle-color': ['get', 'color'],
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 1
          } 
        });
        
        map.addLayer({
          id: 'marker-inner',
          type: 'circle',
          source: 'markers',
          paint: {
            'circle-radius': 4,
            'circle-color': '#ffffff',
            'circle-opacity': 1
          }
        });
        
        // Add labels if enabled
        if (showLabels) {
          map.addLayer({
            id: 'marker-labels',
            type: 'symbol',
            source: 'markers',
            layout: {
              'text-field': ['get', 'label'],
              'text-font': ['Noto-Regular'],
              'text-offset': [0, 2.5],
              'text-anchor': 'top',
              'text-size': 11,
              'text-max-width': 8,
              'text-allow-overlap': false
            },
            paint: {
              'text-color': '#2c3e50',
              'text-halo-color': '#ffffff',
              'text-halo-width': 3
            }
          });
        }
        
        logger.info(`✅ Added ${markerFeatures.length} enhanced markers to map`);
      }
    }
    
    // Add routes if present (adapted from original implementation)
    if (routes && routes.length > 0) {
      const routeFeatures = routes.map((route: any, routeIndex: number) => {
        let routePoints: any[] = [];
        
        if (Array.isArray(route)) {
          routePoints = route;
        } else if (route.points && Array.isArray(route.points)) {
          routePoints = route.points;
        }
        
        if (routePoints.length > 1) {
          const validCoords = routePoints
            .map((point, pointIndex) => extractCoordinates(point, `${routeIndex}-${pointIndex}`, 'route point'))
            .filter(coord => coord !== null)
            .map(coord => [coord!.lon, coord!.lat]);
          
          if (validCoords.length > 1) {
            return {
              type: 'Feature',
              geometry: { 
                type: 'LineString', 
                coordinates: validCoords
              },
              properties: { 
                id: routeIndex,
                label: routeLabel || `Route ${routeIndex + 1}`,
                trafficColor: '#22c55e' // Default green
              }
            };
          }
        }
        return null;
      }).filter(Boolean);
      
      if (routeFeatures.length > 0) {
        map.addSource('routes', { 
          type: 'geojson', 
          data: { type: 'FeatureCollection', features: routeFeatures } 
        });
        
        // Add route outline for better visibility
        map.addLayer({ 
          id: 'route-outline', 
          type: 'line', 
          source: 'routes', 
          paint: { 
            'line-width': 8, 
            'line-color': '#ffffff',
            'line-opacity': 0.8
          } 
        });
        
        // Add main route layer with traffic-based coloring
        map.addLayer({ 
          id: 'route-layer', 
          type: 'line', 
          source: 'routes', 
          paint: { 
            'line-width': 6, 
            'line-color': ['get', 'trafficColor'],
            'line-opacity': 1
          } 
        });
        
        logger.info(`✅ Added ${routeFeatures.length} enhanced routes to map`);
      }
    }
    
    // Render map to buffer (adapted from original Promise-based implementation)
    return new Promise((resolve, reject) => {
      map.render({ zoom, center, width, height }, (err: Error | undefined, buffer: Uint8Array | undefined) => {
        if (map) map.release();
        if (err) {
          reject(new Error(`Map rendering failed: ${err.message}`));
        } else if (!buffer) {
          reject(new Error('Map rendering failed: No buffer returned'));
        } else {
          try {
            // Convert raw buffer to PNG using canvas (from original implementation)
            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');
            
            // Create ImageData from the raw buffer
            const imageData = ctx.createImageData(width, height);
            
            // MapLibre returns RGBA data, copy it to ImageData
            for (let i = 0; i < buffer.length; i++) {
              imageData.data[i] = buffer[i];
            }
            
            // Put the image data on canvas and convert to PNG
            ctx.putImageData(imageData, 0, 0);
            const pngBuffer = canvas.toBuffer('image/png');
            
            resolve(pngBuffer);
          } catch (conversionError: any) {
            reject(new Error(`PNG conversion failed: ${conversionError.message}`));
          }
        }
      });
    });
    
  } catch (error: any) {
    if (map) map.release();
    throw error;
  }
}

/**
 * Renders a dynamic map with advanced features
 * @param options Dynamic map rendering options
 * @returns Promise resolving to the rendered map data
 */
export async function renderDynamicMap(options: DynamicMapOptions): Promise<DynamicMapResponse> {
  // Validate TomTom API key
  validateApiKey();
  
  logger.info("🗺️ Processing dynamic map request");
  
  try {
    // Dependencies are now statically imported at the top of the file
    // No need for dynamic initialization
    
    // Apply default options
    const finalOptions = { ...DEFAULT_DYNAMIC_MAP_OPTIONS, ...options };
    
    // Prepare markers array (adapted from original route handling logic)
    let markers: any[] = [];
    if (finalOptions.markers) {
      markers = [...finalOptions.markers];
    }
    
    // Handle route planning mode (adapted from original app.post('/render') logic)
    if (finalOptions.isRoute) {
      if (!finalOptions.origin || !finalOptions.destination) {
        throw new Error('Route planning mode requires both origin and destination coordinates');
      }
      
      const originCoords = extractCoordinates(finalOptions.origin, 0, 'origin');
      const destCoords = extractCoordinates(finalOptions.destination, 0, 'destination');
      
      if (!originCoords || !destCoords) {
        throw new Error('Invalid origin or destination coordinates');
      }
      
      // Create markers for origin and destination (from original implementation)
      markers = [
        { lat: originCoords.lat, lon: originCoords.lon, label: 'Start', color: '#22c55e' }
      ];
      
      // Add waypoints if provided
      if (finalOptions.waypoints && finalOptions.waypoints.length > 0) {
        finalOptions.waypoints.forEach((wp, i) => {
          const wpCoords = extractCoordinates(wp, i, 'waypoint');
          if (wpCoords) {
            markers.push({ 
              lat: wpCoords.lat, 
              lon: wpCoords.lon, 
              label: `Waypoint ${i+1}`, 
              color: '#f97316' 
            });
          }
        });
      }
      
      markers.push({ 
        lat: destCoords.lat, 
        lon: destCoords.lon, 
        label: 'End', 
        color: '#ef4444' 
      });
    }
    
    // Prepare routes array (adapted from original logic)
    let routes: any[] = [];
    if (finalOptions.routes && finalOptions.routes.length > 0) {
      routes = finalOptions.routes;
    } else if (finalOptions.route && finalOptions.route.length > 0) {
      routes = [finalOptions.route];
    }
    
    // Render the map using the adapted MapLibre implementation
    const buffer = await renderMapWithMapLibre({
      bbox: finalOptions.bbox,
      width: finalOptions.width,
      height: finalOptions.height,
      markers,
      routes,
      isRoute: finalOptions.isRoute || false,
      showLabels: finalOptions.showLabels || false,
      routeLabel: finalOptions.routeLabel,
      use_orbis: finalOptions.use_orbis || false
    });
    
    // Convert buffer to base64
    const base64 = buffer.toString('base64');
    
    const responseData: DynamicMapResponse = {
      base64,
      contentType: 'image/png',
      width: finalOptions.width || DEFAULT_DYNAMIC_MAP_OPTIONS.width,
      height: finalOptions.height || DEFAULT_DYNAMIC_MAP_OPTIONS.height,
    };
    
    logger.info(`✅ Dynamic map rendered successfully: ${(buffer.length / 1024).toFixed(2)} KB`);
    
    return responseData;
    
  } catch (error: any) {
    logger.error(`❌ Dynamic map generation failed: ${error.message}`);
    
    // Since we're using static imports, dependency errors will be caught at module load time
    // This provides cleaner error handling for actual runtime issues
    throw error;
  }
}

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

import { z } from "zod";
import { coordinateSchema, routingOptionsSchema, vehicleSchema, sectionTypeSchema } from "./commonOrbis";

export const tomtomRoutingSchema = {
  origin: coordinateSchema.describe(
    "Starting point coordinates. Obtain from geocoding for best results."
  ),
  destination: coordinateSchema.describe(
    "Destination coordinates. Obtain from geocoding for best results."
  ),
  ...routingOptionsSchema,
  ...vehicleSchema,
  sectionType: sectionTypeSchema.describe(
    "Highlight specific road section types in response for route analysis: toll (toll roads), motorway (highways), tunnel, urban (city areas), country (rural areas), pedestrian (walking paths), etc."
  ),
};

export const tomtomWaypointRoutingSchema = {
  waypoints: z
    .array(coordinateSchema)
    .min(2)
    .describe(
      "Ordered array of waypoint coordinates (minimum 2). Route calculated in exact sequence provided. Use geocoding for accurate coordinates."
    ),
  ...routingOptionsSchema,
  ...vehicleSchema,
  sectionType: sectionTypeSchema.describe(
    "Road section types to highlight for route analysis. Options: toll (toll roads), motorway (highways), tunnel, urban (city areas), country (rural areas), pedestrian (walking paths), traffic (traffic incidents), toll_road, ferry, travel_mode, important_road_stretch. Accepts array of string(s)."
  ),
};

import fs from "node:fs";
import path from "node:path";
import type { Constraints, Plan, Venue } from "../shared/types";
import { config } from "./config";

function readMock<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(config.mockDir, file), "utf8")) as T;
}

export const mockConstraints = () => readMock<Constraints[]>("constraints.sample.json");
export const mockVenues = () => readMock<Venue[]>("venues.sample.json");
export const mockPlans = () => readMock<Plan[]>("plans.sample.json");

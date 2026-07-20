import * as build from "./build/server/index.js";
import { createWorker } from "./src/worker/createWorker";

export default createWorker(build);

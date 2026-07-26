import { parentPort, workerData } from "node:worker_threads";
import { compileGraph } from "@graph-engineering/core";

if (parentPort === null) {
  throw new Error("compile-worker must run inside a worker thread");
}

parentPort.postMessage(compileGraph(workerData));

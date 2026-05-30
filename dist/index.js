"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncDictionary = exports.SchemaValidationError = exports.InvalidGenotypeError = exports.DictionaryNetworkError = exports.CartesianMatrixError = void 0;
exports.calculateMorphsAsync = calculateMorphsAsync;
const types_1 = require("./types");
// Access the Worker constructor via globalThis to avoid a TS compile error
// when lib does not include WebWorker (e.g., the Node/Jest test environment).
function spawnWorker(url) {
    const WorkerCtor = globalThis['Worker'];
    return new WorkerCtor(url);
}
/**
 * Executes the Morphkit genetic calculation pipeline asynchronously inside a
 * Web Worker and returns the result as a Promise. The worker is terminated
 * after the calculation completes or fails.
 *
 * @param input - The breeding pair and calculation settings.
 * @param dictionary - The MorphkitDictionary fetched by the main thread; passed
 *   directly into the worker so the worker never makes network requests.
 * @param workerUrl - URL of the compiled worker bundle. In a Vite/webpack SPA,
 *   pass `new URL('./morphkit.worker.js', import.meta.url)`.
 */
function calculateMorphsAsync(input, dictionary, workerUrl) {
    return new Promise((resolve, reject) => {
        const worker = spawnWorker(workerUrl);
        worker.onmessage = ({ data: msg }) => {
            worker.terminate();
            if (msg.type === 'SUCCESS') {
                resolve(msg.output);
                return;
            }
            const { name, message, field, locusId, actualSum } = msg.error;
            let error;
            if (name === 'SchemaValidationError') {
                error = new types_1.SchemaValidationError(message, field);
            }
            else if (name === 'InvalidGenotypeError') {
                error = new types_1.InvalidGenotypeError(message, locusId);
            }
            else if (name === 'CartesianMatrixError') {
                error = new types_1.CartesianMatrixError(message, actualSum);
            }
            else {
                error = new Error(message);
                error.name = name;
            }
            reject(error);
        };
        worker.onerror = ({ message }) => {
            worker.terminate();
            reject(new Error(message));
        };
        worker.postMessage({ type: 'CALCULATE', input, dictionary });
    });
}
var types_2 = require("./types");
Object.defineProperty(exports, "CartesianMatrixError", { enumerable: true, get: function () { return types_2.CartesianMatrixError; } });
Object.defineProperty(exports, "DictionaryNetworkError", { enumerable: true, get: function () { return types_2.DictionaryNetworkError; } });
Object.defineProperty(exports, "InvalidGenotypeError", { enumerable: true, get: function () { return types_2.InvalidGenotypeError; } });
Object.defineProperty(exports, "SchemaValidationError", { enumerable: true, get: function () { return types_2.SchemaValidationError; } });
var network_1 = require("./network");
Object.defineProperty(exports, "syncDictionary", { enumerable: true, get: function () { return network_1.syncDictionary; } });
//# sourceMappingURL=index.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("../types");
const pipeline_1 = require("./pipeline");
self.onmessage = (event) => {
    const { type, input, dictionary } = event.data;
    if (type !== 'CALCULATE')
        return;
    try {
        const output = (0, pipeline_1.runCalculationPipeline)(input, dictionary);
        const response = { type: 'SUCCESS', output };
        self.postMessage(response);
    }
    catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const response = {
            type: 'ERROR',
            error: {
                name: error.name,
                message: error.message,
                ...(error instanceof types_1.SchemaValidationError && { field: error.field }),
                ...(error instanceof types_1.InvalidGenotypeError && { locusId: error.locusId }),
                ...(error instanceof types_1.CartesianMatrixError && { actualSum: error.actualSum }),
            },
        };
        self.postMessage(response);
    }
};
//# sourceMappingURL=morphkit.worker.js.map
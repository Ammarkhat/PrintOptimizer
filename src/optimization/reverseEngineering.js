export const fakeReverseEngineer = async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));

    return {
        primitivesDetected: 27,
        minCurvature: 0.014,
        maxCurvature: 1.372,
        averageCurvature: 0.286,
        averageWallThicknessMm: 2.35,
        estimatedHoleCount: 8,
        dominantSymmetryAxes: 2,
        confidenceScore: 0.93,
    };
};

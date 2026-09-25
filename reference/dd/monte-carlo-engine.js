export class MonteCarloEngine {
    run(outcomes, startingCapital, stake, payout = 0.8, simulationCount = 1000, seed = 1) {
        if (outcomes.length === 0 || simulationCount < 1)
            throw new Error("outcomes and simulationCount are required");
        let state = seed >>> 0;
        const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
        const endings = Array.from({ length: simulationCount }, () => outcomes.reduce((capital) => { const won = random() < outcomes.filter(Boolean).length / outcomes.length; return capital + (won ? stake * payout : -stake); }, startingCapital)).sort((a, b) => a - b);
        const percentile = (fraction) => endings[Math.min(endings.length - 1, Math.floor((endings.length - 1) * fraction))];
        return { simulationOnly: true, seed, simulationCount, endingCapitalPercentiles: { p5: percentile(0.05), p25: percentile(0.25), p50: percentile(0.5), p75: percentile(0.75), p95: percentile(0.95) } };
    }
}

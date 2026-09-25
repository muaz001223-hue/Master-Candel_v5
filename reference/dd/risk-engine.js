export class RiskEngine {
    evaluate(input) {
        if (input.startingCapital <= 0)
            throw new Error("startingCapital must be greater than zero");
        if (input.stakes.length !== input.outcomes.length)
            throw new Error("stakes and outcomes must have equal lengths");
        let capital = input.startingCapital;
        let peak = capital;
        let maximumDrawdown = 0;
        let currentLosses = 0;
        let longestLosingStreak = 0;
        let maximumSimulatedLoss = 0;
        let exposure = 0;
        input.stakes.forEach((stake, index) => {
            if (stake < 0 || stake > capital)
                throw new Error("stake must be within available capital");
            exposure += stake;
            if (input.outcomes[index])
                capital += stake * 0.8;
            else {
                capital -= stake;
                currentLosses += 1;
                maximumSimulatedLoss = Math.max(maximumSimulatedLoss, stake);
            }
            if (input.outcomes[index])
                currentLosses = 0;
            longestLosingStreak = Math.max(longestLosingStreak, currentLosses);
            peak = Math.max(peak, capital);
            maximumDrawdown = Math.max(maximumDrawdown, peak === 0 ? 1 : (peak - capital) / peak);
        });
        return { startingCapital: input.startingCapital, endingCapital: capital, maximumDrawdown, longestLosingStreak, maximumSimulatedLoss, capitalUtilization: exposure / input.startingCapital, observationCount: input.outcomes.length, status: maximumDrawdown > 0.25 ? "BLOCKED" : maximumDrawdown > 0.1 ? "RESTRICTED" : "ACCEPTABLE" };
    }
}

export class BinaryOptionsSimulator {
    run(events, startingCapital, seed = 1) {
        let capital = startingCapital;
        const results = events.map((event) => {
            const won = event.direction === event.actualDirection;
            const profitLoss = won ? event.stake * event.payout : -event.stake;
            capital += profitLoss;
            return { ...event, outcome: won ? "WIN" : "LOSS", profitLoss };
        });
        return { simulationOnly: true, seed, events: results, endingCapital: capital };
    }
}

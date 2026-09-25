export class MarketReplay {
    async run(candles, handler) {
        const ordered = [...candles].sort((left, right) => left.openTimestamp.localeCompare(right.openTimestamp));
        const history = [];
        for (const candle of ordered) {
            if (candle.state !== "VALIDATED" && candle.state !== "CLOSED")
                continue;
            await handler.onCandle(candle, [...history]);
            history.push(candle);
        }
    }
}

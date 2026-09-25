import json
import unittest

from screen_capture_pipeline import CandleBuilder, SOURCE, parse_ocr_price, validate_ohlc


class ScreenCapturePipelineTests(unittest.TestCase):
    def test_ambiguous_ocr_is_dropped(self):
        self.assertIsNone(parse_ocr_price("1O0.20"))
        self.assertIsNone(parse_ocr_price(""))
        self.assertIsNone(parse_ocr_price("-1"))
        self.assertEqual(parse_ocr_price("1,100.25"), 1100.25)

    def test_ohlc_validation(self):
        self.assertTrue(validate_ohlc(100, 102, 99, 101))
        self.assertFalse(validate_ohlc(100, 98, 99, 101))
        self.assertFalse(validate_ohlc(100, 102, 99, -1))

    def test_candle_has_fixed_unverified_source_and_json_shape(self):
        builder = CandleBuilder("EUR/USD", timeframe_seconds=1)
        self.assertIsNone(builder.add_ocr_price("1.1000", source_time=1000.1))
        candle = builder.add_ocr_price("1.1005", source_time=1001.1)
        self.assertIsNotNone(candle)
        payload = candle.to_payload()
        self.assertEqual(payload["source"], SOURCE)
        self.assertEqual(payload["data_quality"], "UNVERIFIED")
        self.assertEqual(payload["ohlc"]["open"], 1.1)
        json.dumps(payload)

    def test_duplicates_and_out_of_order_are_ignored(self):
        builder = CandleBuilder("EUR/USD", timeframe_seconds=1)
        builder.add_ocr_price("1.1000", source_time=1000.1)
        builder.add_ocr_price("1.1000", source_time=1000.1)
        self.assertIsNone(builder.add_ocr_price("1.0999", source_time=999.9))

    def test_abnormal_jump_is_ignored(self):
        builder = CandleBuilder("EUR/USD", timeframe_seconds=1, max_jump_ratio=0.01)
        builder.add_ocr_price("1.1000", source_time=1000.1)
        self.assertIsNone(builder.add_ocr_price("1.2000", source_time=1000.2))


if __name__ == "__main__":
    unittest.main()

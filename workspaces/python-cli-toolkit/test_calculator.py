import unittest
from calculator import evaluate_tokens

class TestCalculator(unittest.TestCase):
    def test_sum_and_avg(self):
        self.assertEqual(evaluate_tokens([10, 20, 30], "sum"), 60.0)
        self.assertEqual(evaluate_tokens([10, 20, 30], "avg"), 20.0)

if __name__ == "__main__":
    unittest.main()

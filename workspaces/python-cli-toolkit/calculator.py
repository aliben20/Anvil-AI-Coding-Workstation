def evaluate_tokens(tokens: list[float], op: str = "sum") -> float:
    if not tokens:
        return 0.0
    if op == "sum":
        return float(sum(tokens))
    if op == "avg":
        return float(sum(tokens) / len(tokens))
    if op == "max":
        return float(max(tokens))
    raise ValueError(f"Unsupported operation: {op}")

if __name__ == "__main__":
    sample = [12.5, 18.0, 29.5]
    print(f"Sum: {evaluate_tokens(sample, 'sum')}, Avg: {evaluate_tokens(sample, 'avg')}")

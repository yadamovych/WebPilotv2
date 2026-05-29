"""
Token pricing table — USD per 1 million tokens (input, output).
Prices are approximate and subject to change; update as needed.
"""

from __future__ import annotations

# Keys are lowercase model name prefixes, longest-first so the first match wins.
# Tuple: (input_usd_per_1m, output_usd_per_1m)
_PRICES: list[tuple[str, float, float]] = [
    # OpenAI
    ("gpt-4.1-mini",           0.40,   1.60),
    ("gpt-4.1-nano",           0.10,   0.40),
    ("gpt-4.1",                2.00,   8.00),
    ("gpt-4o-mini",            0.15,   0.60),
    ("gpt-4o",                 5.00,  15.00),
    ("gpt-4-turbo",           10.00,  30.00),
    ("gpt-4",                 30.00,  60.00),
    ("gpt-3.5-turbo",          0.50,   1.50),
    ("o1-mini",                3.00,  12.00),
    ("o1",                    15.00,  60.00),
    # Anthropic Claude 3.x
    ("claude-3-5-haiku",       0.80,   4.00),
    ("claude-3-5-sonnet",      3.00,  15.00),
    ("claude-3-haiku",         0.25,   1.25),
    ("claude-3-sonnet",        3.00,  15.00),
    ("claude-3-opus",         15.00,  75.00),
    # Groq (Llama 3.x)
    ("llama-3.3-70b",          0.59,   0.79),
    ("llama-3.1-70b",          0.59,   0.79),
    ("llama-3.1-8b",           0.05,   0.08),
    ("llama3-70b",             0.59,   0.79),
    ("llama3-8b",              0.05,   0.08),
    ("mixtral-8x7b",           0.24,   0.24),
    ("gemma2-9b",              0.20,   0.20),
]


def compute_cost(model: str, input_tokens: int, output_tokens: int) -> float | None:
    """Return estimated USD cost, or None if the model is not in the pricing table."""
    model_lower = model.lower()
    for prefix, in_price, out_price in _PRICES:
        if model_lower.startswith(prefix):
            return (input_tokens * in_price + output_tokens * out_price) / 1_000_000
    return None

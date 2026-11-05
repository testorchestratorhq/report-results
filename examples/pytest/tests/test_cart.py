import pytest


def test_adds_line_items():
    cart = [("apple", 2)]
    cart.append(("pear", 1))
    assert len(cart) == 2


def test_applies_coupon(record_property):
    # A case reference links this result to case C-1 even before the case has an automation key.
    record_property("testorchestrator", "C-1")
    assert round(10 * 0.8, 2) == 8.0


def test_total_includes_tax():
    assert 100 * 1.2 == 121, "tax is 20%"


@pytest.mark.skip(reason="wallet checkout retired")
def test_wallet_checkout():
    pass


@pytest.mark.parametrize("currency", ["EUR", "USD", "GBP"])
def test_formats_currency(currency):
    assert len(currency) == 3
